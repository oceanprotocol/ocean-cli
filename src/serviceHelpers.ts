import util from "util";
import chalk from "chalk";
import { Signer, getAddress } from "ethers";
import {
  ProviderInstance,
  EscrowContract,
  amountToUnits,
  unitsToAmount,
  getTokenDecimals,
  ComputeEnvironment,
  ComputeResource,
  ComputeResourceRequest,
  ServiceJob,
  ServiceStatusNumber,
  ServiceTemplatePublic,
  TemplateResourceRequirement,
} from "@oceanprotocol/lib";
import { getConfigByChainId } from "./helpers.js";

// ---------------------------------------------------------------------------
// 4.1 Status labels
// ---------------------------------------------------------------------------

export const SERVICE_STATUS_LABELS: Record<number, string> = {
  10: "Starting",
  11: "Pulling image",
  12: "Image pull FAILED",
  13: "Building image",
  14: "Image build FAILED",
  15: "Image VULNERABLE",
  20: "Locking escrow",
  30: "Claiming payment",
  40: "Running",
  50: "Stopping",
  70: "Stopped",
  75: "Expired",
  99: "Error",
};

// Statuses that mean the service failed and will never reach Running.
export const TERMINAL_FAILURE_STATUSES = [12, 14, 15, 99];

// Any status the poller should stop on (failure or benign end state).
export function isTerminal(status: number): boolean {
  return (
    TERMINAL_FAILURE_STATUSES.includes(status) || [70, 75].includes(status)
  );
}

export function statusLabel(status: number, statusText?: string): string {
  // Prefer the node-provided statusText; fall back to the local map.
  return statusText || SERVICE_STATUS_LABELS[status] || `status ${status}`;
}

// Colorize a status string: green for Running, red for failures, yellow otherwise.
function colorForStatus(status: number, text: string): string {
  if (status === ServiceStatusNumber.Running) return chalk.green(text);
  if (TERMINAL_FAILURE_STATUSES.includes(status)) return chalk.red(text);
  return chalk.yellow(text);
}

// ---------------------------------------------------------------------------
// 4.2 Environment <-> template resource matching
// (ported from ocean.js test/integration/Services.test.ts)
// ---------------------------------------------------------------------------

export function availableFor(
  env: ComputeEnvironment,
  req: TemplateResourceRequirement,
): number {
  const resources: ComputeResource[] = env.resources ?? [];
  if (req.id) {
    const r = resources.find((x) => x.id === req.id);
    return r ? (r.total ?? 0) - (r.inUse ?? 0) : 0;
  }
  return resources
    .filter((x) => x.kind === req.kind && (!req.type || x.type === req.type))
    .reduce((sum, x) => sum + ((x.total ?? 0) - (x.inUse ?? 0)), 0);
}

export function envSatisfiesTemplate(
  env: ComputeEnvironment,
  reqs?: TemplateResourceRequirement[],
): boolean {
  return (reqs ?? []).every((req) => availableFor(env, req) >= req.min);
}

// Human-readable reason a template does not fit an env (or null when it fits).
export function templateMismatchReason(
  env: ComputeEnvironment,
  template?: ServiceTemplatePublic,
): string | null {
  if (!template) return null;
  for (const req of template.requiredResources ?? []) {
    const have = availableFor(env, req);
    if (have < req.min) {
      const what =
        req.id ?? `${req.kind ?? "resource"}${req.type ? `/${req.type}` : ""}`;
      return `${what}: need ${req.min}, have ${have}`;
    }
  }
  return null;
}

export function findServiceEnvironments(
  envs: ComputeEnvironment[],
  template?: ServiceTemplatePublic,
): ComputeEnvironment[] {
  return (envs ?? []).filter(
    (e) =>
      e.features?.services !== false &&
      (!template || envSatisfiesTemplate(e, template.requiredResources)),
  );
}

// ---------------------------------------------------------------------------
// 4.3 Default resources from a template
// ---------------------------------------------------------------------------

export function resolveServiceResources(
  template: ServiceTemplatePublic | undefined,
  env: ComputeEnvironment,
): ComputeResourceRequest[] {
  const requiredById = (template?.requiredResources ?? []).filter(
    (r) => typeof r.id === "string",
  );
  if (requiredById.length) {
    return requiredById.map((r) => ({ id: r.id as string, amount: r.min }));
  }
  return (env.resources ?? [])
    .filter((r) => r.id === "cpu" || r.id === "ram")
    .map((r) => ({ id: r.id, amount: 1 }));
}

// ---------------------------------------------------------------------------
// 4.4 Cost estimation (same formula the node uses)
// ---------------------------------------------------------------------------

// Returns the estimated cost in HUMAN token amount, or null when the env has no
// fee schedule for (chainId, token) — the caller must abort in that case.
export function estimateServiceCost(
  env: ComputeEnvironment,
  chainId: number,
  token: string,
  resources: { id: string; amount: number }[],
  durationSeconds: number,
): number | null {
  const schedules = env.fees?.[String(chainId)];
  const schedule = schedules?.find(
    (f) => f.feeToken.toLowerCase() === token.toLowerCase(),
  );
  if (!schedule) return null;
  const priceFor = (id: string) =>
    Number(schedule.prices?.find((p) => p.id === id)?.price ?? 0);
  const minutes = Math.ceil(durationSeconds / 60);
  return resources.reduce(
    (sum, r) => sum + priceFor(r.id) * r.amount * minutes,
    0,
  );
}

// ---------------------------------------------------------------------------
// 4.5 userData parsing + validation
// ---------------------------------------------------------------------------

// inlineJson wins over filePath. Returns undefined when neither is given.
// `template` (optional) is used only to validate/warn about keys.
export function parseUserData(
  inlineJson?: string,
  parsedFromFile?: Record<string, unknown>,
  template?: ServiceTemplatePublic,
): Record<string, unknown> | undefined {
  let data: Record<string, unknown> | undefined;
  if (typeof inlineJson === "string" && inlineJson.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(inlineJson);
    } catch {
      throw new Error("--user-data must be a valid JSON object");
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        "--user-data must be a JSON object (not an array or primitive)",
      );
    }
    data = parsed as Record<string, unknown>;
  } else if (parsedFromFile) {
    if (
      typeof parsedFromFile !== "object" ||
      parsedFromFile === null ||
      Array.isArray(parsedFromFile)
    ) {
      throw new Error("--user-data-file must contain a JSON object");
    }
    data = parsedFromFile;
  }

  if (!data) return undefined;

  if (template) {
    const configurable = template.userConfigurableEnvVars ?? [];
    const byKey = new Map(configurable.map((v) => [v.key, v]));
    for (const key of Object.keys(data)) {
      const spec = byKey.get(key);
      if (!spec) {
        // Warn (don't fail) about keys the template does not advertise.
        console.log(
          chalk.yellow(
            `Warning: userData key "${key}" is not listed in the template's userConfigurableEnvVars.`,
          ),
        );
        continue;
      }
      if (spec.validation) {
        let re: RegExp | undefined;
        try {
          re = new RegExp(spec.validation);
        } catch {
          re = undefined;
        }
        // Only validate string values; never print the value itself.
        const val = data[key];
        if (re && typeof val === "string" && !re.test(val)) {
          throw new Error(
            `userData value for "${key}" does not match the template's validation pattern`,
          );
        }
      }
    }
  }

  return data;
}

// Safe echo of userData: keys only, never values (may contain secrets).
export function describeUserDataKeys(
  data?: Record<string, unknown>,
): string | undefined {
  if (!data) return undefined;
  const keys = Object.keys(data);
  if (keys.length === 0) return undefined;
  return keys.join(", ");
}

// ---------------------------------------------------------------------------
// 4.6 Escrow pre-verification
// ---------------------------------------------------------------------------

// Prints actionable errors and returns false when escrow is not ready.
export async function verifyServiceEscrow(
  signer: Signer,
  chainId: number,
  token: string,
  payee: string, // env.consumerAddress
  costHuman: number, // from estimateServiceCost
  durationSeconds: number,
): Promise<boolean> {
  try {
    const config = await getConfigByChainId(chainId);
    if (!config?.Escrow) {
      console.error(
        chalk.red(
          `Escrow contract address not found for chain ${chainId} in the address file.`,
        ),
      );
      return false;
    }
    const escrow = new EscrowContract(
      getAddress(config.Escrow),
      signer,
      chainId,
    );
    const decimals = await getTokenDecimals(signer, token);
    const amountUnits = await amountToUnits(
      signer,
      token,
      String(costHuman),
      decimals,
    );
    const availableHuman = await unitsToAmount(
      signer,
      token,
      amountUnits.toString(),
      decimals,
    );
    const minLockSeconds = durationSeconds + 3600; // node getMinLockTime margin

    const validation = await escrow.verifyFundsForEscrowPayment(
      token,
      payee,
      availableHuman,
      amountUnits.toString(),
      String(minLockSeconds),
      "10",
    );

    if (validation.isValid === false) {
      console.error(chalk.red(`Escrow check failed: ${validation.message}`));
      console.error(
        chalk.yellow(
          `  → deposit funds:  npm run cli depositEscrow ${token} <amount>\n` +
            `  → authorize node: npm run cli authorizeEscrow ${token} ${payee} <maxLockedAmount> <maxLockSeconds> <maxLockCounts>\n` +
            `    (maxLockSeconds must be at least ${minLockSeconds} = duration + 3600)`,
        ),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(chalk.red("Error verifying escrow funds:"), error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4.7 Status polling
// ---------------------------------------------------------------------------

export async function pollServiceStatus(
  nodeUrl: string,
  signer: Signer,
  serviceId: string,
  target: ServiceStatusNumber,
  timeoutMs = 600_000,
  notContainerId?: string,
): Promise<ServiceJob> {
  const started = Date.now();
  let lastStatus: number | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let jobs: ServiceJob[] = [];
    try {
      jobs = await ProviderInstance.getServiceStatus(
        nodeUrl,
        signer,
        serviceId,
      );
    } catch (error) {
      // Transient errors while polling should not abort the whole wait.
      console.log(
        chalk.yellow(
          `  (temporary error fetching status: ${
            (error as Error)?.message ?? error
          })`,
        ),
      );
    }

    const job = (jobs ?? []).find((j) => j.serviceId === serviceId);
    if (job) {
      if (job.status !== lastStatus) {
        lastStatus = job.status;
        console.log(
          `  Status: ${colorForStatus(
            job.status,
            statusLabel(job.status, job.statusText),
          )} (${job.status})`,
        );
      }

      const matchesContainer =
        !notContainerId || job.containerId !== notContainerId;

      if (job.status === target && matchesContainer) {
        return job;
      }

      if (TERMINAL_FAILURE_STATUSES.includes(job.status)) {
        throw new Error(
          `Service ${serviceId} failed: ${statusLabel(
            job.status,
            job.statusText,
          )} (${job.status})`,
        );
      }
    }

    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out after ${Math.round(
          timeoutMs / 1000,
        )}s waiting for service ${serviceId} to reach ${statusLabel(target)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// ---------------------------------------------------------------------------
// 4.8 Job pretty-printer
// ---------------------------------------------------------------------------

// Safe ISO expiry rendering: never throws on undefined/zero/invalid values.
export function formatExpiry(ms?: number): string {
  return typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : "n/a";
}

function relativeTime(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 60) return diff >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  const label = `${hours}h${rem ? ` ${rem}m` : ""}`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export function printServiceJob(
  job: ServiceJob,
  opts?: { verbose?: boolean },
): void {
  const header = colorForStatus(
    job.status,
    statusLabel(job.status, job.statusText),
  );
  console.log(`\nService ${chalk.bold(job.serviceId)}   [${header}]`);
  console.log(`  environment: ${job.environment}    owner: ${job.owner}`);

  const imageSpec = job.tag
    ? `${job.image}:${job.tag}`
    : job.checksum
      ? `${job.image}@${job.checksum}`
      : job.image;
  console.log(`  image: ${imageSpec}`);

  const expires =
    typeof job.expiresAt === "number" && job.expiresAt > 0
      ? `${formatExpiry(job.expiresAt)}  (${relativeTime(job.expiresAt)})`
      : "n/a";
  console.log(`  created: ${job.dateCreated}   expires: ${expires}`);

  if (job.endpoints?.length) {
    console.log("  endpoints:");
    for (const ep of job.endpoints) {
      console.log(
        `    → ${chalk.green(ep.url)}   (container port ${ep.containerPort})`,
      );
    }
  } else {
    console.log("  endpoints: (not yet assigned — poll getServiceStatus)");
  }

  const p = job.payment ?? {};
  const paymentBits = [
    p.cost !== undefined ? `cost ${p.cost}` : null,
    p.token ? `token ${p.token}` : null,
    p.lockTx ? `lockTx ${p.lockTx}` : null,
    p.claimTx ? `claimTx ${p.claimTx}` : null,
  ].filter(Boolean);
  const extendCount = job.extendPayments?.length ?? 0;
  console.log(
    `  payment: ${paymentBits.join(" ") || "n/a"}${
      extendCount ? `   extends: ${extendCount}` : ""
    }`,
  );

  if (opts?.verbose) {
    console.log(util.inspect(job, false, null, true));
  }
}
