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
  sizeSharedResources,
  planGpuLayouts,
  grantableAmount,
} from "@oceanprotocol/lib";
import { getConfigFor } from "./rpcRegistry.js";

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
// (delegates to ocean.js's unit-aware ServiceResources helpers)
// ---------------------------------------------------------------------------
//
// ocean.js v10 replaced ServiceTemplatePublic.requiredResources with
// `recommendedResources`, and turned TemplateResourceRequirement into a
// discriminated union: cpu/ram/disk members carry `id` + `recommended` (cpu in
// `cores`, ram/disk in `GB`), while the GPU member carries `type: 'gpu'` +
// `layouts` and no `id`. Because ram/disk are now declared in GB while a
// compute environment reports those resources in bytes, matching must be
// unit-aware — so we lean on the library's `sizeSharedResources` /
// `planGpuLayouts` instead of comparing raw numbers.

// Narrows a requirement to its shared (cpu/ram/disk) member — the GPU member is
// the only one without an `id`.
type SharedRequirement = Extract<TemplateResourceRequirement, { id: string }>;
type GpuRequirement = Extract<TemplateResourceRequirement, { type: "gpu" }>;

function isSharedRequirement(
  req: TemplateResourceRequirement,
): req is SharedRequirement {
  return "id" in req;
}

// Whole units of a single shared requirement a new booking could still get.
// Only meaningful for cpu (cores) — ram/disk use byte-vs-GB sizing handled by
// the library — so this stays a best-effort display helper.
export function availableFor(
  env: ComputeEnvironment,
  req: TemplateResourceRequirement,
): number {
  const resources: ComputeResource[] = env.resources ?? [];
  if (isSharedRequirement(req)) {
    const r = resources.find((x) => x.id === req.id);
    return r ? grantableAmount(r) : 0;
  }
  return resources
    .filter((x) => x.type === "gpu")
    .reduce((sum, x) => sum + grantableAmount(x), 0);
}

// Human-readable reason a template does not fit an env (or null when it fits).
export function templateMismatchReason(
  env: ComputeEnvironment,
  template?: ServiceTemplatePublic,
): string | null {
  if (!template) return null;
  const reqs = template.recommendedResources ?? [];
  const resources = env.resources ?? [];

  // Shared cpu/ram/disk: unit-aware sizing (GB -> bytes) from the library.
  const shared = reqs.filter(isSharedRequirement);
  if (shared.length && sizeSharedResources(resources, shared) === null) {
    // cpu is the only id we can compare in like units for a precise message.
    const cpu = shared.find((r) => r.id === "cpu");
    if (cpu && availableFor(env, cpu) < cpu.recommended) {
      return `cpu: recommended ${cpu.recommended} ${cpu.unit}, available ${availableFor(
        env,
        cpu,
      )}`;
    }
    return "insufficient cpu/ram/disk for the template's recommended resources";
  }

  // GPU: layout planning from the library.
  const gpu = reqs.find((r): r is GpuRequirement => !isSharedRequirement(r));
  if (gpu) {
    const gpuResources = resources.filter((r) => r.type === "gpu");
    if (planGpuLayouts({ gpuResources, requirement: gpu }).length === 0) {
      return `gpu: no layout on this environment satisfies the template's recommended ${gpu.recommended} ${gpu.unit} per GPU`;
    }
  }
  return null;
}

export function envSatisfiesTemplate(
  env: ComputeEnvironment,
  template?: ServiceTemplatePublic,
): boolean {
  return templateMismatchReason(env, template) === null;
}

export function findServiceEnvironments(
  envs: ComputeEnvironment[],
  template?: ServiceTemplatePublic,
): ComputeEnvironment[] {
  return (envs ?? []).filter(
    (e) => e.features?.services !== false && envSatisfiesTemplate(e, template),
  );
}

// ---------------------------------------------------------------------------
// 4.3 Default resources from a template
// ---------------------------------------------------------------------------

export function resolveServiceResources(
  template: ServiceTemplatePublic | undefined,
  env: ComputeEnvironment,
): ComputeResourceRequest[] {
  // Unit-aware sizing of the template's recommended cpu/ram/disk against the
  // environment (converts the template's GB figures to the bytes the node
  // expects, and drops zero amounts). GPU layout selection, when needed, is
  // left to an explicit --resources selection.
  const sizing = sizeSharedResources(
    env.resources ?? [],
    template?.recommendedResources,
  );
  if (sizing && sizing.requests.length) {
    return sizing.requests;
  }
  // Fallback: a minimal cpu + ram request.
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
    const config = getConfigFor(chainId);
    if (!config?.escrow) {
      console.error(
        chalk.red(
          `Escrow contract address not found for chain ${chainId}. Set ADDRESS_FILE to a deployment for this chain, or use a supported chain.`,
        ),
      );
      return false;
    }
    const escrow = new EscrowContract(
      getAddress(config.escrow),
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
