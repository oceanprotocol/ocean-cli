// ---------------------------------------------------------------------------
// Unified configuration file for the CLI.
//
// One per-user JSON file (``~/.ocean/cli/config.json`` by default, or
// ``OCEANCLI_CONFIG_PATH``) holds every setting the CLI used to take from
// environment variables, except the signer secrets ``PRIVATE_KEY`` / ``MNEMONIC``
// which are NEVER read from or written to the file.
//
// Precedence: CLI flag → env var → config file → built-in default. Scalars from the
// file are *hydrated* into ``process.env`` at startup (only when the env did not already
// provide them), so every existing ``process.env.*`` reader keeps working unchanged.
//
// This module imports ONLY node builtins + chalk. It must not import rpcRegistry.ts /
// nodeConnection.ts / cli.ts (they import it — avoid a cycle). All disk I/O is
// defensive: a failure warns and degrades to "this session only", never throws out.
// ---------------------------------------------------------------------------
import fs from "fs";
import os from "os";
import path from "path";
import chalk from "chalk";

export const CONFIG_VERSION = 1;

export interface FavouriteNode {
  node: string; // http(s) URL, peer id, or multiaddr
  description?: string;
}

export interface SubsidyProviderEntry {
  address: string; // EVM contract address, EIP-55 checksummed
  enabled: boolean;
  description?: string;
}

export interface ConfigFile {
  version?: number;
  nodeUrl?: string;
  computeEnvId?: string;
  rpc?: Record<string, string[] | string>;
  defaultChainId?: number;
  addressFile?: string;
  disableP2P?: boolean;
  bootstrapPeers?: string[];
  avoidLoopRun?: boolean;
  indexing?: { maxRetries?: number; retryIntervalMs?: number };
  searchTimeoutMs?: number;
  ssi?: { walletApi?: string; walletId?: string; walletDid?: string };
  favouriteNodes?: FavouriteNode[];
  subsidyProviders?: Record<string, SubsidyProviderEntry[]>;
  [unknownKey: string]: unknown;
}

export type ConfigValueType = "string" | "boolean" | "int" | "stringList";

export interface ConfigKey {
  key: string; // dotted path inside the file, e.g. "indexing.maxRetries"
  env: string; // env var it maps to
  type: ConfigValueType;
  min?: number; // for "int"
  defaultLabel: string; // text getConfig shows when neither env nor file sets it
  description: string;
  settable: boolean; // allowed in setConfig
  setHint?: string; // when !settable: which command to use instead
  nextStart?: boolean; // true → setConfig prints "takes effect on the next start"
}

// One entry per row of the §4.1 key table. ORDER MATTERS: nodeUrl must come before
// computeEnvId so the hydration "stale env id" exception can look at nodeUrl first.
export const CONFIG_KEYS: ConfigKey[] = [
  {
    key: "nodeUrl",
    env: "NODE_URL",
    type: "string",
    defaultLabel: "none",
    description: "Ocean Node used by subsequent commands (URL, peer id or multiaddr)",
    settable: false,
    setHint: "setNode <nodeUrl>",
  },
  {
    key: "computeEnvId",
    env: "COMPUTE_ENV_ID",
    type: "string",
    defaultLabel: "none",
    description: "Default compute environment id for the current node",
    settable: false,
    setHint: "setNodeEnv <node|env>",
  },
  {
    key: "addressFile",
    env: "ADDRESS_FILE",
    type: "string",
    defaultLabel: "ocean.js bundled addresses",
    description: "Path to a contracts address.json (Barge / custom deployments)",
    settable: true,
  },
  {
    key: "disableP2P",
    env: "DISABLE_P2P",
    type: "boolean",
    defaultLabel: "false",
    description: "Skip starting libp2p entirely",
    settable: true,
    nextStart: true,
  },
  {
    key: "bootstrapPeers",
    env: "BOOTSTRAP_PEERS",
    type: "stringList",
    defaultLabel: "none (built-in Ocean bootstrap nodes only)",
    description: "Extra libp2p bootstrap multiaddrs (comma-separated)",
    settable: true,
    nextStart: true,
  },
  {
    key: "avoidLoopRun",
    env: "AVOID_LOOP_RUN",
    type: "boolean",
    defaultLabel: "false",
    description: "Run one command and exit instead of entering the REPL loop",
    settable: true,
    nextStart: true,
  },
  {
    key: "indexing.maxRetries",
    env: "INDEXING_MAX_RETRIES",
    type: "int",
    min: 0,
    defaultLabel: "120",
    description: "How many times to poll for an asset to be indexed",
    settable: true,
  },
  {
    key: "indexing.retryIntervalMs",
    env: "INDEXING_RETRY_INTERVAL",
    type: "int",
    min: 0,
    defaultLabel: "4000",
    description: "Delay between indexing polls, in milliseconds",
    settable: true,
  },
  {
    key: "searchTimeoutMs",
    env: "SEARCH_TIMEOUT_MS",
    type: "int",
    min: 1,
    defaultLabel: "60000",
    description: "Timeout for node search requests, in milliseconds",
    settable: true,
  },
  {
    key: "ssi.walletApi",
    env: "SSI_WALLET_API",
    type: "string",
    defaultLabel: "none",
    description: "SSI wallet API base URL (enables policy-server verification)",
    settable: true,
  },
  {
    key: "ssi.walletId",
    env: "SSI_WALLET_ID",
    type: "string",
    defaultLabel: "none",
    description: "SSI wallet id",
    settable: true,
  },
  {
    key: "ssi.walletDid",
    env: "SSI_WALLET_DID",
    type: "string",
    defaultLabel: "none",
    description: "SSI wallet DID",
    settable: true,
  },
];

// ---------------------------------------------------------------------------
// §5.2 Path resolution
// ---------------------------------------------------------------------------
export function defaultConfigDir(): string {
  return path.join(os.homedir(), ".ocean", "cli");
}

// Re-reads the env on EVERY call (unit tests change OCEANCLI_CONFIG_PATH between tests).
export function configFilePath(): string {
  const override = process.env.OCEANCLI_CONFIG_PATH;
  if (typeof override === "string" && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.join(defaultConfigDir(), "config.json");
}

// Non-null when the resolved path exists and is a directory (a common foot-gun when
// OCEANCLI_CONFIG_PATH points at a folder); null otherwise (missing path included).
export function configPathProblem(): string | null {
  const file = configFilePath();
  try {
    if (fs.statSync(file).isDirectory()) {
      return `OCEANCLI_CONFIG_PATH (${file}) is a directory — it must point to a JSON file.`;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// §5.3 Reading
// ---------------------------------------------------------------------------
type ReadStatus = "missing" | "ok" | "corrupt" | "unreadable";

// Warn at most once per process for the same (path, reason) pair: readConfigFile is
// called many times per process and the warnings would otherwise repeat.
const warnedOnce = new Set<string>();
function warnOnce(key: string, message: string, color: "yellow" | "red"): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(color === "red" ? chalk.red(message) : chalk.yellow(message));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readRaw(): {
  status: ReadStatus;
  raw: Record<string, unknown>;
  error?: string;
} {
  const file = configFilePath();
  if (!fs.existsSync(file)) return { status: "missing", raw: {} };
  let text: string;
  try {
    if (fs.statSync(file).isDirectory()) {
      return { status: "unreadable", raw: {}, error: "path is a directory" };
    }
    text = fs.readFileSync(file, "utf-8");
  } catch (e) {
    return { status: "unreadable", raw: {}, error: (e as Error).message };
  }
  if (text.trim().length === 0) return { status: "ok", raw: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { status: "corrupt", raw: {}, error: (e as Error).message };
  }
  if (!isPlainObject(parsed)) {
    return { status: "corrupt", raw: {}, error: "top-level value is not an object" };
  }
  return { status: "ok", raw: parsed };
}

export function configFileStatus(): ReadStatus {
  return readRaw().status;
}

const SECRET_KEYS = ["privateKey", "mnemonic", "PRIVATE_KEY", "MNEMONIC"];

function sanitizeString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}
function sanitizeInt(v: unknown, min: number): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= min ? v : undefined;
}

// Reads the file and returns a NEW object with only known keys whose values pass
// validation. Prints the one-time warnings of §4. Unknown top-level keys are NOT
// returned here (they are preserved on rewrite because updateConfigFile patches a fresh
// raw read, not this sanitized view).
export function readConfigFile(): ConfigFile {
  const file = configFilePath();
  const { status, raw, error } = readRaw();

  if (status === "unreadable") {
    warnOnce(
      `${file}|unreadable`,
      `Could not read config file ${file} (${error}) — ignoring it.`,
      "yellow",
    );
    return {};
  }
  if (status === "corrupt") {
    warnOnce(
      `${file}|corrupt`,
      `Config file ${file} is not valid JSON (${error}) — ignoring it. It will be backed up, not overwritten, on the next save.`,
      "yellow",
    );
    return {};
  }
  if (status === "missing") return {};

  // Signer secrets: warn, never read, never delete.
  for (const k of SECRET_KEYS) {
    if (k in raw) {
      warnOnce(
        `${file}|secret:${k}`,
        `Config file ${file} contains "${k}". Signer secrets are never read from the config file — remove it and use the PRIVATE_KEY / MNEMONIC environment variable.`,
        "red",
      );
    }
  }

  // version check
  if (typeof raw.version === "number" && raw.version > CONFIG_VERSION) {
    warnOnce(
      `${file}|version`,
      `Config file ${file} has version ${raw.version}, newer than this CLI understands (${CONFIG_VERSION}); unknown settings are ignored.`,
      "yellow",
    );
  }

  // Flat legacy shape (chain ids at the top level, no rpc key).
  const topKeys = Object.keys(raw);
  if (
    raw.rpc === undefined &&
    topKeys.some((k) => /^\d+$/.test(k)) &&
    topKeys.filter((k) => /^\d+$/.test(k)).length > 0
  ) {
    warnOnce(
      `${file}|flatlegacy`,
      `Config file ${file} looks like an old rpc.json (chain ids at the top level). Move them under "rpc".`,
      "yellow",
    );
  }

  const badKey = (key: string, expected: string) =>
    warnOnce(
      `${file}|badkey:${key}`,
      `Config file ${file}: ignoring "${key}" (expected ${expected}).`,
      "yellow",
    );

  const out: ConfigFile = {};
  if (typeof raw.version === "number") out.version = raw.version;

  // Scalar hydratable keys.
  for (const entry of CONFIG_KEYS) {
    if (entry.key.includes(".")) continue; // nested handled below
    const v = raw[entry.key];
    if (v === undefined) continue;
    if (entry.type === "string") {
      const s = sanitizeString(v);
      if (s === undefined) badKey(entry.key, "a non-empty string");
      else (out as Record<string, unknown>)[entry.key] = s;
    } else if (entry.type === "boolean") {
      if (typeof v === "boolean") (out as Record<string, unknown>)[entry.key] = v;
      else badKey(entry.key, "true or false");
    } else if (entry.type === "int") {
      const n = sanitizeInt(v, entry.min ?? 0);
      if (n === undefined) badKey(entry.key, `an integer >= ${entry.min ?? 0}`);
      else (out as Record<string, unknown>)[entry.key] = n;
    } else if (entry.type === "stringList") {
      if (
        Array.isArray(v) &&
        v.every((x) => typeof x === "string" && x.trim().length > 0)
      ) {
        out[entry.key] = v as string[];
      } else badKey(entry.key, "an array of non-empty strings");
    }
  }

  // indexing { maxRetries, retryIntervalMs }
  if (raw.indexing !== undefined) {
    if (!isPlainObject(raw.indexing)) badKey("indexing", "an object");
    else {
      const idx: { maxRetries?: number; retryIntervalMs?: number } = {};
      const mr = raw.indexing.maxRetries;
      if (mr !== undefined) {
        const n = sanitizeInt(mr, 0);
        if (n === undefined) badKey("indexing.maxRetries", "an integer >= 0");
        else idx.maxRetries = n;
      }
      const ri = raw.indexing.retryIntervalMs;
      if (ri !== undefined) {
        const n = sanitizeInt(ri, 0);
        if (n === undefined) badKey("indexing.retryIntervalMs", "an integer >= 0");
        else idx.retryIntervalMs = n;
      }
      if (Object.keys(idx).length > 0) out.indexing = idx;
    }
  }

  // ssi { walletApi, walletId, walletDid }
  if (raw.ssi !== undefined) {
    if (!isPlainObject(raw.ssi)) badKey("ssi", "an object");
    else {
      const ssi: { walletApi?: string; walletId?: string; walletDid?: string } = {};
      for (const sub of ["walletApi", "walletId", "walletDid"] as const) {
        const val = raw.ssi[sub];
        if (val === undefined) continue;
        const s = sanitizeString(val);
        if (s === undefined) badKey(`ssi.${sub}`, "a non-empty string");
        else ssi[sub] = s;
      }
      if (Object.keys(ssi).length > 0) out.ssi = ssi;
    }
  }

  // rpc — keep the raw object; the registry validates its contents.
  if (raw.rpc !== undefined) {
    if (isPlainObject(raw.rpc)) out.rpc = raw.rpc as Record<string, string[] | string>;
    else badKey("rpc", "an object");
  }

  // defaultChainId — positive integer.
  if (raw.defaultChainId !== undefined) {
    const dc = raw.defaultChainId;
    if (typeof dc === "number" && Number.isInteger(dc) && dc > 0) {
      out.defaultChainId = dc;
    } else badKey("defaultChainId", "a positive integer");
  }

  // favouriteNodes — ordered array of { node, description? }. The per-item validity
  // rules live in sanitizeFavouriteEntries (shared with the mutators).
  if (raw.favouriteNodes !== undefined) {
    if (!Array.isArray(raw.favouriteNodes)) {
      badKey("favouriteNodes", "an array");
    } else {
      const favs = sanitizeFavouriteEntries(raw.favouriteNodes);
      if (favs.length !== raw.favouriteNodes.length) {
        badKey("favouriteNodes", "objects with a non-empty node");
      }
      if (favs.length > 0) out.favouriteNodes = favs;
    }
  }

  // subsidyProviders — { "<chainId>": [{ address, enabled, description? }] }. The
  // per-item validity rules live in sanitizeSubsidyEntries (shared with the mutators).
  if (raw.subsidyProviders !== undefined) {
    if (!isPlainObject(raw.subsidyProviders)) {
      badKey("subsidyProviders", "an object");
    } else {
      const map: Record<string, SubsidyProviderEntry[]> = {};
      let dropped = false;
      for (const [cid, list] of Object.entries(raw.subsidyProviders)) {
        if (!Array.isArray(list)) {
          dropped = true;
          continue;
        }
        const entries = sanitizeSubsidyEntries(list);
        if (entries.length !== list.length) dropped = true;
        if (entries.length > 0) map[cid] = entries;
      }
      if (dropped) {
        badKey("subsidyProviders", "objects with a non-empty address");
      }
      if (Object.keys(map).length > 0) out.subsidyProviders = map;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// §5.4 Startup: initConfig() + hydration
// ---------------------------------------------------------------------------
let initialized = false;
const envSnapshot = new Map<string, string>();
const hydrated = new Set<string>();

export function initConfig(allowLegacyImport = true): void {
  if (initialized) return;
  try {
    initialized = true;

    // Repair lax permissions on a pre-existing file before anything reads/trusts it
    // (it can hold RPC URLs with embedded API keys). No-op on a correctly-0600 file.
    repairConfigPermissions();

    // 2. Snapshot every env var we care about (presence is !== undefined, NOT truthy:
    //    AVOID_LOOP_RUN=false must count as provided and override avoidLoopRun:true).
    const names = [...CONFIG_KEYS.map((k) => k.env), "RPC", "CHAIN_ID"];
    for (const name of names) {
      const v = process.env[name];
      if (v !== undefined) envSnapshot.set(name, v);
    }

    // 3. Removed-variable warning.
    if (process.env.RPC_CONFIG_FILE) {
      console.warn(
        chalk.yellow(
          "RPC_CONFIG_FILE is no longer supported and is ignored — use OCEANCLI_CONFIG_PATH.",
        ),
      );
    }

    // 4. Legacy import of the default rpc.json (one-time). Skipped on a pure
    //    help/version invocation so `ocean-cli --help` never writes a file.
    if (allowLegacyImport) importLegacyRpcFile();

    // 5. Read the file.
    const file = readConfigFile();

    // 6. Hydrate: a file value fills its env var only when the env did not provide it.
    let nodeUrlHydrated = false;
    for (const entry of CONFIG_KEYS) {
      const value = getFileValue(file, entry.key);
      if (value === undefined) continue;
      if (process.env[entry.env] !== undefined) continue;

      // Stale env-id exception: a remembered COMPUTE_ENV_ID belongs to one node. Only
      // hydrate it when NODE_URL was hydrated from the file this pass, or the
      // env-provided NODE_URL equals the file's nodeUrl.
      if (entry.env === "COMPUTE_ENV_ID") {
        const envNode = originalEnvValue("NODE_URL");
        const sameNode = envNode !== undefined && envNode === file.nodeUrl;
        if (!nodeUrlHydrated && !sameNode) continue;
      }

      process.env[entry.env] = toEnvString(entry, value);
      hydrated.add(entry.env);
      if (entry.env === "NODE_URL") nodeUrlHydrated = true;
    }
  } catch (e) {
    console.warn(
      chalk.yellow(
        `Config file support disabled for this run: ${(e as Error).message}`,
      ),
    );
  }
}

export function isEnvProvided(envVar: string): boolean {
  if (initialized) return envSnapshot.has(envVar);
  return process.env[envVar] !== undefined;
}

export function originalEnvValue(envVar: string): string | undefined {
  return envSnapshot.get(envVar);
}

export function wasHydrated(envVar: string): boolean {
  return hydrated.has(envVar);
}

// ---------------------------------------------------------------------------
// §7.3 Legacy rpc.json import (private)
// ---------------------------------------------------------------------------
function importLegacyRpcFile(): void {
  const override = process.env.OCEANCLI_CONFIG_PATH;
  if (typeof override === "string" && override.trim().length > 0) return;

  const configPath = path.join(defaultConfigDir(), "config.json");
  if (fs.existsSync(configPath)) return;

  const rpcPath = path.join(defaultConfigDir(), "rpc.json");
  if (!fs.existsSync(rpcPath)) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(rpcPath, "utf-8"));
  } catch (e) {
    console.warn(
      chalk.yellow(`Could not import ${rpcPath} (${(e as Error).message}) — skipping.`),
    );
    return;
  }
  if (!isPlainObject(parsed)) return;

  const rpc: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!/^\d+$/.test(k)) continue;
    if (typeof v === "string") rpc[k] = [v];
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      rpc[k] = v as string[];
    }
  }
  const dc = parsed.defaultChainId;
  const defaultChainId =
    typeof dc === "number" && Number.isInteger(dc) && dc > 0 ? dc : undefined;

  if (Object.keys(rpc).length === 0 && defaultChainId === undefined) return;

  const ok = updateConfigFile((f) => {
    if (Object.keys(rpc).length > 0) f.rpc = rpc;
    if (defaultChainId !== undefined) f.defaultChainId = defaultChainId;
  });
  if (ok) {
    console.log(
      chalk.cyan(
        `Imported RPC chains from ${rpcPath} into ${configFilePath()}. The old file is no longer used — it may still contain RPC URLs with API keys, so delete it if you don't need it.`,
      ),
    );
  }
}

// Tighten a pre-existing config file that is group/other-accessible back to 0600.
// It can hold RPC URLs with embedded API keys (and the design anticipates users
// dropping a privateKey in it), so a loose file on a shared host is a leak. No-op on
// Windows and on an already-0600/missing file. Best-effort: never throws.
function repairConfigPermissions(): void {
  if (process.platform === "win32") return;
  const file = configFilePath();
  try {
    const st = fs.statSync(file);
    if (st.isFile() && (st.mode & 0o077) !== 0) {
      fs.chmodSync(file, 0o600);
      warnOnce(
        `${file}|perms`,
        `Config file ${file} was group/other-accessible; tightened its permissions to 0600 (it can hold RPC API keys).`,
        "yellow",
      );
    }
  } catch {
    /* missing file or stat/chmod failure — best effort */
  }
}

// ---------------------------------------------------------------------------
// §5.5 Writing: updateConfigFile()
// ---------------------------------------------------------------------------
export function updateConfigFile(mutator: (file: ConfigFile) => void): boolean {
  const file = configFilePath();
  const problem = configPathProblem();
  if (problem) {
    console.warn(chalk.yellow(problem));
    return false;
  }

  const { status, raw } = readRaw();
  if (status === "unreadable") {
    console.warn(
      chalk.yellow(
        `Could not save config to ${file}: existing file is unreadable — the change applies to this session only.`,
      ),
    );
    return false;
  }

  const before = JSON.stringify(raw);
  const beforeKeys = new Set(Object.keys(raw));
  mutator(raw as ConfigFile);
  // Whether the mutator itself changed anything, measured before the version stamp below.
  const mutatorChanged = JSON.stringify(raw) !== before;

  if (raw.version === undefined) raw.version = CONFIG_VERSION;
  // Defensive: no code path should add signer secrets; strip any the mutator introduced.
  for (const k of SECRET_KEYS) {
    if (k in raw && !beforeKeys.has(k)) delete raw[k];
  }

  // A no-op mutator against a not-yet-existing file must not create one — e.g.
  // `removeChain` of an env-only chain has genuinely nothing to persist, so the file
  // stays absent rather than being created just to hold `{ "version": 1 }`.
  if (mutatorChanged === false && fs.existsSync(file) === false) {
    return true;
  }
  if (status !== "corrupt" && JSON.stringify(raw) === before && fs.existsSync(file)) {
    return true; // nothing changed, no pointless rewrite
  }

  // An unpredictable temp name so an attacker cannot pre-plant a symlink at it when the
  // config path is in a world-writable directory (OCEANCLI_CONFIG_PATH foot-gun).
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  try {
    if (status === "corrupt") {
      const backup = `${file}.corrupt-${Date.now()}`;
      fs.renameSync(file, backup);
      console.warn(
        chalk.yellow(
          `Config file ${file} was not valid JSON — moved it to ${backup} and wrote a fresh one.`,
        ),
      );
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const data = JSON.stringify(raw, null, 2) + "\n";
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    // Atomic replace via rename. If it fails — e.g. a network filesystem that refuses to
    // rename over an existing file — let it propagate to the outer catch, which removes the
    // temp file and returns a save failure WITHOUT touching the destination. We never move,
    // truncate, or overwrite the live config, so a valid previous configuration always
    // survives a failed save intact (the change still applies to this session via
    // process.env; it just won't persist across a restart). The renamed file keeps the temp
    // file's 0600 mode, so no chmod is needed.
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.warn(
      chalk.yellow(
        `Could not write config file ${file} (${(e as Error).message}) — the change applies to this session but will not survive a restart.`,
      ),
    );
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// §5.6 Dotted-key helpers and value parsing
// ---------------------------------------------------------------------------
export function findConfigKey(name: string): ConfigKey | undefined {
  return CONFIG_KEYS.find((k) => k.key === name || k.env === name);
}

export function getFileValue(file: ConfigFile, key: string): unknown {
  const parts = key.split(".");
  if (parts.length === 1) return (file as Record<string, unknown>)[parts[0]];
  const parent = (file as Record<string, unknown>)[parts[0]];
  if (!isPlainObject(parent)) return undefined;
  return parent[parts[1]];
}

export function setFileValue(file: ConfigFile, key: string, value: unknown): void {
  const parts = key.split(".");
  const obj = file as Record<string, unknown>;
  if (parts.length === 1) {
    obj[parts[0]] = value;
    return;
  }
  let parent = obj[parts[0]];
  if (!isPlainObject(parent)) {
    parent = {};
    obj[parts[0]] = parent;
  }
  (parent as Record<string, unknown>)[parts[1]] = value;
}

export function deleteFileValue(file: ConfigFile, key: string): void {
  const parts = key.split(".");
  const obj = file as Record<string, unknown>;
  if (parts.length === 1) {
    delete obj[parts[0]];
    return;
  }
  const parent = obj[parts[0]];
  if (!isPlainObject(parent)) return;
  delete parent[parts[1]];
  if (Object.keys(parent).length === 0) delete obj[parts[0]];
}

export function parseConfigValue(
  entry: ConfigKey,
  input: string,
): string | boolean | number | string[] {
  if (entry.type === "string") {
    const s = input.trim();
    if (s.length === 0) throw new Error(`Value for ${entry.key} must not be empty.`);
    return s;
  }
  if (entry.type === "boolean") {
    const s = input.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n"].includes(s)) return false;
    throw new Error(`${entry.key} must be true or false (got "${input}").`);
  }
  if (entry.type === "int") {
    const min = entry.min ?? 0;
    if (!/^\d+$/.test(input.trim()) || Number(input.trim()) < min) {
      throw new Error(
        `${entry.key} must be an integer >= ${min} (got "${input}").`,
      );
    }
    return Number(input.trim());
  }
  // stringList
  const list = input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (list.length === 0) {
    throw new Error(`${entry.key} needs at least one value (comma-separated).`);
  }
  return list;
}

export function toEnvString(entry: ConfigKey, value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

// ---------------------------------------------------------------------------
// §5.7 Effective value for display
// ---------------------------------------------------------------------------
export interface SettingView {
  key: string;
  env: string;
  value: string | undefined;
  source: "env" | "file" | "default";
  fileValue?: string;
  defaultLabel: string;
}

export function describeSetting(entry: ConfigKey, file: ConfigFile): SettingView {
  const rawFileValue = getFileValue(file, entry.key);
  const fv = rawFileValue === undefined ? undefined : toEnvString(entry, rawFileValue);

  const view: SettingView = {
    key: entry.key,
    env: entry.env,
    value: undefined,
    source: "default",
    defaultLabel: entry.defaultLabel,
  };

  if (isEnvProvided(entry.env)) {
    // NODE_URL / COMPUTE_ENV_ID can change during a session via setNode — show the
    // CURRENT process.env value, not the startup snapshot.
    const current =
      entry.env === "NODE_URL" || entry.env === "COMPUTE_ENV_ID"
        ? process.env[entry.env]
        : originalEnvValue(entry.env);
    view.source = "env";
    view.value = current;
    if (fv !== undefined && fv !== current) view.fileValue = fv;
    return view;
  }
  if (fv !== undefined) {
    view.source = "file";
    view.value = fv;
    return view;
  }
  return view;
}

// ---------------------------------------------------------------------------
// §5.8 Test seam
// ---------------------------------------------------------------------------
export function __resetConfigStoreForTests(): void {
  initialized = false;
  envSnapshot.clear();
  hydrated.clear();
  warnedOnce.clear();
}

// ---------------------------------------------------------------------------
// §5.9 Favourite-node helpers (pure list logic; the CLI actions parse + print)
// ---------------------------------------------------------------------------
export function normalizeNodeRef(node: string): string {
  const n = node.trim();
  if (/^https?:\/\//i.test(n)) return n.replace(/\/+$/, "");
  return n;
}

// Keep only well-formed favourite entries, mirroring the per-item rules in
// readConfigFile(). Used by BOTH the display path (indirectly) and the mutators, so
// the list the user sees and the list remove/toggle index into are always the same —
// and a hand-edited malformed entry can never make a mutator throw.
function sanitizeFavouriteEntries(raw: unknown): FavouriteNode[] {
  if (!Array.isArray(raw)) return [];
  const out: FavouriteNode[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const node = sanitizeString(item.node);
    if (node === undefined) continue;
    const fav: FavouriteNode = { node };
    const desc = sanitizeString(item.description);
    if (desc !== undefined) fav.description = desc;
    out.push(fav);
  }
  return out;
}

// Same contract as sanitizeFavouriteEntries, for one chain's subsidy-provider list.
function sanitizeSubsidyEntries(raw: unknown): SubsidyProviderEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SubsidyProviderEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const address = sanitizeString(item.address);
    if (address === undefined) continue;
    const enabled = typeof item.enabled === "boolean" ? item.enabled : true;
    const entry: SubsidyProviderEntry = { address, enabled };
    const desc = sanitizeString(item.description);
    if (desc !== undefined) entry.description = desc;
    out.push(entry);
  }
  return out;
}

export function listFavouriteNodes(): FavouriteNode[] {
  return readConfigFile().favouriteNodes ?? [];
}

export function resolveFavouriteRef(ref: string, list: FavouriteNode[]): number {
  const r = ref.trim();
  if (/^\d+$/.test(r)) {
    const idx = Number(r) - 1;
    return idx >= 0 && idx < list.length ? idx : -1;
  }
  const norm = normalizeNodeRef(r);
  return list.findIndex((e) => normalizeNodeRef(e.node) === norm);
}

export function addFavouriteNode(
  node: string,
  description?: string,
): { result: "added" | "updated" | "unchanged"; index: number; saved: boolean } {
  const normNode = normalizeNodeRef(node);
  const desc = description?.trim() || undefined;
  let result: "added" | "updated" | "unchanged" = "added";
  let index = -1;
  const saved = updateConfigFile((f) => {
    const list = sanitizeFavouriteEntries(f.favouriteNodes);
    const existing = list.findIndex(
      (e) => normalizeNodeRef(e.node) === normNode,
    );
    if (existing < 0) {
      const entry: FavouriteNode = { node: normNode };
      if (desc) entry.description = desc;
      list.push(entry);
      index = list.length - 1;
      result = "added";
    } else {
      index = existing;
      if (desc && list[existing].description !== desc) {
        list[existing].description = desc;
        result = "updated";
      } else {
        result = "unchanged";
      }
    }
    f.favouriteNodes = list;
  });
  return { result, index, saved };
}

export function removeFavouriteNode(
  ref: string,
): { removed: FavouriteNode | null; saved: boolean } {
  let removed: FavouriteNode | null = null;
  const saved = updateConfigFile((f) => {
    const list = sanitizeFavouriteEntries(f.favouriteNodes);
    const idx = resolveFavouriteRef(ref, list);
    if (idx < 0) return;
    removed = list[idx];
    list.splice(idx, 1);
    if (list.length === 0) delete f.favouriteNodes;
    else f.favouriteNodes = list;
  });
  return { removed, saved };
}

// ---------------------------------------------------------------------------
// §5.10 Subsidy-provider helpers (per-chain; pure list logic; no ethers)
// ---------------------------------------------------------------------------
export function normalizeSubsidyAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function listSubsidyProviders(chainId: number): SubsidyProviderEntry[] {
  return readConfigFile().subsidyProviders?.[String(chainId)] ?? [];
}

export function listAllSubsidyProviders(): Record<string, SubsidyProviderEntry[]> {
  return readConfigFile().subsidyProviders ?? {};
}

export function enabledSubsidyProviderAddresses(chainId: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of listSubsidyProviders(chainId)) {
    if (!e.enabled) continue;
    const norm = normalizeSubsidyAddress(e.address);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(e.address);
  }
  return out;
}

export function resolveSubsidyRef(ref: string, list: SubsidyProviderEntry[]): number {
  const r = ref.trim();
  if (/^\d+$/.test(r)) {
    const idx = Number(r) - 1;
    return idx >= 0 && idx < list.length ? idx : -1;
  }
  const norm = normalizeSubsidyAddress(r);
  return list.findIndex((e) => normalizeSubsidyAddress(e.address) === norm);
}

export function addSubsidyProvider(
  chainId: number,
  address: string,
  description?: string,
): {
  result: "added" | "updated" | "unchanged";
  index: number;
  enabled: boolean;
  saved: boolean;
} {
  const desc = description?.trim() || undefined;
  const norm = normalizeSubsidyAddress(address);
  let result: "added" | "updated" | "unchanged" = "added";
  let index = -1;
  let enabled = true;
  const saved = updateConfigFile((f) => {
    const map = isPlainObject(f.subsidyProviders)
      ? (f.subsidyProviders as Record<string, SubsidyProviderEntry[]>)
      : {};
    const key = String(chainId);
    const list = sanitizeSubsidyEntries(map[key]);
    const existing = list.findIndex(
      (e) => normalizeSubsidyAddress(e.address) === norm,
    );
    if (existing < 0) {
      const entry: SubsidyProviderEntry = { address, enabled: true };
      if (desc) entry.description = desc;
      list.push(entry);
      index = list.length - 1;
      enabled = true;
      result = "added";
    } else {
      index = existing;
      enabled = list[existing].enabled;
      if (desc && list[existing].description !== desc) {
        list[existing].description = desc;
        result = "updated";
      } else {
        result = "unchanged";
      }
    }
    map[key] = list;
    f.subsidyProviders = map;
  });
  return { result, index, enabled, saved };
}

export function removeSubsidyProvider(
  chainId: number,
  ref: string,
): { removed: SubsidyProviderEntry | null; saved: boolean } {
  let removed: SubsidyProviderEntry | null = null;
  const saved = updateConfigFile((f) => {
    if (!isPlainObject(f.subsidyProviders)) return;
    const map = f.subsidyProviders as Record<string, SubsidyProviderEntry[]>;
    const key = String(chainId);
    const list = sanitizeSubsidyEntries(map[key]);
    const idx = resolveSubsidyRef(ref, list);
    if (idx < 0) return;
    removed = list[idx];
    list.splice(idx, 1);
    if (list.length === 0) delete map[key];
    else map[key] = list;
    if (Object.keys(map).length === 0) delete f.subsidyProviders;
    else f.subsidyProviders = map;
  });
  return { removed, saved };
}

export function toggleSubsidyProvider(
  chainId: number,
  ref: string,
  enabled?: boolean,
): { entry: SubsidyProviderEntry | null; enabled: boolean; saved: boolean } {
  let resultEntry: SubsidyProviderEntry | null = null;
  let newFlag = false;
  const saved = updateConfigFile((f) => {
    if (!isPlainObject(f.subsidyProviders)) return;
    const map = f.subsidyProviders as Record<string, SubsidyProviderEntry[]>;
    const key = String(chainId);
    const list = sanitizeSubsidyEntries(map[key]);
    const idx = resolveSubsidyRef(ref, list);
    if (idx < 0) return;
    list[idx].enabled = typeof enabled === "boolean" ? enabled : !list[idx].enabled;
    newFlag = list[idx].enabled;
    resultEntry = list[idx];
    map[key] = list;
    f.subsidyProviders = map;
  });
  return { entry: resultEntry, enabled: newFlag, saved };
}
