import { ethers, hexlify, Signer, toBeHex } from "ethers";
import { promises as fs, readFileSync } from "fs";
import * as path from "path";
import { wrapEthersSigner } from "@oasisprotocol/sapphire-ethers-v6";
import {
  Asset,
  DDO,
  DDOManager,
  getDdoChainId,
  isComputeService,
} from "@oceanprotocol/ddo-js";
import {
  AccesslistFactory,
  Aquarius,
  Nft,
  NftFactory,
  ProviderInstance,
  ZERO_ADDRESS,
  approveWei,
  ProviderComputeInitialize,
  ConsumeMarketFee,
  Datatoken,
  Config,
  orderAsset,
  getEventFromTx,
  DownloadResponse,
  ProviderFees,
  ComputeAlgorithm,
  ComputeAsset,
  createAsset,
  LoggerInstance,
  JobSubsidyEstimate,
} from "@oceanprotocol/lib";
import { createRequire } from "module";

// Resolve the ERC20 template ABI through the module system rather than a
// cwd-relative path, so the compiled CLI works from any working directory
// (e.g. when installed globally). require.resolve finds the JSON inside the
// installed @oceanprotocol/contracts package regardless of cwd.
const require = createRequire(import.meta.url);
const ERC20Template = JSON.parse(
  readFileSync(
    require.resolve("@oceanprotocol/contracts/artifacts/contracts/templates/ERC20Template.sol/ERC20Template.json"),
    "utf8",
  ),
);

export async function downloadFile(
  url: string,
  downloadPath: string,
  index?: number,
): Promise<DownloadResponse> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Response error.");
  }

  const defaultName =
    !isNaN(index) && index > -1 ? `file_${index}.out` : "file.out";
  let filename: string;

  try {
    // try to get it from headers
    filename = response.headers
      .get("content-disposition")
      .match(/attachment;filename=(.+)/)[1];
  } catch {
    filename = defaultName;
  }

  // The header is remote-controlled, so reduce it to a bare file name before
  // joining: a value like "../../.ssh/authorized_keys" would otherwise escape
  // downloadPath. basename also strips any directory component, and a name that
  // is empty or only dots ("." / "..") is no name at all.
  filename = path.basename(filename);
  if (filename.length === 0 || /^\.+$/.test(filename)) {
    filename = defaultName;
  }

  const filePath = path.join(downloadPath, filename);
  const data = await response.arrayBuffer();

  try {
    await fs.writeFile(filePath, Buffer.from(data));
  } catch (err) {
    throw new Error("Error while saving the file:", { cause: err });
  }

  return { data, filename };
}

export async function calculateActiveTemplateIndex(
  owner: Signer,
  nftContractAddress: string, // addresses.ERC721Factory,
  template: string | number,
): Promise<number> {
  // is an ID number?
  const isTemplateID = typeof template === "number";

  const factoryERC721 = new NftFactory(nftContractAddress, owner);
  const currentTokenCount = await factoryERC721.getCurrentTokenTemplateCount();
  for (let i = 1; i <= currentTokenCount; i++) {
    const tokenTemplate = await factoryERC721.getTokenTemplate(i);

    const erc20Template = new ethers.Contract(
      tokenTemplate.templateAddress,
      ERC20Template.abi,
      owner,
    );

    // check for ID
    if (isTemplateID) {
      const id = await (
        erc20Template as ethers.Contract & { getId(): Promise<number> }
      ).getId();
      if (tokenTemplate.isActive && id.toString() === template.toString()) {
        return i;
      }
    } else if (
      tokenTemplate.isActive &&
      tokenTemplate.templateAddress === template.toString()
    ) {
      return i;
    }
  }
  // if nothing is found it returns -1
  return -1;
}

export function getSignerAccordingSdk(signer: Signer, config: Config) {
  return config && "sdk" in config && config.sdk === "oasis"
    ? wrapEthersSigner(signer)
    : signer;
}

export async function createAssetUtil(
  name: string,
  symbol: string,
  owner: Signer,
  assetUrl: any,
  ddo: DDO,
  oceanNodeUrl: string,
  config: Config,
  aquariusInstance: Aquarius,
  encryptDDO: boolean = true,
  templateIDorAddress: string | number = 1, // If string, it's template address , otherwise, it's templateId,
  providerFeeToken: string = ZERO_ADDRESS,
  accessListFactory?: string,
  allowAccessList?: string,
  denyAccessList?: string,
) {
  const isAddress = typeof templateIDorAddress === "string";
  const isTemplateIndex = typeof templateIDorAddress === "number";
  if (!isAddress && !isTemplateIndex) {
    throw new Error('Invalid template! Must be a "number" or a "string"');
  }
  const { chainId } = await owner.provider.getNetwork();
  const signer = getSignerAccordingSdk(owner, config);

  if (config.sdk === "oasis") {
    // Create Access List Factory
    const accessListFactoryObj = new AccesslistFactory(
      config.accessListFactory,
      signer,
      Number(chainId),
    );

    // Create Allow List
    await accessListFactoryObj.deployAccessListContract(
      "AllowList",
      "ALLOW",
      ["https://oceanprotocol.com/nft/"],
      false,
      await owner.getAddress(),
      [await owner.getAddress(), ZERO_ADDRESS],
    );
    return await createAsset(
      name,
      symbol,
      signer,
      assetUrl,
      templateIDorAddress,
      ddo,
      encryptDDO,
      oceanNodeUrl,
      providerFeeToken,
      aquariusInstance,
      accessListFactory,
      allowAccessList,
      denyAccessList,
    );
  }
  return await createAsset(
    name,
    symbol,
    signer,
    assetUrl,
    templateIDorAddress,
    ddo,
    encryptDDO,
    oceanNodeUrl,
    providerFeeToken,
    aquariusInstance,
  );
}

export async function updateAssetMetadata(
  owner: Signer,
  updatedDdo: Asset,
  oceanNodeUrl: string,
  aquariusInstance: Aquarius,
  encryptDDO: boolean = true,
): Promise<any> {
  const nft = new Nft(
    owner,
    Number((await owner.provider.getNetwork()).chainId),
  );
  let flags;
  let metadata;
  const validateResult = await aquariusInstance.validate(
    updatedDdo,
    owner,
    oceanNodeUrl,
  );
  const ddoInstance = DDOManager.getDDOClass(updatedDdo);
  const { chainId, nftAddress } = ddoInstance.getDDOFields();
  if (encryptDDO) {
    const providerResponse = await ProviderInstance.encrypt(
      updatedDdo,
      chainId,
      oceanNodeUrl,
      owner,
    );
    metadata = await providerResponse;
    flags = 2;
  } else {
    const stringDDO = JSON.stringify(updatedDdo);
    const bytes = Buffer.from(stringDDO);
    metadata = hexlify(bytes);
    flags = 0;
  }

  const updateDdoTX = await nft.setMetadata(
    nftAddress,
    await owner.getAddress(),
    0,
    oceanNodeUrl,
    "",
    toBeHex(flags),
    metadata,
    validateResult.hash,
  );
  return updateDdoTX;
}

export async function handleComputeOrder(
  order: ProviderComputeInitialize,
  asset: Asset,
  payerAccount: Signer,
  consumerAddress: string,
  serviceIndex: number,
  datatoken: Datatoken,
  config: Config,
  providerFees: ProviderFees,
  oceanNodeUrl: string,
  consumeMarkerFee?: ConsumeMarketFee,
) {
  const ddoInstance = DDOManager.getDDOClass(asset);
  const service = ddoInstance.getServiceByIndex(serviceIndex);
  if (!service) {
    throw new Error(
      `Service index ${serviceIndex} not found in asset ${asset.id}`,
    );
  }
  // Validate new orders before approving fees. Reuse does not need indexed datatokens.
  let datatokenIndex: number;
  if (!order.validOrder) {
    const { datatokens } = ddoInstance.getAssetFields();
    datatokenIndex = datatokens?.findIndex(
      (token) =>
        token.address.toLowerCase() === service.datatokenAddress.toLowerCase(),
    );
    if (datatokenIndex === undefined || datatokenIndex < 0) {
      throw new Error(
        `Datatoken for service ${service.id} not found in asset ${asset.id}`,
      );
    }
  }
  /* We do have 3 possible situations:
	   - have validOrder and no providerFees -> then order is valid, providerFees are valid, just use it in startCompute
	   - have validOrder and providerFees -> then order is valid but providerFees are not valid, we need to call reuseOrder and pay only providerFees
	   - no validOrder -> we need to call startOrder, to pay 1 DT & providerFees
	*/
  const hasProviderFees =
    order.providerFee && order.providerFee.providerFeeAmount;
  // no need to approve if it is 0
  if (hasProviderFees && Number(order.providerFee.providerFeeAmount) > 0) {
    await approveWei(
      payerAccount,
      config,
      await payerAccount.getAddress(),
      order.providerFee.providerFeeToken,
      service.datatokenAddress,
      order.providerFee.providerFeeAmount,
    );
  }
  if (order.validOrder) {
    if (!order.providerFee) return order.validOrder;
    const tx = await datatoken.reuseOrder(
      service.datatokenAddress,
      order.validOrder,
      order.providerFee,
    );
    const reusedTx = await tx.wait();
    const orderReusedTx = getEventFromTx(reusedTx, "OrderReused");
    return orderReusedTx.transactionHash;
  }
  console.log("Ordering asset with DID: ", asset.id);
  const txStartOrder = await orderAsset(
    asset,
    payerAccount,
    config,
    datatoken,
    oceanNodeUrl,
    consumerAddress,
    consumeMarkerFee,
    providerFees,
    undefined,
    datatokenIndex,
    serviceIndex,
  );

  if (!txStartOrder) return;
  const tx = await txStartOrder.wait();
  const orderStartedTx = getEventFromTx(tx, "OrderStarted");

  return orderStartedTx.transactionHash;
}

export async function isOrderable(
  asset: Asset | DDO,
  serviceId: string,
  algorithm: ComputeAlgorithm,
  algorithmDDO: Asset | DDO,
): Promise<boolean> {
  const datasetService = DDOManager.getDDOClass(asset).getService(serviceId);
  if (!datasetService) return false;

  if (isComputeService(datasetService)) {
    // A DID-based algorithm carries a `documentId` (and, for convenience, its
    // `meta`); a raw algorithm carries only `meta` (a fileObject, no DID). Check
    // `documentId` first so published algorithms are validated against the
    // dataset's provider rather than the raw-algorithm allowance.
    if (algorithm.documentId) {
      const algoService = algorithmDDO
        ? DDOManager.getDDOClass(algorithmDDO).getService(algorithm.serviceId)
        : undefined;
      if (isComputeService(algoService)) {
        if (algoService.serviceEndpoint !== datasetService.serviceEndpoint) {
          LoggerInstance.error(
            "ERROR: Both assets with compute service are not served by the same provider",
          );
          return false;
        }
      }
    } else if (algorithm.meta) {
      if (datasetService.compute.allowRawAlgorithm) return true;
      return false;
    }
  }
  return true;
}

export interface ResolvedComputeInputs {
  assets: ComputeAsset[]; // index-aligned with `ddos`
  algo: ComputeAlgorithm;
  ddos: (Asset | DDO | null)[]; // null where the asset is raw (fileObject)
  algoDdo: Asset | DDO | null; // null when the algo is raw
  providerURI: string; // first DID-based DDO endpoint, else fallback
}

// Parses a single compute input string (datasets or algo) into a list of tokens.
// Each token is either a DID string or a raw ComputeAsset/ComputeAlgorithm object.
// Supports: a bare DID, a JSON object, a JSON array of DIDs and/or objects, and the
// legacy unquoted `[did:a,did:b]` form (kept for backward compatibility).
// Exported so the CLI layer can count datasets the same way the resolver does,
// without re-implementing (and drifting from) the JSON / mixed / legacy parsing.
export function parseComputeInput(
  raw: string,
): (string | Record<string, unknown>)[] {
  if (raw === undefined || raw === null) return [];
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    // a JSON primitive (e.g. a quoted string) -> treat as a single DID
    return [String(parsed)];
  } catch {
    // not valid JSON: bare DID or legacy `[did:a,did:b]`
    if (trimmed.includes("[") && trimmed.includes("]")) {
      const processed = trimmed.replaceAll("]", "").replaceAll("[", "");
      if (processed.indexOf(",") > -1) {
        return processed
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      // `[did]` or `[]`
      const single = processed.trim();
      return single.length > 0 ? [single] : [];
    }
    // legacy unbracketed comma-separated DIDs: `did:op:a,did:op:b`
    if (trimmed.indexOf(",") > -1) {
      return trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [trimmed];
  }
}

// Resolves the raw datasets/algo CLI strings into fully-built ComputeAsset[] and
// ComputeAlgorithm, plus index-aligned DDO arrays (null where the entry is raw).
// DID entries are resolved via Aquarius; raw (fileObject) entries are passed through
// untouched. Returns null (after logging) when a DID cannot be resolved.
export async function resolveComputeInputs(
  datasetsInput: string,
  algoInput: string,
  aquarius: Aquarius,
  indexingParams: IndexerWaitParams,
  fallbackProviderURI: string,
): Promise<ResolvedComputeInputs | null> {
  const datasetTokens = parseComputeInput(datasetsInput);

  const assets: ComputeAsset[] = [];
  const ddos: (Asset | DDO | null)[] = [];

  for (const token of datasetTokens) {
    if (typeof token === "string") {
      const dataDdo = await aquarius.waitForIndexer(
        token,
        undefined,
        undefined,
        indexingParams.retryInterval,
        indexingParams.maxRetries,
      );
      if (!dataDdo) {
        console.error(
          "Error fetching DDO " + token + ".  Does this asset exists?",
        );
        return null;
      }
      const service = DDOManager.getDDOClass(dataDdo).getServiceByIndex(0);
      if (!service) {
        console.error(`Error: dataset ${token} has no services.`);
        return null;
      }
      assets.push({
        documentId: dataDdo.id,
        serviceId: service.id,
      });
      ddos.push(dataDdo);
    } else if (token && typeof token === "object") {
      const rawAsset = token as unknown as ComputeAsset;
      if (!rawAsset.fileObject) {
        console.error(
          "Error: raw dataset asset must contain a 'fileObject'. Got: " +
            JSON.stringify(token),
        );
        return null;
      }
      assets.push({
        ...rawAsset,
        documentId: rawAsset.documentId ?? "",
        serviceId: rawAsset.serviceId ?? "",
      });
      ddos.push(null);
    } else {
      console.error("Error: invalid dataset input entry: " + String(token));
      return null;
    }
  }

  let providerURI = fallbackProviderURI;
  const firstDdo = ddos.find((d) => d !== null);
  if (firstDdo) {
    providerURI =
      DDOManager.getDDOClass(firstDdo).getServiceByIndex(0).serviceEndpoint;
  }

  // Resolve the algorithm (single entry: DID or raw object)
  const algoTokens = parseComputeInput(algoInput);
  const algoToken = algoTokens.length > 0 ? algoTokens[0] : algoInput;
  let algo: ComputeAlgorithm;
  let algoDdo: Asset | DDO | null = null;

  if (typeof algoToken === "string") {
    algoDdo = await aquarius.waitForIndexer(
      algoToken,
      undefined,
      undefined,
      indexingParams.retryInterval,
      indexingParams.maxRetries,
    );
    if (!algoDdo) {
      console.error(
        "Error fetching DDO " + algoToken + ".  Does this asset exists?",
      );
      return null;
    }
    const algoInstance = DDOManager.getDDOClass(algoDdo);
    const { metadata } = algoInstance.getDDOFields();
    const service = algoInstance.getServiceByIndex(0);
    if (!service) {
      console.error(`Error: algorithm ${algoToken} has no services.`);
      return null;
    }
    if (!metadata?.algorithm) {
      console.error(`Error: algorithm ${algoToken} has no algorithm metadata.`);
      return null;
    }
    algo = {
      documentId: algoDdo.id,
      serviceId: service.id,
      meta: metadata.algorithm,
    };
  } else if (algoToken && typeof algoToken === "object") {
    const rawAlgo = algoToken as unknown as ComputeAlgorithm;
    // The node accepts the code either as a file to fetch or inline in meta.rawcode.
    if (!rawAlgo.fileObject && !rawAlgo.meta?.rawcode) {
      console.error(
        "Error: raw algorithm must contain a 'fileObject' or 'meta.rawcode'. Got: " +
          JSON.stringify(algoToken),
      );
      return null;
    }
    algo = rawAlgo;
  } else {
    console.error("Error: invalid algorithm input: " + String(algoToken));
    return null;
  }

  return { assets, algo, ddos, algoDdo, providerURI };
}

// The ranges and the amount of usable IP's:

// 10.0.0.0 - 10.255.255.255 Addresses: 16,777,216
// 172.16.0.0 - 172.31.255.255 Addresses: 1,048,576
// 192.168.0.0 - 192.168.255.255 Addresses: 65,536

// check if IP is private or not
export function isPrivateIP(ip): boolean {
  const reg = /^(127\.[\d.]+|[0:]+1|localhost)$/;
  const result = ip.match(reg);
  if (result !== null) {
    // is loopback address
    return true;
  }
  const parts = ip.split(".");
  return (
    parts[0] === "10" ||
    (parts[0] === "172" &&
      parseInt(parts[1], 10) >= 16 &&
      parseInt(parts[1], 10) <= 31) ||
    (parts[0] === "192" && parts[1] === "168")
  );
}

// get public IP address using free service API
export async function getPublicIP(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    if (data) {
      return data.ip;
    }
  } catch (err) {
    console.error("Erro getting public IP: ", err.message);
  }

  return null;
}

export async function getMetadataURI() {
  const metadataURI = process.env.NODE_URL;
  if (!metadataURI.startsWith("http")) {
    return metadataURI;
  }
  const parsed = new URL(metadataURI);
  let ip = metadataURI; // by default
  // has port number?
  const hasPort = parsed.port && !isNaN(Number(parsed.port));
  if (hasPort) {
    // remove the port, just get the host part
    ip = parsed.hostname;
  }
  // check if is private or loopback
  if (isPrivateIP(ip)) {
    // get public V4 ip address
    ip = await getPublicIP();
    if (!ip) {
      return metadataURI;
    }
  }
  // if we removed the port add it back
  if (hasPort) {
    ip = `http://${ip}:${parsed.port}`;
  }
  return ip;
}
// for waiting for an asset to index
export interface IndexerWaitParams {
  maxRetries: number;
  retryInterval: number;
}

// defines how much time we wait for an asset to index + the interval for retries
export function getIndexingWaitSettings(): IndexerWaitParams {
  const indexingParams: IndexerWaitParams = {
    maxRetries: 120, // 120 retries
    retryInterval: 4000, // retries every 4 seconds
  };
  try {
    if (!isNaN(Number(process.env.INDEXING_RETRY_INTERVAL))) {
      indexingParams.retryInterval = Number(
        process.env.INDEXING_RETRY_INTERVAL,
      );
      if (indexingParams.retryInterval < 0) {
        indexingParams.retryInterval = 4000;
      }
    }
    if (!isNaN(Number(process.env.INDEXING_MAX_RETRIES))) {
      indexingParams.maxRetries = Number(process.env.INDEXING_MAX_RETRIES);
      if (indexingParams.maxRetries < 0) {
        indexingParams.maxRetries = 120;
      }
    }
  } catch (err) {
    console.error("Error getting indexing wait arguments:", err);
  }

  return indexingParams;
}

export function fixAndParseProviderFees(rawString: string) {
  // Remove surrounding quotes if present
  if (rawString.startsWith('"') && rawString.endsWith('"')) {
    rawString = rawString.slice(1, -1).replace(/\\"/g, '"');
  }

  const fixed = rawString
    .replace(/([{,])(\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$3":')
    .replace(/:\s*(did:[^,}\]]+)/g, ':"$1"')
    .replace(/:\s*(0x[a-fA-F0-9]+)/g, ':"$1"')
    .replace(/providerData:\s*([^,}\]]+)/g, 'providerData:"$1"')
    .replace(/:false/g, ":false")
    .replace(/:true/g, ":true");

  return JSON.parse(fixed);
}

export function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const val = value.trim().toLowerCase();
    return val === "true" || val === "1" || val === "yes" || val === "y";
  }
  return Boolean(value);
}

// ---------------------------------------------------------------------------
// Multi-chain compute helpers (Phase 3).
// ---------------------------------------------------------------------------

/**
 * The set of chainIds a compute job actually touches: the payment/escrow chain plus
 * every DID-based dataset/algorithm DDO's own chain (a job may mix assets across
 * chains, and pay on yet another). Raw `fileObject` entries have a null DDO slot and
 * no chain (no order is placed for them), so they contribute nothing. Pure + ordered
 * (payment chain first) so it is unit-testable and its error listing is deterministic.
 * A *non-null* DDO with no resolvable chainId is malformed — throw with a clear label
 * rather than silently omitting it (which would bypass the up-front registry validation
 * and later crash as `orderCtxFor(NaN)` deep in the ordering loop).
 */
export function computeJobChainIds(
  paymentChainId: number,
  ddos: (Asset | DDO | null | undefined)[],
  algoDdo?: Asset | DDO | null,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (raw: unknown, label: string) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Invalid or missing chainId for ${label} (got ${raw}).`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  add(paymentChainId, "payment chain");
  (ddos || []).forEach((d, i) => {
    if (d) add(getDdoChainId(d), `dataset ${i}`);
  });
  if (algoDdo) add(getDdoChainId(algoDdo), "algorithm");
  return out;
}

/**
 * A readable, per-env summary of where a compute env accepts payment: whether it is a
 * free env, and for a paid one each fee chainId with its accepted fee-token addresses.
 * Lets a user pick `--chainId` / `--paymentToken` without reading raw JSON. Pure so it
 * can be unit-tested; operates structurally on the ComputeEnvironment fee shape
 * (`env.fees[chainId] = [{ feeToken }, ...]`).
 */
export function summarizeComputeEnvFees(env: {
  id?: string;
  // `free` is truthy (an object/flag) on a free env in ocean.js, not a strict boolean.
  free?: unknown;
  fees?: Record<string, { feeToken?: string }[]>;
}): string {
  const isFree = Boolean(env?.free);
  const header = `Env ${env?.id ?? "?"}${isFree ? " (free)" : ""}`;
  const fees = env?.fees || {};
  const chains = Object.keys(fees);
  if (chains.length === 0) {
    return isFree
      ? `${header}: no payment required.`
      : `${header}: no payment chains advertised.`;
  }
  const lines = chains.map((chainId) => {
    const tokens = (fees[chainId] || [])
      .map((f) => f?.feeToken)
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    const tokenList =
      tokens.length > 0 ? tokens.join(", ") : "(no tokens listed)";
    return `    chain ${chainId}: ${tokenList}`;
  });
  return `${header}: pays on\n${lines.join("\n")}`;
}

/**
 * Parse the `--subsidyProviders` CLI value into the tri-state the Ocean Node expects
 * (ocean-node #1485, ocean.js #2160):
 *   - flag omitted          -> `undefined` (the node uses its configured defaults)
 *   - `none` / empty string -> `[]`        (explicitly claim with NO subsidy providers)
 *   - a CSV of addresses    -> `string[]`  (use exactly these, EIP-55 normalized)
 * Preserving the `undefined` vs `[]` distinction is essential — the ocean.js request
 * body is truthy-guarded (`if (subsidyProviders)`), and `[]` is truthy, so an empty
 * array is transmitted while `undefined` is omitted.
 * Throws on a malformed address.
 */
export function parseSubsidyProviders(raw?: string): string[] | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "none") return [];
  return trimmed.split(",").map((a) => ethers.getAddress(a.trim()));
}

/**
 * Resolve the job id for the job-only compute commands (`getJobStatus`,
 * `stopCompute`) from their positional arguments and `--job` option.
 *
 * The node needs only a job id to report or stop a job, so the dataset DID the
 * CLI used to demand is gone. For backward compatibility the old positional
 * forms are still accepted and their extra values ignored:
 *   - `getJobStatus <jobId>`                         (new, canonical)
 *   - `getJobStatus <datasetDid> <jobId>`            (legacy)
 *   - `getJobStatus <datasetDid> <jobId> <agreement>`(legacy)
 * A leading positional that looks like a DID (`did:…`) is dropped; the first
 * remaining positional is the job id. `--job` always wins over positionals.
 * Pure; returns `undefined` when no job id can be determined.
 */
export function resolveJobId(
  pos1?: string,
  pos2?: string,
  pos3?: string,
  options?: { job?: string },
): string | undefined {
  if (options?.job) return options.job;
  const positionals = [pos1, pos2, pos3].filter(
    (v): v is string => v !== undefined && v !== "",
  );
  // Legacy form led with a dataset DID; it is not needed to query the node.
  if (positionals.length > 0 && positionals[0].startsWith("did:")) {
    positionals.shift();
  }
  return positionals[0];
}

export interface ResolvedSubsidyProviders {
  /** Provider contracts to query (EIP-55, de-duplicated). */
  addresses: string[];
  /** Filter OFF: `--subsidy` addresses queried although the node does not advertise them. */
  notAdvertised: string[];
  /** Filter ON: `--subsidy` addresses dropped because the node would reject them. */
  ignored: string[];
}

/**
 * Resolve the subsidy-provider contract addresses `getNodeSubsidyStatus` reports on. The Ocean
 * Node is the source of truth for what is usable, so nothing is read from bundled config /
 * ADDRESS_FILE — the candidates are the node's status `subsidyProviders[chainId]` and the
 * caller's own `--subsidy` list, and the node's `subsidyProviderFilter` decides how they mix:
 *   - no `--subsidy`           -> the node's advertised list (error when it is empty);
 *   - `--subsidy` + filter OFF -> exactly the named addresses. The node accepts any provider
 *     a consumer names per request, so they are reported whether or not it advertises them
 *     (the ones it does not are returned in `notAdvertised`);
 *   - `--subsidy` + filter ON  -> the named addresses narrowed to the node's list, since it
 *     rejects anything else (the rest are returned in `ignored`).
 * Pure: the caller prints the notes. Throws on a malformed address or when nothing is usable.
 */
export function resolveSubsidyProviderAddresses(
  chainId: number,
  nodeProviders: Record<string, string[]> | undefined,
  filter: boolean,
  override?: string,
): ResolvedSubsidyProviders {
  const fromNode = [
    ...new Set(
      (nodeProviders?.[String(chainId)] ?? []).map((a) => ethers.getAddress(a)),
    ),
  ];
  const wanted = [
    ...new Set(
      (override ?? "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => {
          try {
            return ethers.getAddress(a);
          } catch {
            throw new Error(`Invalid --subsidy address '${a}'.`);
          }
        }),
    ),
  ];
  const nodeSet = new Set(fromNode);

  if (!filter) {
    if (wanted.length) {
      return {
        addresses: wanted,
        notAdvertised: wanted.filter((a) => !nodeSet.has(a)),
        ignored: [],
      };
    }
    if (fromNode.length === 0) {
      throw new Error(
        `This node supports subsidies but has no subsidy providers configured on chain ${chainId}. Pass --subsidy 0x... to check a specific provider (the node's provider filter is off, so it accepts providers named per request).`,
      );
    }
    return { addresses: fromNode, notAdvertised: [], ignored: [] };
  }

  if (fromNode.length === 0) {
    throw new Error(
      `This node does not support subsidy providers on chain ${chainId}: the provider filter is on and its configured list is empty, so no provider can be used.`,
    );
  }
  if (wanted.length === 0) {
    return { addresses: fromNode, notAdvertised: [], ignored: [] };
  }
  const kept = wanted.filter((a) => nodeSet.has(a));
  if (kept.length === 0) {
    throw new Error(
      `None of the --subsidy addresses are advertised by the node on chain ${chainId}, and its provider filter is on, so it would reject them.`,
    );
  }
  return {
    addresses: kept,
    notAdvertised: [],
    ignored: wanted.filter((a) => !nodeSet.has(a)),
  };
}

export interface MergedSubsidyProviders {
  /** The tri-state to hand downstream (to computePrefundedUnits / computeStart). */
  effective: string[] | undefined;
  /** Saved providers newly merged in (EIP-55) — for the "Adding…" note. */
  added: string[];
  /** Saved providers dropped because the node filter is on and does not advertise them. */
  droppedByFilter: string[];
}

/**
 * Merge the user's enabled saved subsidy providers for a chain with the node's advertised
 * set, honouring the node's provider filter. Returns `effective === undefined` (i.e. leave
 * the node to use its own defaults) when the flag was explicit, when there are no enabled
 * saved providers, or when the merge adds nothing new to the node's set — so a run with no
 * saved providers (or only already-advertised ones) is byte-for-byte identical to today.
 *
 * To get "node providers AND our enabled ones", the merged value must be the explicit union
 * `advertised ∪ keptSaved`, because passing a non-undefined list makes the node use exactly
 * those providers (a replacement of its advertised set). Pure: the caller prints the notes.
 */
export function mergeSavedSubsidyProviders(
  requested: string[] | undefined,
  chainId: number,
  nodeProviders: Record<string, string[]> | undefined,
  filter: boolean,
  savedEnabled: string[],
): MergedSubsidyProviders {
  // An explicit --subsidyProviders flag (a list or `none`/[]) wins; the saved list is ignored.
  if (requested !== undefined) {
    return { effective: requested, added: [], droppedByFilter: [] };
  }
  if (savedEnabled.length === 0) {
    return { effective: undefined, added: [], droppedByFilter: [] };
  }

  // Normalize to EIP-55 and de-duplicate. A malformed stored address (which the add
  // command prevents) is skipped defensively rather than throwing — a bad saved entry
  // must never block a job the user could otherwise run.
  const normalize = (list: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const a of list) {
      let checksummed: string;
      try {
        checksummed = ethers.getAddress(a);
      } catch {
        continue;
      }
      if (!seen.has(checksummed)) {
        seen.add(checksummed);
        out.push(checksummed);
      }
    }
    return out;
  };

  const advertised = normalize(nodeProviders?.[String(chainId)] ?? []);
  const saved = normalize(savedEnabled);
  const advertisedSet = new Set(advertised);

  let keptSaved: string[];
  let added: string[];
  let droppedByFilter: string[];
  if (filter) {
    // Filter on: the node rejects anything it does not advertise, so a saved provider it
    // does not advertise cannot be added — drop it with a note.
    droppedByFilter = saved.filter((a) => !advertisedSet.has(a));
    keptSaved = saved.filter((a) => advertisedSet.has(a));
    added = [];
  } else {
    droppedByFilter = [];
    keptSaved = saved;
    added = saved.filter((a) => !advertisedSet.has(a));
  }

  // If the merge adds nothing the node did not already advertise, run byte-for-byte as today.
  if (added.length === 0) {
    return { effective: undefined, added: [], droppedByFilter };
  }

  // advertised first, then the newly added ones, order preserved, de-duplicated.
  const effective: string[] = [...advertised];
  const effectiveSet = new Set(effective);
  for (const a of keptSaved) {
    if (!effectiveSet.has(a)) {
      effectiveSet.add(a);
      effective.push(a);
    }
  }
  return { effective, added, droppedByFilter };
}

/**
 * How much of a job's lock the subsidy providers would PRE-FUND, in token base units,
 * read off an ocean.js `estimateJobSubsidy` result. What is left is the payer's own
 * share — the only amount that has to sit in (and be authorized on) the payer's escrow.
 *
 * `requested` is the `--subsidyProviders` tri-state, and it decides which providers the
 * node will actually put in the lock:
 *   - `undefined` -> the node's own set, which is what the estimate's prefunded scenario
 *     was built from, so its projected total is used as-is;
 *   - a list      -> the node uses exactly those (a REPLACEMENT of its set), while the
 *     estimate quotes `advertised ∪ list`. Only the named providers are counted, so an
 *     advertised provider the user did not name never shrinks the payer's deposit;
 *   - `[]`        -> no subsidy, nothing is pre-funded.
 *
 * An empty prefunded selection means no provider pre-funds (or the escrow has no
 * lock-subsidy support) and yields 0. The result is capped at `lockUnits`, the node's
 * authoritative lock amount, so a client-side cost estimate above it cannot push the
 * payer share below zero.
 */
export function prefundedLockUnits(
  estimate: Pick<
    JobSubsidyEstimate,
    "providers" | "scenarios" | "maxSponsorsPerLock"
  >,
  requested: string[] | undefined,
  decimals: number,
  lockUnits: bigint,
): bigint {
  const scenario = estimate.scenarios.prefunded;
  if (scenario.selected.length === 0) return 0n;
  if (requested !== undefined && requested.length === 0) return 0n;

  let total: bigint;
  if (requested === undefined) {
    total = ethers.parseUnits(scenario.projectedTotalSubsidy, decimals);
  } else {
    // The node keeps the first `maxSponsorsPerLock` entries of the caller's list.
    const named = new Set(
      requested
        .slice(0, estimate.maxSponsorsPerLock)
        .map((a) => a.toLowerCase()),
    );
    total = estimate.providers
      .filter((p) => p.eligible && !p.dropped)
      .filter((p) => named.has(p.address.toLowerCase()))
      .reduce(
        (sum, p) =>
          sum + ethers.parseUnits(p.quotes.prefunded.subsidy, decimals),
        0n,
      );
  }
  return total > lockUnits ? lockUnits : total;
}
