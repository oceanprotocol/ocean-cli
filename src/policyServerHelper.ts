import { Asset } from "@oceanprotocol/ddo-js";
import {
  PolicyServerActions,
  PolicyServerGetPdAction,
  PolicyServerInitiateAction,
  PolicyServerInitiateActionData,
  PolicyServerInitiateComputeActionData,
  PolicyServerPresentationDefinition,
  SsiVerifiableCredential,
  SsiWalletDid,
  SsiWalletSession,
} from "./policyServerInterfaces.js";
import { Signer } from "ethers";

// Bounded timeout for the node `status` probe. Without it an unresponsive node
// would hang the probe (and any download/compute waiting on it) indefinitely.
const PS_STATUS_PROBE_TIMEOUT_MS = 10_000;

/**
 * Thrown by `request()` on a non-2xx response. Carries the HTTP status and the
 * parsed body (`data`), but deliberately not the request headers, so an
 * Authorization bearer token never ends up in a logged error.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    url: string,
    statusText: string,
  ) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ""} from ${url}`);
    this.name = "HttpError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  /** Objects are JSON-encoded; strings are sent verbatim. */
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Minimal `fetch` wrapper mirroring the axios behavior this module used to rely
 * on: JSON-encodes object bodies, parses the response as JSON when it is
 * (falling back to the raw text), and throws an `HttpError` on a non-2xx status.
 */
async function request<T = any>(
  url: string,
  { method = "GET", body, headers = {}, timeoutMs }: RequestOptions = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { Accept: "application/json, text/plain, */*", ...headers },
  };
  if (body !== undefined) {
    if (typeof body === "string") {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      init.headers = { "Content-Type": "application/json", ...init.headers };
    }
  }
  if (timeoutMs) {
    init.signal = AbortSignal.timeout(timeoutMs);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = text;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON (e.g. the wallet nonce endpoint returns plain text).
    }
  }
  if (!response.ok) {
    throw new HttpError(response.status, data, url, response.statusText);
  }
  return data as T;
}

/**
 * Probe whether the target node has a policy server configured, via the
 * `status` directCommand. Returns `true` only when the node explicitly reports
 * `isPSConfigured === true`. On a `false` report, a probe error, or a timeout it
 * returns `false`, so callers can skip policy-server verification and proceed
 * rather than hanging or hard-failing on an unresponsive node.
 */
export async function isPolicyServerConfigured(
  providerUrl: string,
): Promise<boolean> {
  try {
    const status = await request(`${providerUrl}/directCommand`, {
      method: "POST",
      body: { command: "status" },
      timeoutMs: PS_STATUS_PROBE_TIMEOUT_MS,
    });
    return status?.isPSConfigured === true;
  } catch {
    return false;
  }
}

// Semver-aware "version >= minimum" comparison (numeric, dot-separated). Avoids
// the lexicographic pitfalls of comparing version strings directly (e.g.
// '5.10.0' < '5.9.0' as strings). A missing/empty version is treated as below
// any minimum. No semver package is a project dependency, so this is inlined.
export function isVersionGte(
  version: string | undefined,
  minimum: string,
): boolean {
  if (!version) return false;
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export async function connectToSSIWallet(
  owner: Signer,
  api: string,
): Promise<SsiWalletSession> {
  if (!api) {
    throw new Error("No SSI Wallet API configured");
  }

  const nonce = await request<string>(
    `${api}/wallet-api/auth/account/web3/nonce`,
  );
  const payload = {
    challenge: nonce,
    signed: await owner.signMessage(nonce),
    publicKey: await owner.getAddress(),
  };

  return request<SsiWalletSession>(
    `${api}/wallet-api/auth/account/web3/signed`,
    { method: "POST", body: payload },
  );
}

export async function sendPresentationRequest(
  walletId: string,
  did: string,
  presentationRequest: string,
  selectedCredentials: string[],
  token: string,
  api: string,
): Promise<{ redirectUri: string }> {
  if (!api) {
    throw new Error("No SSI Wallet API configured");
  }
  return request<{ redirectUri: string }>(
    `${api}/wallet-api/wallet/${walletId}/exchange/usePresentationRequest`,
    {
      method: "POST",
      body: { did, presentationRequest, selectedCredentials },
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function resolvePresentationRequest(
  walletId: string,
  presentationRequest: string,
  token: string,
  api: string,
): Promise<string> {
  if (!api) {
    throw new Error("No SSI Wallet API configured");
  }
  return request<string>(
    `${api}/wallet-api/wallet/${walletId}/exchange/resolvePresentationRequest`,
    {
      method: "POST",
      body: presentationRequest,
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getWalletDids(
  walletId: string,
  token: string,
  api: string,
): Promise<SsiWalletDid[]> {
  if (!api) {
    throw new Error("No SSI Wallet API configured");
  }
  return request<SsiWalletDid[]>(`${api}/wallet-api/wallet/${walletId}/dids`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function requestCredentialPresentation(
  asset: Asset,
  consumerAddress: string,
  serviceId: string,
  providerUrl: string,
): Promise<{
  success: boolean;
  openid4vc: string;
  policyServerData: PolicyServerInitiateActionData;
}> {
  try {
    const sessionId = crypto.randomUUID();

    const policyServer: PolicyServerInitiateActionData = {
      sessionId,
      successRedirectUri: ``,
      errorRedirectUri: ``,
      responseRedirectUri: ``,
      presentationDefinitionUri: ``,
    };

    const action: PolicyServerInitiateAction = {
      action: PolicyServerActions.INITIATE,
      ddo: asset,
      policyServer,
      serviceId,
      consumerAddress,
      documentId: asset.id,
    };
    const data = await request(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      { method: "POST", body: { policyServerPassthrough: action } },
    );

    if (data.length === 0) {
      // eslint-disable-next-line no-throw-literal
      throw { success: false, message: "No openid4vc url found" };
    }

    return {
      success: data?.success,
      openid4vc: data?.message,
      policyServerData: policyServer,
    };
  } catch (error) {
    // On an HTTP error the node's response body carries the actual reason.
    if (error instanceof HttpError && error.data) {
      throw error.data;
    }
    throw error;
  }
}

export async function matchCredentialForPresentationDefinition(
  api: string,
  walletId: string,
  presentationDefinition: any,
  token: string,
): Promise<SsiVerifiableCredential[]> {
  if (!api) {
    throw new Error("No SSI Wallet API configured");
  }
  return request<SsiVerifiableCredential[]>(
    `${api}/wallet-api/wallet/${walletId}/exchange/matchCredentialsForPresentationDefinition`,
    {
      method: "POST",
      body: presentationDefinition,
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}

export async function getPd(
  sessionId: string,
  providerUrl: string,
): Promise<PolicyServerPresentationDefinition> {
  try {
    const action: PolicyServerGetPdAction = {
      action: PolicyServerActions.GET_PD,
      sessionId,
    };
    const data = await request(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      { method: "POST", body: { policyServerPassthrough: action } },
    );

    if (typeof data === "string" && data.length === 0) {
      // eslint-disable-next-line no-throw-literal
      throw {
        success: false,
        message: "Could not read presentation definition",
      };
    }

    return data?.message;
  } catch (error) {
    if (error instanceof HttpError && error.data) {
      throw error.data;
    }
    throw error;
  }
}

export function extractURLSearchParams(
  urlString: string,
): Record<string, string> {
  const url = new URL(urlString);
  const { searchParams } = url;
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => (params[key] = value));
  return params;
}

/**
 * Resolve the policy-server object for a single asset/service.
 *
 * Returns `null` when policy-server support is unavailable — i.e. the node
 * reports it has no policy server configured (`isPSConfigured !== true`) — so
 * callers must treat `null` as "no policy server" and proceed without one. A
 * probe that fails or times out falls through to the normal flow instead of
 * masking a real error with `null`.
 */
export async function getPolicyServerOBJ(
  ddo: Asset,
  serviceId: string,
  signer: Signer,
  providerUrl: string,
): Promise<PolicyServerInitiateActionData | null> {
  try {
    try {
      const status = await request(`${providerUrl}/directCommand`, {
        method: "POST",
        body: { command: "status" },
        timeoutMs: PS_STATUS_PROBE_TIMEOUT_MS,
      });
      if (status?.isPSConfigured !== true) {
        return null;
      }
    } catch {
      // Node did not answer the status probe; fall through and attempt the
      // normal flow rather than masking a real error with a null.
    }
    const accountId = await signer.getAddress();
    const presentationResult = await requestCredentialPresentation(
      ddo,
      accountId,
      serviceId,
      providerUrl,
    );
    if (
      !presentationResult.openid4vc ||
      !presentationResult.success ||
      !presentationResult.policyServerData.sessionId
    ) {
      throw new Error("No valid openid4vc url found");
    }
    if (
      presentationResult.openid4vc &&
      typeof presentationResult.openid4vc === "object" &&
      (presentationResult.openid4vc as any).redirectUri &&
      (presentationResult.openid4vc as any).redirectUri.includes("success")
    ) {
      const { id } = extractURLSearchParams(
        (presentationResult.openid4vc as any).redirectUri,
      );
      return {
        sessionId: id,
        successRedirectUri: "",
        errorRedirectUri: "",
        responseRedirectUri: "",
        presentationDefinitionUri: "",
      };
    }
    const verifierSessionId = presentationResult.policyServerData.sessionId;

    const presentationDefinition = await getPd(verifierSessionId, providerUrl);
    const ssiApi = process.env.SSI_WALLET_API;
    if (!ssiApi) {
      throw new Error("No SSI_WALLET_API configured");
    }
    const sessionToken = await connectToSSIWallet(signer, ssiApi);
    const walletId = process.env.SSI_WALLET_ID;
    if (!walletId) {
      throw new Error("No SSI_WALLET_ID configured");
    }
    const verifiableCredentials =
      await matchCredentialForPresentationDefinition(
        ssiApi,
        walletId,
        presentationDefinition,
        sessionToken.token,
      );
    const dids = await getWalletDids(walletId, sessionToken.token, ssiApi);
    if (!dids || dids.length === 0) {
      throw new Error("No DIDs found in wallet");
    }
    const resolvedPresentationRequest = await resolvePresentationRequest(
      walletId,
      presentationResult.openid4vc,
      sessionToken.token,
      ssiApi,
    );
    const myDid = process.env.SSI_WALLET_DID;
    if (myDid && !dids.find((d) => d.did === myDid)) {
      throw new Error(`DID ${myDid} not found in wallet`);
    }
    const did = myDid ? myDid : dids[0].did;
    const result = await sendPresentationRequest(
      walletId,
      did,
      resolvedPresentationRequest,
      verifiableCredentials.map((vc) => vc.id),
      sessionToken.token,
      ssiApi,
    );
    if (
      "errorMessage" in result ||
      (result.redirectUri && result.redirectUri.includes("error"))
    ) {
      throw new Error("Credential presentation failed");
    }
    return {
      sessionId: verifierSessionId,
      successRedirectUri: "",
      errorRedirectUri: "",
      responseRedirectUri: "",
      presentationDefinitionUri: "",
    };
  } catch (error: any) {
    // Log the message only; never dump the whole error object, which could
    // wrap a request that carried the SSI wallet's Authorization bearer token.
    console.error(`getPolicyServerOBJ error: ${error?.message}`);
    if (error?.message) {
      throw new Error(`getPolicyServerOBJ failed: ${error.message}`, {
        cause: error,
      });
    }
    throw new Error("getPolicyServerOBJ failed", { cause: error });
  }
}

/**
 * Resolve policy-server objects for a set of datasets plus an optional
 * algorithm (compute flows).
 *
 * Returns `null` when policy-server support is unavailable for the job — any
 * entry below DDO v5, or any entry whose per-asset lookup yields `null` (node
 * has no policy server configured). Callers must treat `null` as "no policy
 * server" and pass it straight through to the provider (which accepts a
 * nullable `policyServer`).
 */
export async function getPolicyServerOBJs(
  ddos: {
    documentId: string;
    serviceId: string;
    asset: Asset;
    version?: string;
  }[],
  algo: {
    documentId: string;
    serviceId: string;
    asset: Asset;
    version?: string;
  } | null,
  signer: Signer,
  providerUrl: string,
): Promise<PolicyServerInitiateComputeActionData[] | null> {
  try {
    const results: PolicyServerInitiateComputeActionData[] = [];

    // --- datasets
    for (const ddo of ddos) {
      if (!isVersionGte(ddo.version, "5.0.0")) {
        return null;
      }
      const result = await getPolicyServerOBJ(
        ddo.asset,
        ddo.serviceId,
        signer,
        providerUrl,
      );
      if (!result) {
        return null;
      }
      results.push({
        ...result,
        documentId: ddo.documentId,
        serviceId: ddo.serviceId,
      });
    }

    // --- algo (only when an algorithm is present; raw/no-algo jobs keep the
    // dataset actions already collected above)
    if (algo) {
      if (!isVersionGte(algo.version, "5.0.0")) {
        return null;
      }
      if (algo.serviceId) {
        const algoResult = await getPolicyServerOBJ(
          algo.asset,
          algo.serviceId,
          signer,
          providerUrl,
        );
        if (!algoResult) {
          return null;
        }
        results.push({
          ...algoResult,
          documentId: algo.documentId,
          serviceId: algo.serviceId,
        });
      }
    }

    return results;
  } catch (error: any) {
    // Log the message only; never dump the whole error object, which could
    // wrap a request that carried the SSI wallet's Authorization bearer token.
    console.error(`getPolicyServerOBJs error: ${error?.message}`);
    if (error?.message) {
      throw new Error(`getPolicyServerOBJs failed: ${error.message}`, {
        cause: error,
      });
    }
    throw new Error("getPolicyServerOBJs failed", { cause: error });
  }
}
