import fs from "fs";
import os from "os";
import path from "path";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecError {
  path: string;
  message: string;
}

export interface ResourceRequest {
  id: string;
  amount: number;
}

export type ComputeInputEntry = string | Record<string, unknown>;

/** Validated startCompute / startFreeCompute file. */
export interface ComputeSpec {
  datasets: ComputeInputEntry[];
  algorithm: ComputeInputEntry;
  env?: string;
  maxJobDuration?: number; // always set for a paid spec
  paymentToken?: string; // always set for a paid spec
  resources?: ResourceRequest[]; // always set for a paid spec
  chainId?: number;
  output?: Record<string, unknown>;
  serviceIds?: (string | null)[];
  algoServiceId?: string;
  /** Tri-state: undefined = node defaults, [] = none, list = checksummed addresses. */
  subsidyProviders?: string[];
  accept?: boolean;
}

/** Validated startService file. Paths are already absolute. */
export interface ServiceSpec {
  env: string;
  duration: number;
  paymentToken: string;
  template?: string;
  image?: string;
  tag?: string;
  checksum?: string;
  dockerfile?: string;
  additionalDockerFiles?: string | Record<string, string>;
  cmd?: string[];
  entrypoint?: string[];
  ports?: number[];
  resources?: ResourceRequest[];
  userData?: Record<string, unknown>;
  userDataFile?: string;
  chainId?: number;
  subsidyProviders?: string[];
  accept?: boolean;
  wait?: boolean;
  timeout?: number;
}

/** The string values the startCompute / startFreeCompute actions work with. */
export interface ComputeFileInputs {
  dsDids: string;
  aDid: string;
  envId?: string;
  jobDuration?: string;
  token?: string;
  res?: string;
  outputLocation?: string;
  svcIds: string;
  algoSvcId: string;
  chainId?: number;
  subsidyProviders?: string[];
  accept?: boolean;
}

/** Same field names as the opts object of Commands.startService, plus chainId. */
export interface ServiceFileInputs {
  envId: string;
  duration: number;
  paymentToken: string;
  templateId?: string;
  image?: string;
  tag?: string;
  checksum?: string;
  dockerfilePath?: string;
  additionalDockerFilesPath?: string;
  additionalDockerFiles?: Record<string, string>;
  cmd?: string[];
  entrypoint?: string[];
  ports?: number[];
  resources?: string;
  userDataInline?: string;
  userDataFilePath?: string;
  accept?: boolean;
  wait?: boolean;
  timeout?: number;
  subsidyProviders?: string[];
  chainId?: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Expand a leading "~" (the REPL does no shell expansion). */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function editDistance(a: string, b: string): number {
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp.push(new Array(b.length + 1).fill(0));
    dp[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

// Names people reach for because they are the CLI flag / positional names.
const KEY_ALIASES: Record<string, string> = {
  algo: "algorithm",
  algoDid: "algorithm",
  datasetDids: "datasets",
  dataset: "datasets",
  token: "paymentToken",
  services: "serviceIds",
  algoService: "algoServiceId",
  "algo-service": "algoServiceId",
  computeEnvId: "env",
  envId: "env",
  environment: "env",
  templateId: "template",
  "user-data": "userData",
  "user-data-file": "userDataFile",
  "additional-docker-files": "additionalDockerFiles",
  "subsidy-providers": "subsidyProviders",
};

function unknownKeyMessage(key: string, allowed: string[]): string {
  const alias = KEY_ALIASES[key];
  if (alias && allowed.includes(alias)) {
    return `unknown key (did you mean "${alias}"?)`;
  }
  let best: string | undefined;
  let bestDistance = 3; // suggest only at distance <= 2
  for (const candidate of allowed) {
    const d = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best ? `unknown key (did you mean "${best}"?)` : "unknown key";
}

/** Typed readers over the raw object that collect errors instead of throwing. */
class Fields {
  readonly errors: SpecError[] = [];
  constructor(private readonly raw: Record<string, unknown>) {}

  err(p: string, message: string): void {
    this.errors.push({ path: p, message });
  }

  /** null is treated like an absent key (decision D7). */
  get(key: string): unknown {
    const v = this.raw[key];
    return v === null ? undefined : v;
  }

  string(key: string, required = false): string | undefined {
    const v = this.get(key);
    if (v === undefined) {
      if (required) this.err(key, "required");
      return undefined;
    }
    if (typeof v !== "string" || v.trim() === "") {
      this.err(key, `must be a non-empty string (got ${typeName(v)})`);
      return undefined;
    }
    return v.trim();
  }

  integer(key: string, required = false, min = 1): number | undefined {
    const v = this.get(key);
    if (v === undefined) {
      if (required) this.err(key, "required");
      return undefined;
    }
    if (typeof v !== "number" || !Number.isInteger(v) || v < min) {
      const got = typeof v === "number" ? String(v) : typeName(v);
      this.err(key, `must be an integer >= ${min} (got ${got})`);
      return undefined;
    }
    return v;
  }

  boolean(key: string): boolean | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") {
      this.err(key, `must be true or false (got ${typeName(v)})`);
      return undefined;
    }
    return v;
  }

  address(key: string, required = false): string | undefined {
    const v = this.string(key, required);
    if (v === undefined) return undefined;
    if (!ethers.isAddress(v)) {
      this.err(key, "must be a valid EVM address (0x + 40 hex characters)");
      return undefined;
    }
    return v;
  }

  object(key: string): Record<string, unknown> | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    if (!isPlainObject(v)) {
      this.err(key, `must be a JSON object (got ${typeName(v)})`);
      return undefined;
    }
    return v;
  }

  stringArray(key: string): string[] | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) {
      this.err(key, `must be an array of strings (got ${typeName(v)})`);
      return undefined;
    }
    let ok = true;
    v.forEach((item, i) => {
      if (typeof item !== "string") {
        this.err(`${key}[${i}]`, `must be a string (got ${typeName(item)})`);
        ok = false;
      }
    });
    return ok ? (v as string[]) : undefined;
  }

  resources(key: string, required = false): ResourceRequest[] | undefined {
    const v = this.get(key);
    if (v === undefined) {
      if (required)
        this.err(key, "required (use [] for the environment minimums)");
      return undefined;
    }
    if (!Array.isArray(v)) {
      this.err(key, `must be an array of {id, amount} (got ${typeName(v)})`);
      return undefined;
    }
    let ok = true;
    const seen = new Set<string>();
    v.forEach((item, i) => {
      if (!isPlainObject(item)) {
        this.err(
          `${key}[${i}]`,
          `must be an object {id, amount} (got ${typeName(item)})`,
        );
        ok = false;
        return;
      }
      if (typeof item.id !== "string" || item.id.trim() === "") {
        this.err(
          `${key}[${i}].id`,
          `must be a non-empty string (got ${typeName(item.id)})`,
        );
        ok = false;
      } else if (seen.has(item.id)) {
        this.err(`${key}[${i}].id`, `duplicate resource id "${item.id}"`);
        ok = false;
      } else {
        seen.add(item.id);
      }
      if (
        typeof item.amount !== "number" ||
        !Number.isFinite(item.amount) ||
        item.amount < 0
      ) {
        const got =
          typeof item.amount === "number"
            ? String(item.amount)
            : typeName(item.amount);
        this.err(`${key}[${i}].amount`, `must be a number >= 0 (got ${got})`);
        ok = false;
      }
    });
    return ok ? (v as ResourceRequest[]) : undefined;
  }

  /** undefined = absent, [] = "none", list = checksummed addresses. */
  subsidyProviders(key: string): string[] | undefined {
    const v = this.get(key);
    if (v === undefined) return undefined;
    if (typeof v === "string") {
      if (v.trim().toLowerCase() === "none") return [];
      this.err(key, 'must be an array of addresses or the string "none"');
      return undefined;
    }
    if (!Array.isArray(v)) {
      this.err(
        key,
        `must be an array of addresses or "none" (got ${typeName(v)})`,
      );
      return undefined;
    }
    const out: string[] = [];
    let ok = true;
    v.forEach((item, i) => {
      if (typeof item !== "string" || !ethers.isAddress(item)) {
        this.err(`${key}[${i}]`, "must be a valid EVM address");
        ok = false;
      } else {
        out.push(ethers.getAddress(item));
      }
    });
    return ok ? out : undefined;
  }

  /** A path key: resolves against baseDir and checks the file exists. */
  file(key: string, baseDir: string): string | undefined {
    const v = this.string(key);
    if (v === undefined) return undefined;
    const abs = path.resolve(baseDir, expandHome(v));
    try {
      if (!fs.statSync(abs).isFile()) {
        this.err(key, `not a file: ${abs}`);
        return undefined;
      }
    } catch {
      this.err(key, `file not found: ${abs}`);
      return undefined;
    }
    return abs;
  }
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

export function readJsonSpecFile(filePath: string): {
  raw: Record<string, unknown>;
  absPath: string;
  baseDir: string;
} {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new Error("--from-json requires a file path.");
  }
  const absPath = path.resolve(expandHome(filePath.trim()));
  let text = "";
  let readErr: NodeJS.ErrnoException | undefined;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch (e) {
    readErr = e as NodeJS.ErrnoException;
  }
  if (readErr) {
    const code = readErr.code;
    if (code === "ENOENT") throw new Error(`Job file not found: ${absPath}`);
    if (code === "EISDIR") {
      throw new Error(`Job file path is a directory: ${absPath}`);
    }
    throw new Error(
      `Cannot read job file ${absPath} (${code ?? "unknown error"})`,
    );
  }
  let raw: unknown;
  let parseErr: Error | undefined;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    parseErr = e as Error;
  }
  if (parseErr) {
    // Do NOT echo V8's message (or attach it as a cause): it quotes the surrounding file
    // content, which may be a secret.
    const msg = parseErr.message ?? "";
    const lineCol = msg.match(/line (\d+) column (\d+)/);
    const pos = msg.match(/position (\d+)/);
    const where = lineCol
      ? ` at line ${lineCol[1]}, column ${lineCol[2]}`
      : pos
        ? ` at character ${pos[1]}`
        : "";
    throw new Error(`Job file ${absPath} is not valid JSON${where}.`);
  }
  if (!isPlainObject(raw)) {
    throw new Error(
      `Job file ${absPath} must contain a JSON object at the top level (got ${typeName(raw)}).`,
    );
  }
  return { raw, absPath, baseDir: path.dirname(absPath) };
}

export function formatSpecErrors(absPath: string, errors: SpecError[]): string {
  const n = errors.length;
  const lines = errors.map((e) => `  - ${e.path}: ${e.message}`);
  return `Invalid job file ${absPath} (${n} problem${n === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const COMPUTE_COMMON_KEYS = [
  "datasets",
  "algorithm",
  "env",
  "output",
  "serviceIds",
  "algoServiceId",
  "chainId",
];
const COMPUTE_PAID_KEYS = [
  "maxJobDuration",
  "paymentToken",
  "resources",
  "subsidyProviders",
  "accept",
];
const SERVICE_KEYS = [
  "env",
  "duration",
  "paymentToken",
  "template",
  "image",
  "tag",
  "checksum",
  "dockerfile",
  "additionalDockerFiles",
  "cmd",
  "entrypoint",
  "ports",
  "resources",
  "userData",
  "userDataFile",
  "chainId",
  "subsidyProviders",
  "accept",
  "wait",
  "timeout",
];

export function validateComputeSpec(
  raw: Record<string, unknown>,
  opts: { free: boolean },
): { value?: ComputeSpec; errors: SpecError[] } {
  const f = new Fields(raw);
  const allowed = opts.free
    ? COMPUTE_COMMON_KEYS
    : [...COMPUTE_COMMON_KEYS, ...COMPUTE_PAID_KEYS];

  for (const key of Object.keys(raw)) {
    if (key === "$schema" || allowed.includes(key)) continue;
    if (opts.free && COMPUTE_PAID_KEYS.includes(key)) {
      f.err(
        key,
        "not valid for startFreeCompute (a free job has no payment); remove it or use startCompute",
      );
    } else {
      f.err(key, unknownKeyMessage(key, allowed));
    }
  }

  // datasets
  let datasets: ComputeInputEntry[] | undefined;
  const ds = f.get("datasets");
  if (ds === undefined) {
    f.err("datasets", "required (use [] for an algorithm-only job)");
  } else if (!Array.isArray(ds)) {
    f.err("datasets", `must be an array (got ${typeName(ds)})`);
  } else {
    let ok = true;
    ds.forEach((entry, i) => {
      if (typeof entry === "string") {
        if (entry.trim() === "") {
          f.err(`datasets[${i}]`, "must be a non-empty DID string");
          ok = false;
        }
      } else if (isPlainObject(entry)) {
        if (!isPlainObject(entry.fileObject)) {
          f.err(
            `datasets[${i}].fileObject`,
            "required for a raw dataset (must be an object)",
          );
          ok = false;
        }
      } else {
        f.err(
          `datasets[${i}]`,
          `must be a DID string or an object with a fileObject (got ${typeName(entry)})`,
        );
        ok = false;
      }
    });
    if (ok) datasets = ds as ComputeInputEntry[];
  }

  // algorithm
  let algorithm: ComputeInputEntry | undefined;
  const al = f.get("algorithm");
  if (al === undefined) {
    f.err("algorithm", "required");
  } else if (typeof al === "string") {
    if (al.trim() === "") f.err("algorithm", "must be a non-empty DID string");
    else algorithm = al.trim();
  } else if (isPlainObject(al)) {
    const meta = al.meta;
    const hasRawcode = isPlainObject(meta) && typeof meta.rawcode === "string";
    if (!isPlainObject(al.fileObject) && !hasRawcode) {
      f.err(
        "algorithm",
        "a raw algorithm must contain a fileObject object or meta.rawcode",
      );
    } else {
      algorithm = al;
    }
  } else {
    f.err(
      "algorithm",
      `must be a DID string or an object (got ${typeName(al)})`,
    );
  }

  // serviceIds
  let serviceIds: (string | null)[] | undefined;
  const sv = f.get("serviceIds");
  if (sv !== undefined) {
    if (!Array.isArray(sv)) {
      f.err("serviceIds", `must be an array (got ${typeName(sv)})`);
    } else {
      let ok = true;
      sv.forEach((item, i) => {
        if (item !== null && (typeof item !== "string" || item.trim() === "")) {
          f.err(`serviceIds[${i}]`, "must be a non-empty string or null");
          ok = false;
        }
      });
      if (Array.isArray(ds) && sv.length !== ds.length) {
        f.err(
          "serviceIds",
          `has ${sv.length} entries but datasets has ${ds.length}; they map 1-1 by position (use null for the default service)`,
        );
        ok = false;
      }
      if (ok) serviceIds = sv as (string | null)[];
    }
  }

  const spec: ComputeSpec = {
    datasets: datasets ?? [],
    algorithm: algorithm ?? "",
    env: f.string("env"),
    output: f.object("output"),
    serviceIds,
    algoServiceId: f.string("algoServiceId"),
    chainId: f.integer("chainId"),
  };
  if (!opts.free) {
    spec.maxJobDuration = f.integer("maxJobDuration", true);
    spec.paymentToken = f.address("paymentToken", true);
    spec.resources = f.resources("resources", true);
    spec.subsidyProviders = f.subsidyProviders("subsidyProviders");
    spec.accept = f.boolean("accept");
  }

  return f.errors.length > 0
    ? { errors: f.errors }
    : { value: spec, errors: [] };
}

export function validateServiceSpec(
  raw: Record<string, unknown>,
  opts: { baseDir: string },
): { value?: ServiceSpec; errors: SpecError[] } {
  const f = new Fields(raw);

  for (const key of Object.keys(raw)) {
    if (key === "$schema" || SERVICE_KEYS.includes(key)) continue;
    f.err(key, unknownKeyMessage(key, SERVICE_KEYS));
  }

  const env = f.string("env", true);
  const duration = f.integer("duration", true);
  const paymentToken = f.address("paymentToken", true);

  const template = f.string("template");
  const image = f.string("image");
  const hasTemplate = f.get("template") !== undefined;
  const hasImage = f.get("image") !== undefined;
  if (hasTemplate && hasImage) {
    f.err("template", 'provide either "template" or "image", not both');
  } else if (!hasTemplate && !hasImage) {
    f.err("template", 'one of "template" or "image" is required');
  }

  const tag = f.string("tag");
  const checksum = f.string("checksum");
  const dockerfile = f.file("dockerfile", opts.baseDir);
  const specKeys = ["tag", "checksum", "dockerfile"].filter(
    (k) => f.get(k) !== undefined,
  );
  if (specKeys.length > 1) {
    f.err(
      specKeys[1],
      `provide at most one of "tag", "checksum" or "dockerfile" (found ${specKeys.join(", ")})`,
    );
  }

  let additionalDockerFiles: string | Record<string, string> | undefined;
  const adf = f.get("additionalDockerFiles");
  if (adf !== undefined) {
    if (typeof adf === "string") {
      additionalDockerFiles = f.file("additionalDockerFiles", opts.baseDir);
    } else if (isPlainObject(adf)) {
      let ok = true;
      for (const [name, content] of Object.entries(adf)) {
        if (typeof content !== "string") {
          f.err(
            `additionalDockerFiles.${name}`,
            `must be a string (got ${typeName(content)})`,
          );
          ok = false;
        }
      }
      if (ok) additionalDockerFiles = adf as Record<string, string>;
    } else {
      f.err(
        "additionalDockerFiles",
        `must be a file path or an object {filename: content} (got ${typeName(adf)})`,
      );
    }
  }

  let ports: number[] | undefined;
  const p = f.get("ports");
  if (p !== undefined) {
    if (!Array.isArray(p)) {
      f.err("ports", `must be an array of port numbers (got ${typeName(p)})`);
    } else {
      let ok = true;
      p.forEach((item, i) => {
        if (
          typeof item !== "number" ||
          !Number.isInteger(item) ||
          item < 1 ||
          item > 65535
        ) {
          f.err(`ports[${i}]`, "must be an integer 1-65535");
          ok = false;
        }
      });
      if (ok) ports = p as number[];
    }
  }

  const userData = f.object("userData");
  const userDataFile = f.file("userDataFile", opts.baseDir);
  if (f.get("userData") !== undefined && f.get("userDataFile") !== undefined) {
    f.err(
      "userDataFile",
      'provide either "userData" or "userDataFile", not both',
    );
  }

  const spec: ServiceSpec = {
    env: env ?? "",
    duration: duration ?? 0,
    paymentToken: paymentToken ?? "",
    template,
    image,
    tag,
    checksum,
    dockerfile,
    additionalDockerFiles,
    cmd: f.stringArray("cmd"),
    entrypoint: f.stringArray("entrypoint"),
    ports,
    resources: f.resources("resources"),
    userData,
    userDataFile,
    chainId: f.integer("chainId"),
    subsidyProviders: f.subsidyProviders("subsidyProviders"),
    accept: f.boolean("accept"),
    wait: f.boolean("wait"),
    timeout: f.integer("timeout"),
  };

  return f.errors.length > 0
    ? { errors: f.errors }
    : { value: spec, errors: [] };
}

// ---------------------------------------------------------------------------
// Conversion to what the existing actions / Commands methods expect
// ---------------------------------------------------------------------------

export function computeSpecToInputs(spec: ComputeSpec): ComputeFileInputs {
  return {
    // parseComputeInput() accepts a JSON array of DIDs and/or raw objects.
    dsDids: JSON.stringify(spec.datasets),
    aDid:
      typeof spec.algorithm === "string"
        ? spec.algorithm
        : JSON.stringify(spec.algorithm),
    envId: spec.env,
    jobDuration:
      spec.maxJobDuration !== undefined
        ? String(spec.maxJobDuration)
        : undefined,
    token: spec.paymentToken,
    res:
      spec.resources !== undefined ? JSON.stringify(spec.resources) : undefined,
    outputLocation:
      spec.output !== undefined ? JSON.stringify(spec.output) : undefined,
    // Empty entries are positional placeholders ("svc0,,svc2"), so null -> "".
    svcIds: spec.serviceIds
      ? spec.serviceIds.map((s) => s ?? "").join(",")
      : "",
    algoSvcId: spec.algoServiceId ?? "",
    chainId: spec.chainId,
    subsidyProviders: spec.subsidyProviders,
    accept: spec.accept,
  };
}

export function serviceSpecToInputs(spec: ServiceSpec): ServiceFileInputs {
  const adf = spec.additionalDockerFiles;
  return {
    envId: spec.env,
    duration: spec.duration,
    paymentToken: spec.paymentToken,
    templateId: spec.template,
    image: spec.image,
    tag: spec.tag,
    checksum: spec.checksum,
    dockerfilePath: spec.dockerfile,
    additionalDockerFilesPath: typeof adf === "string" ? adf : undefined,
    additionalDockerFiles:
      adf !== undefined && typeof adf !== "string" ? adf : undefined,
    cmd: spec.cmd,
    entrypoint: spec.entrypoint,
    ports: spec.ports,
    resources:
      spec.resources !== undefined ? JSON.stringify(spec.resources) : undefined,
    userDataInline:
      spec.userData !== undefined ? JSON.stringify(spec.userData) : undefined,
    userDataFilePath: spec.userDataFile,
    accept: spec.accept,
    wait: spec.wait,
    timeout: spec.timeout,
    subsidyProviders: spec.subsidyProviders,
    chainId: spec.chainId,
  };
}

// ---------------------------------------------------------------------------
// One-call entry points used by cli.ts. Both throw a plain Error on any problem.
// ---------------------------------------------------------------------------

export function loadComputeSpec(
  filePath: string,
  opts: { free: boolean },
): ComputeFileInputs {
  const { raw, absPath } = readJsonSpecFile(filePath);
  const { value, errors } = validateComputeSpec(raw, opts);
  if (!value) throw new Error(formatSpecErrors(absPath, errors));
  return computeSpecToInputs(value);
}

export function loadServiceSpec(filePath: string): ServiceFileInputs {
  const { raw, absPath, baseDir } = readJsonSpecFile(filePath);
  const { value, errors } = validateServiceSpec(raw, { baseDir });
  if (!value) throw new Error(formatSpecErrors(absPath, errors));
  return serviceSpecToInputs(value);
}
