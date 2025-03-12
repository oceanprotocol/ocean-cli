import { ConfigRules, PolicyServerCheckSessionIdAction, PolicyServerDownalodAction, PolicyServerDownloadAction, PolicyServerGetPdAction, PolicyServerInitiateAction, PolicyServerInitiateActionData, PolicyServerVerifyAction, SSI_ACTIONS, SsiKeyDesc, SsiWalletDesc } from "types/ssiType";
import axios from 'axios'
import { randomUUID } from "crypto";
import { Signer } from "ethers";

function extractSessionId(url: string): string | null {
  const match = url.match(/[?&]state=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function checkCredentials(ddo: any, providerUrl: string): Promise<{ downloadEnabled: boolean; policyServer: PolicyServerDownalodAction }> {
  try {
    const credentialPresentation = await requestCredentialPresentation(ddo, providerUrl);
    console.log('credentialPresentation:', credentialPresentation)
    const sessionId = extractSessionId(credentialPresentation.openid4vc)
    console.log('sessionId:', sessionId)
    const pd = await getPd(sessionId, providerUrl)
    console.log('pd:', pd)
    //TODO get from pd.input_descriptors and match with ours from wallet and fileter only that with config
    const checkSessionIdResult = await checkSessionId(sessionId, providerUrl)
    console.log("checkSessionIdResult", checkSessionIdResult)
    const downloadResult = await download(sessionId, providerUrl)
    console.log('downloadResult', downloadResult)
    // Ensure result structure has downloadEnabled or default to false
    return {
      downloadEnabled: false,
      policyServer: { sessionId }
    };
  } catch (error) {
    console.log('Error verifying credentials:', error);
    return { downloadEnabled: false, policyServer: { sessionId: null } };
  }
}

export async function getSSIToken(waltIdWalletApi: string, signer: Signer): Promise<string> {
  console.log("this.waltIdWalletApi", waltIdWalletApi)
  const responseNonce = await axios.get(`${waltIdWalletApi}/wallet-api/auth/account/web3/nonce`)
  console.log('response nonce status:', responseNonce.status)
  console.log('nonce:', responseNonce.data)
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
  console.log('token:', responseSigned.data?.token)
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
    successRedirectUri: `${providerUrl}/api/policy/success`,
    errorRedirectUri: `${providerUrl}/api/policy/error`,
    responseRedirectUri: `${providerUrl}/policy/verify/${sessionId}`,
    presentationDefinitionUri: `${providerUrl}/policy/pd/${sessionId}`
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

export async function getPd(sessionId: string, providerUrl: string): Promise<{
  success: boolean
  message: string
}> {
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

export async function verify(vpToken: string, providerUrl: string): Promise<{
  success: boolean
  message: string
}> {
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

export async function checkSessionId(sessionId: string, providerUrl: string): Promise<{
  success: boolean
  message: string
}> {
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

export async function download(sessionId: string, providerUrl: string): Promise<{
  success: boolean
  message: string
}> {
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

//TODO define type credential
export function filterCredentials(credentials: any[]): any[] {
  const result = [];

  for (const rule of ConfigRules) {
    const key = Object.keys(rule)[0];
    const condition = rule[key];

    const matchingCredentials = credentials.filter(c => c.type === key);

    if (condition === "*all") {
      result.push(...matchingCredentials);
    } else if (condition === "first") {
      if (matchingCredentials.length > 0) {
        result.push(matchingCredentials[0]);
      }
    } else {
      const specificMatch = matchingCredentials.find(c => c.value === condition);
      if (specificMatch) {
        result.push(specificMatch);
      }
    }
  }

  return result;
}