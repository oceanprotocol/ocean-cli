// Runtime RPC registry — the single in-process source of truth for RPC endpoints,
// providers, signers and per-chain contract config. Mirrors the pattern
// `nodeConnection.ts` uses for the Ocean Node: seeded from the environment at
// startup, memoized, torn down on exit.
//
// Phase 1 scope: one active chain (legacy single-URL preserved byte-for-byte), plus
// multi-URL `FallbackProvider` fallback and off-Barge contract-address resolution via
// ocean.js `ConfigHelper`. Runtime chain-management commands + persistence land in
// Phase 2.
import {
  AbstractProvider,
  FallbackProvider,
  JsonRpcProvider,
  Network,
  Signer,
  Wallet,
} from "ethers";
import { Config, ConfigHelper } from "@oceanprotocol/lib";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";

// Per-backend stall timeout: a slow endpoint hands off to the next instead of hanging.
const STALL_TIMEOUT_MS = 1000;

const RPC_EXAMPLE =
  'a single URL (e.g. "http://localhost:8545") or a JSON map keyed by chainId ' +
  '(e.g. {"1":"https://eth.example","8453":["https://a","https://b"]}).';

export interface ChainRpc {
  chainId: number;
  urls: string[];
}

export interface ParsedRpc {
  // Set when RPC was a single URL string (chainId discovered later by probing).
  legacyUrl?: string;
  // Set (possibly empty) when RPC was a JSON map keyed by chainId.
  chains: Map<number, string[]>;
}

// ---------------------------------------------------------------------------
// Registry state (module-level singletons).
// ---------------------------------------------------------------------------
const chainUrls = new Map<number, string[]>();
const providerCache = new Map<number, AbstractProvider>();
const signerCache = new Map<number, Signer>();
const configCache = new Map<number, Config>();
const verifiedChains = new Set<number>();
let defaultChainId: number | undefined;
let pendingLegacyUrl: string | undefined;
let loaded = false;
let loadedRpcRaw: string | undefined;

// Test seam: how a URL's real chainId is probed. Overridable so the unit tests can
// exercise the verification logic without a live network.
export type ChainProbe = (url: string) => Promise<number>;
async function defaultChainProbe(url: string): Promise<number> {
  const probe = new JsonRpcProvider(url);
  try {
    const hex = await probe.send("eth_chainId", []);
    return Number(hex);
  } finally {
    probe.destroy?.();
  }
}
let chainProbe: ChainProbe = defaultChainProbe;

// ---------------------------------------------------------------------------
// RPC env parsing (backwards compatible).
// ---------------------------------------------------------------------------
function isValidRpcUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const u = new URL(value.trim());
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol);
  } catch {
    return false;
  }
}

function dedupePreserveOrder(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const u = url.trim();
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

// Non-chain keys tolerated inside a chain map object (the persisted file stores the
// active default alongside the chains); callers strip these before validating chains.
const RESERVED_MAP_KEYS = new Set(["defaultChainId"]);

// Validate + normalize a plain object of chainId->url(s) into a deduped, order-preserving
// Map. Shared by the RPC env parser and the persisted-file loader.
function parseChainMapObject(
  parsed: unknown,
  opts: { requireNonEmpty: boolean },
): Map<number, string[]> {
  if (Array.isArray(parsed)) {
    throw new Error(
      `RPC JSON must be an object keyed by chainId, not an array. Provide ${RPC_EXAMPLE}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`RPC JSON must be an object. Provide ${RPC_EXAMPLE}`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>).filter(
    ([k]) => !RESERVED_MAP_KEYS.has(k),
  );
  if (opts.requireNonEmpty && entries.length === 0) {
    throw new Error(`RPC JSON map is empty. Provide ${RPC_EXAMPLE}`);
  }
  const chains = new Map<number, string[]>();
  for (const [key, value] of entries) {
    const chainId = Number(key);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error(
        `Invalid chainId key "${key}" in RPC map; keys must be positive integers. Provide ${RPC_EXAMPLE}`,
      );
    }
    let urls: unknown[];
    if (typeof value === "string") urls = [value];
    else if (Array.isArray(value)) urls = value;
    else
      throw new Error(
        `RPC entry for chain ${chainId} must be a URL string or a non-empty array of URL strings. Provide ${RPC_EXAMPLE}`,
      );
    if (urls.length === 0) {
      throw new Error(
        `RPC entry for chain ${chainId} is empty; give at least one URL. Provide ${RPC_EXAMPLE}`,
      );
    }
    for (const u of urls) {
      if (!isValidRpcUrl(u)) {
        throw new Error(
          `RPC entry for chain ${chainId} has an invalid URL (${JSON.stringify(
            u,
          )}); expected an http(s)/ws(s) URL. Provide ${RPC_EXAMPLE}`,
        );
      }
    }
    chains.set(chainId, dedupePreserveOrder(urls as string[]));
  }
  return chains;
}

// Parse the `RPC` env value into either a legacy single URL or a chainId->urls map.
// Throws with a clear, example-bearing message on any malformed shape. The unset
// message is kept verbatim ("Have you forgot to set env RPC?") because it is asserted
// by test/setup.test.ts.
export function parseRpcEnv(raw?: string): ParsedRpc {
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    throw new Error("Have you forgot to set env RPC?");
  }
  const trimmed = raw.trim();

  // Legacy single-URL form: anything not starting with { or [ is one URL verbatim.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    if (!isValidRpcUrl(trimmed)) {
      throw new Error(
        `RPC "${trimmed}" is not a valid http(s)/ws(s) URL. Provide ${RPC_EXAMPLE}`,
      );
    }
    return { legacyUrl: trimmed, chains: new Map() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `RPC looks like JSON but could not be parsed. Provide ${RPC_EXAMPLE}`,
    );
  }

  const chains = parseChainMapObject(parsed, { requireNonEmpty: true });
  return { legacyUrl: undefined, chains };
}

// ---------------------------------------------------------------------------
// Registry lifecycle.
// ---------------------------------------------------------------------------

// Synchronously tear down every cached provider and clear all memo maps.
function teardownProviders(): void {
  for (const provider of providerCache.values()) {
    try {
      (provider as { destroy?: () => void }).destroy?.();
    } catch {
      // best effort — never let teardown throw
    }
  }
  providerCache.clear();
  signerCache.clear();
  configCache.clear();
  verifiedChains.clear();
  chainUrls.clear();
}

// ---------------------------------------------------------------------------
// Persistence — runtime-added chains survive a restart (~/.ocean/cli/rpc.json,
// overridable via RPC_CONFIG_FILE). Same JSON-map shape as `RPC`, plus a top-level
// `defaultChainId`. All I/O is defensive: a persistence failure never breaks a command
// whose blockchain work already succeeded.
// ---------------------------------------------------------------------------
function persistFilePath(): string {
  return (
    process.env.RPC_CONFIG_FILE ||
    path.join(os.homedir(), ".ocean", "cli", "rpc.json")
  );
}

interface PersistedConfig {
  chains: Map<number, string[]>;
  defaultChainId?: number;
}

function readPersistedConfig(): PersistedConfig {
  const file = persistFilePath();
  let raw: string;
  try {
    if (!fs.existsSync(file)) return { chains: new Map() };
    raw = fs.readFileSync(file, "utf-8");
  } catch (e) {
    console.warn(
      chalk.yellow(
        `Could not read RPC config file ${file} (${
          (e as Error).message
        }) — ignoring it.`,
      ),
    );
    return { chains: new Map() };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const chains = parseChainMapObject(parsed, { requireNonEmpty: false });
    const dc = parsed.defaultChainId;
    const defaultChain =
      typeof dc === "number" && Number.isInteger(dc) && dc > 0 ? dc : undefined;
    return { chains, defaultChainId: defaultChain };
  } catch (e) {
    console.warn(
      chalk.yellow(
        `RPC config file ${file} is malformed (${
          (e as Error).message
        }) — ignoring it.`,
      ),
    );
    return { chains: new Map() };
  }
}

function persistConfig(): void {
  const file = persistFilePath();
  const obj: Record<string, unknown> = {};
  for (const [cid, urls] of chainUrls) obj[String(cid)] = urls;
  if (defaultChainId !== undefined) obj.defaultChainId = defaultChainId;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn(
      chalk.yellow(
        `Could not write RPC config file ${file} (${
          (e as Error).message
        }) — the chain change will not survive a restart.`,
      ),
    );
  }
}

// Seed the registry from the `RPC` env. Idempotent: repeated calls with an unchanged
// `RPC` are a no-op, so providers/signers are reused across REPL commands. Pass
// `force` to re-seed regardless.
export function loadRegistry(force = false): void {
  const raw = process.env.RPC;
  if (!force && loaded && raw === loadedRpcRaw) return;

  teardownProviders();
  defaultChainId = undefined;
  pendingLegacyUrl = undefined;

  const parsed = parseRpcEnv(raw);
  if (parsed.legacyUrl) {
    pendingLegacyUrl = parsed.legacyUrl;
  } else {
    for (const [cid, urls] of parsed.chains) chainUrls.set(cid, urls);
  }

  // Merge the persisted file (runtime-added chains survive a restart). Env wins on
  // conflict, so CI and env-driven runs stay deterministic regardless of what a prior
  // interactive session persisted.
  const persisted = readPersistedConfig();
  for (const [cid, urls] of persisted.chains) {
    if (!chainUrls.has(cid)) chainUrls.set(cid, urls);
  }

  // Default resolution (steps 1–2 of the plan; the node∩registry step needs node chains
  // and is resolved lazily by resolveDefaultChain). CHAIN_ID env → persisted default →
  // sole configured chain. A legacy single URL has no known chainId yet, so its default
  // is settled later by ensureDefaultChain's probe.
  const envDefault = process.env.CHAIN_ID
    ? Number(process.env.CHAIN_ID)
    : undefined;
  if (envDefault && chainUrls.has(envDefault)) {
    defaultChainId = envDefault;
  } else if (
    persisted.defaultChainId &&
    chainUrls.has(persisted.defaultChainId)
  ) {
    defaultChainId = persisted.defaultChainId;
  } else if (!pendingLegacyUrl && chainUrls.size === 1) {
    defaultChainId = [...chainUrls.keys()][0];
  }

  loaded = true;
  loadedRpcRaw = raw;
}

// Resolve the default (active) chain. For a legacy single URL the chainId is
// discovered by probing `getNetwork()` exactly as the old initializeSigner did, then
// the URL is registered under it. For a single-entry map, that entry is the default.
export async function ensureDefaultChain(): Promise<number> {
  if (!loaded) loadRegistry();
  if (defaultChainId !== undefined) return defaultChainId;

  if (pendingLegacyUrl) {
    const url = pendingLegacyUrl;
    const probe = new JsonRpcProvider(url);
    try {
      const { chainId } = await probe.getNetwork();
      const cid = Number(chainId);
      chainUrls.set(cid, [url]);
      // getNetwork() just confirmed the chain — no need to re-verify on first use.
      verifiedChains.add(cid);
      defaultChainId = cid;
      pendingLegacyUrl = undefined;
      return cid;
    } finally {
      probe.destroy?.();
    }
  }

  const keys = [...chainUrls.keys()];
  if (keys.length === 1) {
    defaultChainId = keys[0];
    return keys[0];
  }
  throw new Error(
    `No default chain configured. Configured chains: ${
      keys.join(", ") || "none"
    }.`,
  );
}

export function getDefaultChainId(): number | undefined {
  return defaultChainId;
}

export function setDefaultChainId(id: number): void {
  if (!chainUrls.has(id)) {
    throw new Error(
      `Cannot set default chain ${id}: it is not configured. Configured chains: ${
        listChains()
          .map((c) => c.chainId)
          .join(", ") || "none"
      }.`,
    );
  }
  defaultChainId = id;
  persistConfig();
}

// Full default-chain resolution (plan §"Default (active) chain"): explicit default
// (setChain / CHAIN_ID / persisted / sole chain) → the single chain that both the node
// serves and the registry knows → undefined. `nodeChains` is optional so the registry
// stays decoupled from the node; the CLI passes it in when it has node status.
export function resolveDefaultChain(nodeChains?: number[]): number | undefined {
  if (defaultChainId !== undefined) return defaultChainId;
  const keys = [...chainUrls.keys()];
  if (keys.length === 1) return keys[0];
  if (nodeChains && nodeChains.length > 0) {
    const intersection = keys.filter((k) => nodeChains.includes(k));
    if (intersection.length === 1) return intersection[0];
  }
  return undefined;
}

// The chain to sign chain-agnostic commands on. Prefers the real default; falls back to
// *any* registered chain purely to obtain a signer (plan §"Default chain" step 4) without
// committing it as the default. Probes a legacy single URL exactly as before.
export async function getActiveChainId(): Promise<number> {
  if (!loaded) loadRegistry();
  if (defaultChainId !== undefined) return defaultChainId;
  if (pendingLegacyUrl) return ensureDefaultChain();
  const keys = [...chainUrls.keys()];
  if (keys.length === 1) {
    defaultChainId = keys[0];
    return keys[0];
  }
  if (keys.length > 1) return keys[0]; // any — for signing only, not made the default
  throw new Error("No RPC chains configured.");
}

// Register a chain at runtime: verify EACH url actually serves `chainId` (probe
// eth_chainId), then store (dedup + order; ≥2 urls → FallbackProvider) and persist.
// Rejects a url on a different chain — the up-front verification the plan calls for.
export async function addChain(
  chainId: number,
  urls: string[],
): Promise<void> {
  if (!loaded) loadRegistry();
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid chainId ${chainId}: must be a positive integer.`);
  }
  const deduped = dedupePreserveOrder(urls.filter((u) => isValidRpcUrl(u)));
  if (deduped.length === 0) {
    throw new Error(
      `No valid http(s)/ws(s) RPC URL given for chain ${chainId}.`,
    );
  }
  for (const url of deduped) {
    let actual: number;
    try {
      actual = await chainProbe(url);
    } catch (e) {
      throw new Error(
        `Could not reach ${url} to verify chain ${chainId}: ${
          (e as Error).message
        }`,
        { cause: e },
      );
    }
    if (actual !== chainId) {
      throw new Error(
        `${url} serves chainId ${actual}, not ${chainId} — refusing to register it.`,
      );
    }
  }
  chainUrls.set(chainId, deduped);
  providerCache.delete(chainId);
  signerCache.delete(chainId);
  configCache.delete(chainId);
  verifiedChains.add(chainId); // just verified above
  if (chainUrls.size === 1) defaultChainId = chainId;
  persistConfig();
}

// Unregister a chain + persist. Refuses to remove the only configured chain (it would
// leave the CLI with nowhere to sign); clears the default if it pointed here.
export function removeChain(chainId: number): void {
  if (!loaded) loadRegistry();
  if (!chainUrls.has(chainId)) {
    throw new Error(
      `Chain ${chainId} is not configured. Configured chains: ${
        listChains()
          .map((c) => c.chainId)
          .join(", ") || "none"
      }.`,
    );
  }
  if (chainUrls.size === 1) {
    throw new Error(
      `Refusing to remove the only configured chain ${chainId}. Add another chain first.`,
    );
  }
  // A chain that comes from the `RPC` env var will be re-merged on the next startup
  // ("env wins" — a deliberate determinism decision), so removing it here is only for
  // this session unless the user also edits `RPC`. Warn rather than silently misleading.
  try {
    const fromEnv = parseRpcEnv(process.env.RPC);
    if (fromEnv.chains.has(chainId)) {
      console.warn(
        chalk.yellow(
          `Chain ${chainId} is listed in the RPC env var and will reappear on the next ` +
            `start (env config wins). Remove it from RPC to drop it permanently.`,
        ),
      );
    }
  } catch {
    // RPC unparseable/absent — nothing to warn about; proceed with the removal.
  }
  chainUrls.delete(chainId);
  providerCache.delete(chainId);
  signerCache.delete(chainId);
  configCache.delete(chainId);
  verifiedChains.delete(chainId);
  if (defaultChainId === chainId) {
    const remaining = [...chainUrls.keys()];
    defaultChainId = remaining.length === 1 ? remaining[0] : undefined;
  }
  persistConfig();
}

export function hasChain(chainId: number): boolean {
  return chainUrls.has(chainId);
}

export function listChains(): ChainRpc[] {
  return [...chainUrls.entries()].map(([chainId, urls]) => ({
    chainId,
    urls: [...urls],
  }));
}

// ---------------------------------------------------------------------------
// Provider / signer / config construction (memoized per chain).
// ---------------------------------------------------------------------------

// Pure, testable builder for the ethers v6 FallbackProvider arguments. Encodes the
// four easy-to-get-wrong points: quorum:1 (default would require agreement, the
// opposite of fallback), priority=index (declaration order = preference), a per-backend
// stallTimeout, and a staticNetwork on every inner provider (chainId is known from the
// map key, so construction doesn't depend on a backend being up right now).
export function buildFallbackConfigs(urls: string[], chainId: number) {
  const network = Network.from(chainId);
  const configs = urls.map((url, index) => ({
    provider: new JsonRpcProvider(url, network, { staticNetwork: network }),
    priority: index,
    stallTimeout: STALL_TIMEOUT_MS,
    weight: 1,
  }));
  return { configs, options: { quorum: 1 }, network };
}

export function getProvider(chainId: number): AbstractProvider {
  const cached = providerCache.get(chainId);
  if (cached) return cached;

  const urls = chainUrls.get(chainId);
  if (!urls || urls.length === 0) {
    throw new Error(
      `No RPC configured for chain ${chainId}. Configured chains: ${
        listChains()
          .map((c) => c.chainId)
          .join(", ") || "none"
      }.`,
    );
  }

  const network = Network.from(chainId);
  let provider: AbstractProvider;
  if (urls.length === 1) {
    provider = new JsonRpcProvider(urls[0], network, {
      staticNetwork: network,
    });
  } else {
    const { configs, options } = buildFallbackConfigs(urls, chainId);
    provider = new FallbackProvider(configs, network, options);
  }
  providerCache.set(chainId, provider);
  return provider;
}

// Verify the declared chain once, lazily, on first use. Confirmed-mismatched endpoints
// are dropped with a yellow warning; an endpoint unreachable right now is kept (the
// FallbackProvider fails over from it at runtime). Hard-error only if every endpoint is
// confirmed to be on the wrong chain — signing against the wrong chain is the worst
// failure this feature could introduce.
export async function verifyChain(chainId: number): Promise<void> {
  if (verifiedChains.has(chainId)) return;
  const urls = chainUrls.get(chainId);
  if (!urls || urls.length === 0) {
    throw new Error(`No RPC configured for chain ${chainId}.`);
  }

  const kept: string[] = [];
  for (const url of urls) {
    try {
      const actual = await chainProbe(url);
      if (actual === chainId) {
        kept.push(url);
      } else {
        console.warn(
          chalk.yellow(
            `RPC ${url} reports chainId ${actual}, expected ${chainId} — dropping it.`,
          ),
        );
      }
    } catch (e) {
      // Unreachable right now: keep it for runtime failover rather than dropping.
      console.warn(
        chalk.yellow(
          `RPC ${url} for chain ${chainId} could not be verified now (${
            (e as Error).message
          }) — keeping it for runtime failover.`,
        ),
      );
      kept.push(url);
    }
  }

  if (kept.length === 0) {
    throw new Error(
      `Every configured RPC for chain ${chainId} reports a different chainId — refusing to sign.`,
    );
  }
  if (kept.length !== urls.length) {
    chainUrls.set(chainId, kept);
    providerCache.delete(chainId);
  }
  verifiedChains.add(chainId);
}

// The Wallet credential logic mirrors the original initializeSigner() exactly:
// PRIVATE_KEY preferred, else MNEMONIC via Wallet.fromPhrase.
export async function getSigner(chainId: number): Promise<Signer> {
  const cached = signerCache.get(chainId);
  if (cached) return cached;

  await verifyChain(chainId);
  const provider = getProvider(chainId);

  let signer: Signer;
  if (process.env.PRIVATE_KEY) {
    signer = new Wallet(process.env.PRIVATE_KEY, provider);
  } else if (process.env.MNEMONIC) {
    signer = Wallet.fromPhrase(process.env.MNEMONIC, provider);
  } else {
    throw new Error("Have you forgot to set MNEMONIC or PRIVATE_KEY?");
  }

  signerCache.set(chainId, signer);
  return signer;
}

// Per-chain ocean.js config. `ConfigHelper` already resolves contract addresses from
// ADDRESS_FILE (Barge / custom) else the bundled multi-chain contracts, so this is the
// single source for escrow / accessListFactory / oceanTokenAddress.
export function getConfigFor(chainId: number): Config {
  const cached = configCache.get(chainId);
  if (cached) return cached;

  const config = new ConfigHelper().getConfig(chainId);
  if (config) {
    config.nodeUri = process.env.NODE_URL;
    configCache.set(chainId, config);
  }
  return config;
}

// Resolve a required contract address for a chain, or throw a clear, actionable error
// (instead of failing deep inside an ethers call on an undefined address).
export function requireAddress(
  chainId: number,
  field: "escrow" | "oceanTokenAddress" | "accessListFactory",
  label: string,
): string {
  const config = getConfigFor(chainId);
  const address = config?.[field];
  if (!address) {
    const hint =
      field === "oceanTokenAddress"
        ? "Pass --token <address> for this chain."
        : "Set ADDRESS_FILE to a deployment for this chain, or use a supported chain.";
    throw new Error(
      `${label} address not found for chain ${chainId}. ${hint} Configured chains: ${
        listChains()
          .map((c) => c.chainId)
          .join(", ") || "none"
      }.`,
    );
  }
  return address;
}

// Tear down every provider (they hold timers that keep the event loop alive) and reset
// the registry, for a clean process exit. Wired into index.ts alongside stopP2P().
export async function destroyProviders(): Promise<void> {
  teardownProviders();
  defaultChainId = undefined;
  pendingLegacyUrl = undefined;
  loaded = false;
  loadedRpcRaw = undefined;
}

// ---------------------------------------------------------------------------
// Test-only helpers.
// ---------------------------------------------------------------------------
export function __setChainProbeForTests(fn: ChainProbe | null): void {
  chainProbe = fn ?? defaultChainProbe;
}
export function __resetRegistryForTests(): void {
  teardownProviders();
  defaultChainId = undefined;
  pendingLegacyUrl = undefined;
  loaded = false;
  loadedRpcRaw = undefined;
}
