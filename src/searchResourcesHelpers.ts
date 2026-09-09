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
  ComputeSearchDimensionResult,
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

// One chain to price/pay against, with an optional set of payment-token addresses to restrict
// to on THAT chain. An empty/absent `tokens` means "any token the env accepts on this chain".
export interface ChainFilter {
  chainId: number;
  tokens?: string[];
}

export interface ResourceSearchParams {
  // One entry per requested resource dimension (AND-ed together by the DHT lookup).
  resources: ResourceDimension[];
  // Optional per-resource verification qualifier, e.g. { gpu: "A100" }.
  models?: Record<string, string>;
  mode: SearchMode;
  // Paid/both only. One or more chains, each with an optional per-chain token filter. Pricing
  // is computed across all of them and the cheapest (chain, token) wins. Defaults to the RPC
  // chainId (no token filter) when the user does not override it.
  chains?: ChainFilter[];
  maxPrice?: number; // optional cap on estimated cost (human units)
  durationSeconds?: number; // assumed job duration for cost estimate/ordering
  orderBy: SearchOrderBy;
}

// Payment tokens an env accepts on one requested chain (already narrowed by that chain's token
// filter, if any), carried on a row for display.
export interface ChainTokens {
  chainId: number;
  tokens: string[];
}

// A single (provider, environment) pairing, decorated with the values we order/print by.
export interface ProviderEnvRow {
  nodeId: string;
  multiaddrs: string[];
  env: ComputeEnvironment;
  tier: "free" | "paid";
  estCost: number | null; // cheapest estimated cost across requested chains/tokens, or null
  token?: string; // the token estCost was computed for
  chainId?: number; // the chain estCost was computed on
  acceptedByChain: ChainTokens[]; // per requested chain, the (filtered) tokens the env accepts
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
    chains: buildChainsFromFlags(flags, defaultChainId),
    maxPrice: flags.maxPrice ? toPositiveNumber("--max-price", flags.maxPrice) : undefined,
    durationSeconds: flags.duration
      ? toPositiveNumber("--duration", flags.duration)
      : undefined,
    orderBy: resolveOrderBy(flags.orderBy, mode),
  };
}

// Split a comma-separated list into trimmed, non-empty entries.
function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Build the chain filters from flags. `--chain` is a comma-separated list of chainIds (each an
// integer); `--token` is a comma-separated list of token addresses applied as the filter on
// EVERY requested chain (per-chain token sets are only expressible through the wizard). With no
// `--chain`, fall back to the RPC chain. The `--token` filter still applies to that fallback.
function buildChainsFromFlags(
  flags: SearchFlags,
  defaultChainId: number,
): ChainFilter[] {
  const tokens = splitList(flags.token);
  const chainIds = splitList(flags.chain).map((c) => {
    const n = Number(c);
    if (!Number.isInteger(n)) {
      throw new Error(`--chain "${c}" is not an integer chainId`);
    }
    return n;
  });
  const ids = chainIds.length > 0 ? chainIds : [defaultChainId];
  return ids.map((chainId) => ({
    chainId,
    tokens: tokens.length > 0 ? tokens : undefined,
  }));
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

// The payment tokens an env accepts on one chain, narrowed to that chain's token filter when it
// has one (case-insensitive). Empty when the env does not price on the chain, or none match.
function acceptedTokensOnChain(
  env: ComputeEnvironment,
  chain: ChainFilter,
): string[] {
  const onChain = (env.fees?.[String(chain.chainId)] ?? []).map((s) => s.feeToken);
  if (!chain.tokens || chain.tokens.length === 0) return onChain;
  const want = new Set(chain.tokens.map((t) => t.toLowerCase()));
  return onChain.filter((t) => want.has(t.toLowerCase()));
}

// The cheapest priceable (token, cost) for an env on ONE chain, respecting that chain's token
// filter — or null when the env prices on the chain with no allowed token.
function priceEnvOnChain(
  env: ComputeEnvironment,
  chain: ChainFilter,
  params: ResourceSearchParams,
): { cost: number; token: string } | null {
  const duration = params.durationSeconds ?? 3600;
  const amounts = params.resources.map((d) => ({ id: d.resource, amount: d.value }));
  let best: { cost: number; token: string } | null = null;
  for (const token of acceptedTokensOnChain(env, chain)) {
    const cost = estimateServiceCost(env, chain.chainId, token, amounts, duration);
    if (cost === null) continue;
    if (best === null || cost < best.cost) best = { cost, token };
  }
  return best;
}

// Flatten one search's provider matches into decorated rows for the given tier.
//
// Fan-out: a PAID env is emitted once PER requested chain it can be priced on (each row carrying
// that chain's cheapest token/cost), so the same env can be compared across chains side by side.
// An env that prices on none of the requested chains still yields a single row (estCost null) so
// it surfaces with the "prices elsewhere" hint. Free envs are one row each.
export function buildRows(
  matches: ComputeProviderMatch[],
  tier: "free" | "paid",
  params: ResourceSearchParams,
): ProviderEnvRow[] {
  const rows: ProviderEnvRow[] = [];
  const chains = params.chains ?? [];
  for (const match of matches) {
    const multiaddrs = (match.node.multiaddress ?? []).map((m) => m.toString());
    for (const env of match.environments) {
      const shared = {
        nodeId: match.node.nodeId,
        multiaddrs,
        env,
        tier,
        freeCapacity: sumFor(env, "free", params.resources, (r) => r.max ?? 0),
        availableResources: sumFor(
          env,
          tier,
          params.resources,
          (r) => (r.max ?? 0) - (r.inUse ?? 0),
        ),
        runningJobs: env.runningJobs ?? 0,
        queuedJobs: env.queuedJobs ?? 0,
      };

      if (tier === "free") {
        rows.push({
          ...shared,
          estCost: null,
          token: undefined,
          chainId: undefined,
          acceptedByChain: [],
          pricedOnChains: [],
        });
        continue;
      }

      const pricedOnChains = Object.keys(env.fees ?? {});
      // One row per requested chain the env can actually be priced on.
      const pricedRows = chains.flatMap((chain) => {
        const priced = priceEnvOnChain(env, chain, params);
        if (!priced) return [];
        return [
          {
            ...shared,
            estCost: priced.cost,
            token: priced.token,
            chainId: chain.chainId,
            acceptedByChain: [
              { chainId: chain.chainId, tokens: acceptedTokensOnChain(env, chain) },
            ] as ChainTokens[],
            pricedOnChains,
          },
        ];
      });

      if (pricedRows.length > 0) {
        rows.push(...pricedRows);
      } else {
        // Not priceable on any requested chain: a single row that surfaces the env anyway.
        rows.push({
          ...shared,
          estCost: null,
          token: undefined,
          chainId: undefined,
          acceptedByChain: [],
          pricedOnChains,
        });
      }
    }
  }
  return rows;
}

// Does an env actually satisfy every requested resource dimension in its tier? The DHT lookup
// returns *all* of a matching node's environments — including ones whose resources fall short of
// the request (max < need) — so this is what drops those non-matching envs.
function rowMeetsResources(
  row: ProviderEnvRow,
  dims: ResourceDimension[],
): boolean {
  const resources = tierResources(row.env, row.tier);
  return dims.every((dim) => {
    const have = resources
      .filter((r) => resourceMatches(r, dim.resource))
      .reduce((s, r) => s + (r.max ?? 0), 0);
    return have >= dim.value;
  });
}

// Keep only rows that genuinely match the request, dropping everything that does not:
//   - any env whose resources do not meet the requested amounts (both tiers);
//   - any PAID env that could not be priced on one of the requested chains with an allowed token
//     (wrong chain, or the specified token(s) are not accepted) — its estCost is null.
// A "both" search's free rows are still kept regardless of chain/token, since those are paid-only
// concepts. When no chains are requested (defensive; paid always has at least the RPC chain),
// the chain/token check is skipped.
export function filterMatches(
  rows: ProviderEnvRow[],
  params: ResourceSearchParams,
): ProviderEnvRow[] {
  const hasChains = (params.chains?.length ?? 0) > 0;
  return rows.filter((row) => {
    if (!rowMeetsResources(row, params.resources)) return false;
    if (row.tier === "paid" && hasChains && row.estCost === null) return false;
    return true;
  });
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
    row.estCost !== null
      ? `${row.estCost}${row.token ? ` ${row.token}` : ""}${
          row.chainId !== undefined ? `@${row.chainId}` : ""
        }`
      : "n/a";
  return `PROVIDER node=${row.nodeId} env=${row.env.id} tier=${row.tier} price=${price} freeCapacity=${row.freeCapacity} available=${row.availableResources} running=${row.runningJobs} queued=${row.queuedJobs}`;
}

// When a search tier returns nothing, explain *why* per requested dimension instead of an
// opaque empty list: the bucket the lookup actually used and how many providers announced it
// (before verification/intersection). A dimension with zero announcers is the culprit; one
// with announcers that still yields no matches was dropped by verification or intersection.
export function printDimensionDiagnostics(
  tier: "free" | "paid",
  dimensions: ComputeSearchDimensionResult[] | undefined,
): void {
  console.log(
    chalk.yellow(`\nNo ${tier} providers matched. Per-resource breakdown:`),
  );
  for (const dim of dimensions ?? []) {
    const count = dim.providerIds?.length ?? 0;
    const partial = dim.partial ? ` (partial: ${dim.error ?? "lookup ended early"})` : "";
    console.log(
      `  ${dim.resource}: requested ${dim.value}, searched bucket ${dim.bucket}, ` +
        `${count} announcer(s)${partial}`,
    );
  }
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
  // Rows are (environment × chain) matches, so a paid env priced on several requested chains
  // appears once per chain — count matches, not distinct environments.
  console.log(chalk.cyan(`\nFound ${rows.length} match(es):\n`));
  for (const row of rows) {
    // First line is a ready-to-run command and NOTHING else (unstyled, no trailing tag) so the
    // whole line can be copy-pasted verbatim — a trailing token would become an extra argument.
    // The tier tag goes on the following line instead.
    console.log(`setNodeEnv ${row.nodeId}|${row.env.id}`);
    console.log(
      `  ${chalk.gray(`[${row.tier}]`)}  ${describeRowResources(row, params)}`,
    );
    if (row.tier === "paid") {
      if (row.estCost !== null) {
        // This row is one chain; the cost is the cheapest token on it.
        console.log(
          `  estimated cost: ${row.estCost} ${tokenDisplay(
            row.token ?? "",
            symbols,
          )} on chain ${row.chainId}`,
        );
      }
      // The (filtered) tokens the env accepts on this row's chain, so the user sees their full
      // payment options — not just the cheapest one named in the cost line above. Displayed rows
      // are always priced on a requested chain (non-matching rows were filtered out upstream).
      const onChain = row.acceptedByChain.find((c) => c.chainId === row.chainId);
      if (onChain && onChain.tokens.length) {
        console.log(
          `  accepted tokens (chain ${onChain.chainId}): ${onChain.tokens
            .map((t) => tokenDisplay(t, symbols))
            .join(", ")}`,
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
      "Tip: copy-paste a result's first line (the  setNodeEnv <node>|<env>  command) to select both at once, then run  startCompute ...  (the env is remembered, no --env needed).",
    ),
  );
}
