import { ConfigRules, PolicyServerCheckSessionIdAction, PolicyServerDownalodAction, PolicyServerDownloadAction, PolicyServerGetPdAction, PolicyServerInitiateAction, PolicyServerInitiateActionData, PolicyServerResponse, PolicyServerVerifyAction, SSI_ACTIONS, SsiKeyDesc, SsiWalletDesc } from "types/ssiType";
import axios from 'axios'
import { randomUUID } from "crypto";
import { Signer } from "ethers";

function extractSessionId(url: string): string | null {
  const match = url.match(/[?&]state=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function checkCredentials(ddo: any, providerUrl: string, waltIdWalletApi: string, signer: Signer): Promise<{ downloadEnabled: boolean; policyServer: PolicyServerDownalodAction }> {
  try {
    const credentialPresentation = await requestCredentialPresentation(ddo, providerUrl);
    const sessionId = extractSessionId(credentialPresentation.openid4vc)
    const pd = await getPd(sessionId, providerUrl)
    await checkSessionId(sessionId, providerUrl)
    const token = await getSSIToken(waltIdWalletApi, signer);
    const wallets = await getSSIWallets(token, waltIdWalletApi);
    const walletId = wallets[0].id;
    const credentials = await getVerifiableCredentials(waltIdWalletApi, walletId, token, pd);
    const filteredCredentials = filterCredentials(credentials, ConfigRules);
    const dids = await getDIDs(waltIdWalletApi, walletId, token);
    const selectedDid = dids[0];
    const presentationRequest = credentialPresentation.openid4vc
    const consumer = selectedDid.did
    const selectedCredentials = filteredCredentials.map(cred => cred.parsedDocument.id);

    const resolvedPr = await resolvePresentationRequest(waltIdWalletApi, walletId, presentationRequest, token);
    const userPrResponse = await usePresentationRequest(waltIdWalletApi, walletId, resolvedPr, consumer, selectedCredentials, token);

    if (userPrResponse.redirectUri.includes('success')) {
      return {
        downloadEnabled: true,
        policyServer: { sessionId }
      };
    }
    return {
      downloadEnabled: false,
      policyServer: { sessionId }
    };
  } catch (error) {
    return { downloadEnabled: false, policyServer: { sessionId: null } };
  }
}

export async function getSSIToken(waltIdWalletApi: string, signer: Signer): Promise<string> {
  const responseNonce = await axios.get(`${waltIdWalletApi}/wallet-api/auth/account/web3/nonce`)
  const nonce = responseNonce.data
  const payload = {
    challenge: nonce,
    signed: await signer.signMessage(nonce),
    publicKey: await signer.getAddress()
  }

  const responseSigned = await axios.post(
    `${waltIdWalletApi}/wallet-api/auth/account/web3/signed`,
    payload
  )
  return responseSigned.data?.token
}

export async function getSSIWallets(token: string, waltIdWalletApi: string): Promise<SsiWalletDesc[]> {
  try {
    const response = await axios.get(
      `${waltIdWalletApi}/wallet-api/wallet/accounts/wallets`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        withCredentials: true,
      }
    )

    const result: { wallets: SsiWalletDesc[] } = response.data
    return result.wallets
  } catch (error) {
    throw error.response
  }
}

export async function getSSIWalletKeys(
  wallet: SsiWalletDesc,
  token: string,
  waltIdWalletApi: string
): Promise<SsiKeyDesc[]> {
  try {
    const response = await axios.get(
      `${waltIdWalletApi}/wallet-api/wallet/${wallet?.id}/keys`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        withCredentials: true,
      }
    )
    return response.data
  } catch (error) {
    throw error.response
  }
}

export async function requestCredentialPresentation(ddo: any, providerUrl: string): Promise<{
  success: boolean
  openid4vc: string
  policyServerData: PolicyServerInitiateActionData
}> {
  const sessionId = randomUUID()

  const policyServer: PolicyServerInitiateActionData = {
    successRedirectUri: ``,
    errorRedirectUri: ``,
    responseRedirectUri: ``,
    presentationDefinitionUri: ``
  }

  const action: PolicyServerInitiateAction = {
    action: SSI_ACTIONS.INITIATE,
    sessionId,
    ddo,
    policyServer
  }

  try {
    const response = await axios.post(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      {
        policyServerPassthrough: action
      }
    )
    if (response.data.length === 0) {
      throw { success: false, message: 'No openid4vc url found' }
    }

    return {
      success: response.data?.success,
      openid4vc: response.data?.message,
      policyServerData: policyServer
    }
  } catch (error) {
    if (error.response?.data) {
      throw error.response?.data
    }
    throw error
  }
}

export async function getPd(sessionId: string, providerUrl: string): Promise<PolicyServerResponse> {
  const action: PolicyServerGetPdAction = {
    action: SSI_ACTIONS.GET_PD,
    sessionId
  }
  try {
    const response = await axios.post(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      {
        policyServerPassthrough: action
      }
    )

    if (response.data.length === 0) {
      throw { success: false, message: 'Error Pd' }
    }
    return {
      success: response.data?.success,
      message: response.data?.message,
    }
  } catch (error) {
    if (error.response?.data) {
      throw error.response?.data
    }
    throw error
  }
}

export async function verify(vpToken: string, providerUrl: string): Promise<PolicyServerResponse> {
  const action: PolicyServerVerifyAction = {
    action: SSI_ACTIONS.VERIFY,
    vpToken
  }
  try {
    const response = await axios.post(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      {
        policyServerPassthrough: action
      }
    )

    if (response.data.length === 0) {
      throw { success: false, message: 'Error verify' }
    }
    return {
      success: response.data?.success,
      message: response.data?.message,
    }
  } catch (error) {
    if (error.response?.data) {
      throw error.response?.data
    }
    throw error
  }
}

export async function checkSessionId(sessionId: string, providerUrl: string): Promise<PolicyServerResponse> {
  const action: PolicyServerCheckSessionIdAction = {
    action: SSI_ACTIONS.CHECK_SESSION_ID,
    sessionId,
    policyServer: {}
  }
  try {
    const response = await axios.post(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      {
        policyServerPassthrough: action
      }
    )
    if (response.data.length === 0) {
      throw { success: false, message: 'Error check session id' }
    }
    return {
      success: true,
      message: response.data?.message,
    }
  } catch (error) {
    if (error.response?.data) {
      throw error.response?.data
    }
    throw error
  }
}

export async function download(sessionId: string, providerUrl: string): Promise<PolicyServerResponse> {
  const policyServer = {
    sessionId
  }
  const action: PolicyServerDownloadAction = {
    action: SSI_ACTIONS.DOWNLOAD,
    policyServer
  }
  try {
    const response = await axios.post(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      {
        policyServerPassthrough: action
      }
    )

    if (response.data.length === 0) {
      throw { success: false, message: 'Error download' }
    }
    return {
      success: true,
      message: response.data?.message,
    }
  } catch (error) {
    if (error.response?.data) {
      throw error.response?.data
    }
    throw error
  }
}

export function filterCredentials(credentials, configRules) {
  const result = [];

  for (const rule of configRules) {
    const key = Object.keys(rule)[0];
    const condition = rule[key];

    const matchingCredentials = credentials.filter(c => {
      return (
        c.parsedDocument?.type &&
        Array.isArray(c.parsedDocument.type) &&
        c.parsedDocument.type.includes(key)
      );
    });

    if (condition === "*all") {
      result.push(...matchingCredentials);
    } else if (condition === "first") {
      if (matchingCredentials.length > 0) {
        result.push(matchingCredentials[0]);
      }
    } else {
      const specificMatch = matchingCredentials.find(c => {
        return (
          c.parsedDocument?.credentialSubject?.degree?.type === condition
        );
      });
      if (specificMatch) {
        result.push(specificMatch);
      }
    }
  }

  return result;
}


async function getVerifiableCredentials(
  waltIdWalletApi: string,
  walletId: string,
  token: string,
  pd: PolicyServerResponse
): Promise<any[]> {
  try {
    const url = `${waltIdWalletApi.replace(/\/+$/, '')}/wallet-api/wallet/${walletId}/exchange/matchCredentialsForPresentationDefinition`;
    const presentationDefinition = pd.message;
    const response = await axios.post(
      url,
      presentationDefinition,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        withCredentials: true,
      }
    );

    if (response.data && Array.isArray(response.data)) {
      return response.data;
    } else {
      throw new Error('No Verifiable Credentials found');
    }
  } catch (error) {
    console.error('Error fetching Verifiable Credentials:');
    throw error;
  }
}

async function resolvePresentationRequest(waltIdWalletApi: string, walletId: string, presentationRequest: string, token: string): Promise<string> {
  try {
    const response = await axios.post(
      `${waltIdWalletApi}/wallet-api/wallet/${walletId}/exchange/resolvePresentationRequest`,
      presentationRequest,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        withCredentials: true,
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error resolving Presentation Request');
    throw error;
  }
}
async function usePresentationRequest(waltIdWalletApi: string, walletId: string, presentationRequest: string, did: string, selectedCredentials: string[], token: string): Promise<any> {
  try {
    const response = await axios.post(
      `${waltIdWalletApi}/wallet-api/wallet/${walletId}/exchange/usePresentationRequest`,
      { did, presentationRequest, selectedCredentials },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        withCredentials: true,
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error resolving Presentation Request');
    throw error;
  }
}

async function getDIDs(
  waltIdWalletApi: string,
  walletId: string,
  token: string
): Promise<any[]> {
  try {
    const response = await axios.get(
      `${waltIdWalletApi}/wallet-api/wallet/${walletId}/dids`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        withCredentials: true,
      }
    );
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    } else {
      throw new Error('No DIDs found');
    }
  } catch (error) {
    console.error('Error fetching DIDs');
    throw error;
  }
}

