// searchResourcesHelpers.ts
//
// Pure, network-free helpers for the `searchComputeResources` command: turning CLI flags
// (or wizard answers) into a typed request, and turning the provider matches returned by
// `ProviderInstance.findComputeProviders` into ordered, printable rows. Kept free of
// enquirer/figlet and of any I/O so it can be unit-tested with fabricated environments
// (see test/searchResources.unit.test.ts), the way resolveComputeInputs is.

import chalk from "chalk";
import {
  ComputeEnvironment,
  ComputeProviderMatch,
  ComputeResource,
} from "@oceanprotocol/lib";
import { estimateServiceCost } from "./serviceHelpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchMode = "free" | "paid" | "both";
export type SearchOrderBy = "price" | "freeCapacity" | "resources" | "leastBusy";

export interface ResourceDimension {
  resource: string;
  value: number;
}

export interface ResourceSearchParams {
  // One entry per requested resource dimension (AND-ed together by the DHT lookup).
  resources: ResourceDimension[];
  // Optional per-resource verification qualifier, e.g. { gpu: "A100" }.
  models?: Record<string, string>;
  mode: SearchMode;
  // Paid/both only. Defaults to the RPC chainId when the user does not override it.
  chainId?: number;
  token?: string; // optional payment-token filter
  maxPrice?: number; // optional cap on estimated cost (human units)
  durationSeconds?: number; // assumed job duration for cost estimate/ordering
  orderBy: SearchOrderBy;
}

// A single (provider, environment) pairing, decorated with the values we order/print by.
export interface ProviderEnvRow {
  nodeId: string;
  multiaddrs: string[];
  env: ComputeEnvironment;
  tier: "free" | "paid";
  estCost: number | null; // estimated cost in human units (paid), or null when unpriced
  token?: string; // the token estCost was computed for
  acceptedTokens: string[]; // payment-token addresses the env accepts on the requested chain
  pricedOnChains: string[]; // every chainId the env advertises pricing for
  freeCapacity: number; // sum of available capacity for requested dims (free tier)
  availableResources: number; // sum of (max - inUse) for requested dims
  runningJobs: number;
  queuedJobs: number;
}

// ---------------------------------------------------------------------------
// Flag parsing / param building (non-interactive path)
// ---------------------------------------------------------------------------

const RESOURCE_NAME_RE = /^[a-z0-9_-]+$/;

function toPositiveNumber(name: string, raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return n;
}

// Parse repeated `--resource name:amount` specs (e.g. ["fpga:2","tpu:1"]).
export function parseResourceSpecs(specs: string[] | undefined): ResourceDimension[] {
  if (!specs || specs.length === 0) return [];
  return specs.map((spec) => {
    const idx = spec.lastIndexOf(":");
    if (idx <= 0) {
      throw new Error(`--resource "${spec}" must be name:amount, e.g. fpga:2`);
    }
    const resource = spec.slice(0, idx).trim().toLowerCase();
    if (!RESOURCE_NAME_RE.test(resource)) {
      throw new Error(
        `--resource name "${resource}" is invalid (use letters, digits, "-" or "_")`,
      );
    }
    return { resource, value: toPositiveNumber(`--resource ${resource}`, spec.slice(idx + 1)) };
  });
}

// Shape of the Commander options object the action forwards here.
export interface SearchFlags {
  cpu?: string;
  ram?: string;
  disk?: string;
  gpu?: string;
  gpuModel?: string;
  resource?: string[];
  free?: boolean;
  paid?: boolean;
  both?: boolean;
  chain?: string;
  token?: string;
  maxPrice?: string;
  duration?: string;
  orderBy?: string;
}

// True when the user supplied enough on the command line to skip the wizard.
export function hasSearchFlags(flags: SearchFlags): boolean {
  return Boolean(
    flags.cpu ||
      flags.ram ||
      flags.disk ||
      flags.gpu ||
      (flags.resource && flags.resource.length > 0),
  );
}

function resolveMode(flags: SearchFlags): SearchMode {
  if (flags.both) return "both";
  if (flags.free && flags.paid) return "both";
  if (flags.free) return "free";
  if (flags.paid) return "paid";
  return "both"; // default when neither tier is specified
}

const ORDER_BY_VALUES: SearchOrderBy[] = [
  "price",
  "freeCapacity",
  "resources",
  "leastBusy",
];

function resolveOrderBy(raw: string | undefined, mode: SearchMode): SearchOrderBy {
  if (raw) {
    if (!ORDER_BY_VALUES.includes(raw as SearchOrderBy)) {
      throw new Error(`--order-by must be one of: ${ORDER_BY_VALUES.join(", ")}`);
    }
    return raw as SearchOrderBy;
  }
  // Sensible default: paid searches care about price, free ones about capacity.
  return mode === "free" ? "freeCapacity" : "price";
}

export function buildParamsFromFlags(
  flags: SearchFlags,
  defaultChainId: number,
): ResourceSearchParams {
  const resources: ResourceDimension[] = [];
  if (flags.cpu) resources.push({ resource: "cpu", value: toPositiveNumber("--cpu", flags.cpu) });
  if (flags.ram) resources.push({ resource: "ram", value: toPositiveNumber("--ram", flags.ram) });
  if (flags.disk)
    resources.push({ resource: "disk", value: toPositiveNumber("--disk", flags.disk) });
  if (flags.gpu) resources.push({ resource: "gpu", value: toPositiveNumber("--gpu", flags.gpu) });
  resources.push(...parseResourceSpecs(flags.resource));

  if (resources.length === 0) {
    throw new Error(
      "No resources requested. Pass at least one of --cpu/--ram/--disk/--gpu/--resource, or run without flags for the interactive wizard.",
    );
  }

  const mode = resolveMode(flags);
  const models = flags.gpuModel ? { gpu: flags.gpuModel } : undefined;

  return {
    resources,
    models,
    mode,
    chainId: flags.chain ? Number(flags.chain) : defaultChainId,
    token: flags.token,
    maxPrice: flags.maxPrice ? toPositiveNumber("--max-price", flags.maxPrice) : undefined,
    durationSeconds: flags.duration
      ? toPositiveNumber("--duration", flags.duration)
      : undefined,
    orderBy: resolveOrderBy(flags.orderBy, mode),
  };
}

// ---------------------------------------------------------------------------
// Resource matching (mirrors the lib's verification predicate, for display)
// ---------------------------------------------------------------------------

// Does a resource entry satisfy a requested dimension name? Matches by id or type, and
// treats a trailing "-N" on the id as the same family (so `gpu-0` answers `gpu`) — the
// same rule the lib applies during verification.
function resourceMatches(r: ComputeResource, name: string): boolean {
  const want = name.toLowerCase();
  const id = r.id?.toLowerCase();
  const type = r.type?.toLowerCase();
  if (id === want || type === want) return true;
  return id !== undefined && id.replace(/-\d+$/, "") === want;
}

// The resources an env exposes for a given tier (paid = top-level, free = env.free).
function tierResources(env: ComputeEnvironment, tier: "free" | "paid"): ComputeResource[] {
  return (tier === "free" ? env.free?.resources : env.resources) ?? [];
}

function sumFor(
  env: ComputeEnvironment,
  tier: "free" | "paid",
  dims: ResourceDimension[],
  pick: (r: ComputeResource) => number,
): number {
  const resources = tierResources(env, tier);
  return dims.reduce((sum, dim) => {
    const matches = resources.filter((r) => resourceMatches(r, dim.resource));
    return sum + matches.reduce((s, r) => s + pick(r), 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// Row building + ordering
// ---------------------------------------------------------------------------

// Cost of an env for the requested dims, in human units, or null when it cannot be priced
// in the requested/each accepted token. When no token is fixed, returns the cheapest.
function priceEnv(
  env: ComputeEnvironment,
  params: ResourceSearchParams,
): { cost: number | null; token?: string } {
  if (params.chainId === undefined) return { cost: null };
  const duration = params.durationSeconds ?? 3600;
  const amounts = params.resources.map((d) => ({ id: d.resource, amount: d.value }));

  const schedules = env.fees?.[String(params.chainId)] ?? [];
  const tokens = params.token
    ? [params.token]
    : schedules.map((s) => s.feeToken);

  let best: { cost: number; token: string } | null = null;
  for (const token of tokens) {
    const cost = estimateServiceCost(env, params.chainId, token, amounts, duration);
    if (cost === null) continue;
    if (best === null || cost < best.cost) best = { cost, token };
  }
  return best ? { cost: best.cost, token: best.token } : { cost: null };
}

// Flatten one search's provider matches into decorated rows for the given tier.
export function buildRows(
  matches: ComputeProviderMatch[],
  tier: "free" | "paid",
  params: ResourceSearchParams,
): ProviderEnvRow[] {
  const rows: ProviderEnvRow[] = [];
  for (const match of matches) {
    const multiaddrs = (match.node.multiaddress ?? []).map((m) => m.toString());
    for (const env of match.environments) {
      const { cost, token } = tier === "paid" ? priceEnv(env, params) : { cost: null, token: undefined };
      const chainKey = params.chainId !== undefined ? String(params.chainId) : undefined;
      const acceptedTokens =
        tier === "paid" && chainKey
          ? (env.fees?.[chainKey] ?? []).map((s) => s.feeToken)
          : [];
      const pricedOnChains = tier === "paid" ? Object.keys(env.fees ?? {}) : [];
      rows.push({
        nodeId: match.node.nodeId,
        multiaddrs,
        env,
        tier,
        estCost: cost,
        token,
        acceptedTokens,
        pricedOnChains,
        freeCapacity: sumFor(env, "free", params.resources, (r) => r.max ?? 0),
        availableResources: sumFor(
          env,
          tier,
          params.resources,
          (r) => (r.max ?? 0) - (r.inUse ?? 0),
        ),
        runningJobs: env.runningJobs ?? 0,
        queuedJobs: env.queuedJobs ?? 0,
      });
    }
  }
  return rows;
}

// When the user pins a specific payment token, keep only paid envs that actually accept it
// on the requested chain. Free rows have no token concept and are left untouched.
export function filterByToken(
  rows: ProviderEnvRow[],
  token?: string,
): ProviderEnvRow[] {
  if (!token) return rows;
  const want = token.toLowerCase();
  return rows.filter(
    (row) =>
      row.tier !== "paid" ||
      row.acceptedTokens.some((t) => t.toLowerCase() === want),
  );
}

// Apply the optional maxPrice cap. Only meaningful for priced rows.
export function applyMaxPrice(
  rows: ProviderEnvRow[],
  maxPrice?: number,
): ProviderEnvRow[] {
  if (maxPrice === undefined) return rows;
  return rows.filter((row) => row.estCost !== null && row.estCost <= maxPrice);
}

export function orderRows(
  rows: ProviderEnvRow[],
  orderBy: SearchOrderBy,
): ProviderEnvRow[] {
  const sorted = [...rows];
  switch (orderBy) {
    case "price":
      // Priced rows ascending; unpriced rows last.
      sorted.sort((a, b) => {
        if (a.estCost === null && b.estCost === null) return 0;
        if (a.estCost === null) return 1;
        if (b.estCost === null) return -1;
        return a.estCost - b.estCost;
      });
      break;
    case "freeCapacity":
      sorted.sort((a, b) => b.freeCapacity - a.freeCapacity);
      break;
    case "resources":
      sorted.sort((a, b) => b.availableResources - a.availableResources);
      break;
    case "leastBusy":
      sorted.sort(
        (a, b) => a.runningJobs + a.queuedJobs - (b.runningJobs + b.queuedJobs),
      );
      break;
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// A stable, machine-parseable one-liner per row (mirrors getComputeEnvironments' style),
// so tests and scripts can assert on results without parsing the pretty block.
export function providerSummaryLine(row: ProviderEnvRow): string {
  const price =
    row.estCost !== null ? `${row.estCost}${row.token ? ` ${row.token}` : ""}` : "n/a";
  return `PROVIDER node=${row.nodeId} env=${row.env.id} tier=${row.tier} price=${price} freeCapacity=${row.freeCapacity} available=${row.availableResources} running=${row.runningJobs} queued=${row.queuedJobs}`;
}

// Generic resource `kind`s that only say whether a resource is a divisible pool
// (cpu/ram/disk) — no use to a reader, so they are dropped from the description. A
// meaningful kind (e.g. a GPU model) or an explicit `description` is still shown.
const GENERIC_KINDS = new Set(["fungible", "non-fungible", "nonfungible"]);

// A useful per-resource label: the description, plus the kind only when it adds
// something beyond bare fungibility. Empty string when there is nothing worth showing.
function resourceLabel(r: ComputeResource): string {
  const kind = r.kind && !GENERIC_KINDS.has(r.kind.toLowerCase()) ? r.kind : "";
  return [r.description, kind].filter(Boolean).join(" ");
}

// Human-readable, per-resource detail for a row, including gpu kind/description.
export function describeRowResources(row: ProviderEnvRow, params: ResourceSearchParams): string {
  const resources = tierResources(row.env, row.tier);
  return params.resources
    .map((dim) => {
      const matches = resources.filter((r) => resourceMatches(r, dim.resource));
      const have = matches.reduce((s, r) => s + (r.max ?? 0), 0);
      const desc = matches
        .map(resourceLabel)
        .filter(Boolean)
        .join(", ");
      return `${dim.resource}: need ${dim.value}, max ${have}${desc ? ` (${desc})` : ""}`;
    })
    .join("  |  ");
}

// Render a token address with its symbol when known (e.g. "0x… (OCEAN)").
function tokenDisplay(addr: string, symbols?: Map<string, string>): string {
  const sym = symbols?.get(addr.toLowerCase());
  return sym ? `${addr} (${sym})` : addr;
}

export function printRows(
  rows: ProviderEnvRow[],
  params: ResourceSearchParams,
  symbols?: Map<string, string>,
): void {
  if (rows.length === 0) return;
  console.log(chalk.cyan(`\nFound ${rows.length} matching environment(s):\n`));
  for (const row of rows) {
    console.log(
      `${chalk.bold(row.nodeId)}  ${chalk.gray(`[${row.tier}]`)}  env ${chalk.green(row.env.id)}`,
    );
    console.log(`  ${describeRowResources(row, params)}`);
    if (row.tier === "paid") {
      if (row.estCost !== null) {
        console.log(
          `  estimated cost: ${row.estCost} ${tokenDisplay(row.token ?? "", symbols)}`,
        );
      }
      if (row.acceptedTokens.length) {
        // Show every token the env accepts on this chain (address + symbol) so the
        // user knows their payment options — required when they searched "all tokens".
        console.log(
          `  accepted tokens (chain ${params.chainId}): ${row.acceptedTokens
            .map((t) => tokenDisplay(t, symbols))
            .join(", ")}`,
        );
      } else {
        // No fee schedule for the requested chain: point at the chains it does price on.
        const others = row.pricedOnChains.filter(
          (c) => c !== String(params.chainId),
        );
        console.log(
          others.length
            ? chalk.yellow(
                `  no pricing on chain ${params.chainId}; this env prices on chain(s): ${others.join(
                  ", ",
                )} — re-run with --chain <id>`,
              )
            : chalk.yellow("  no pricing information advertised"),
        );
      }
    }
    console.log(
      `  jobs: ${row.runningJobs} running, ${row.queuedJobs} queued   consumer: ${row.env.consumerAddress}`,
    );
    if (row.multiaddrs.length) {
      console.log(`  addresses: ${row.multiaddrs.join(", ")}`);
    }
    console.log(chalk.gray(`  ${providerSummaryLine(row)}`));
    console.log("");
  }
  console.log(
    chalk.yellow(
      "Tip: select a provider with  setNode <peerId>  then run compute with  startCompute --env <envId> ...",
    ),
  );
}
