import { Asset } from "@oceanprotocol/ddo-js"
import { PolicyServerActions, PolicyServerGetPdAction, PolicyServerInitiateAction, PolicyServerInitiateActionData, PolicyServerInitiateComputeActionData, PolicyServerPresentationDefinition, SsiVerifiableCredential, SsiWalletDid, SsiWalletSession } from "./policyServerInterfaces"
import axios from "axios"
import { Signer } from "ethers"

export async function connectToSSIWallet(
  owner: Signer,
  api: string
): Promise<SsiWalletSession> {
  if (!api) {
    throw new Error('No SSI Wallet API configured')
  }

  try {
    let response = await axios.get(`${api}/wallet-api/auth/account/web3/nonce`)

    const nonce = response.data
    const payload = {
      challenge: nonce,
      signed: await owner.signMessage(nonce),
      publicKey: await owner.getAddress()
    }

    response = await axios.post(
      `${api}/wallet-api/auth/account/web3/signed`,
      payload
    )
    return response.data
  } catch (error) {
    throw error.response
  }
}

export async function sendPresentationRequest(
  walletId: string,
  did: string,
  presentationRequest: string,
  selectedCredentials: string[],
  token: string,
  api: string
): Promise<{ redirectUri: string }> {
  if (!api) {
    throw new Error('No SSI Wallet API configured')
  }
  try {
    const response = await axios.post(
      `${api}/wallet-api/wallet/${walletId}/exchange/usePresentationRequest`,
      {
        did,
        presentationRequest,
        selectedCredentials
      },
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        withCredentials: true
      }
    )

    return response.data
  } catch (error) {
    throw error.response
  }
}

export async function resolvePresentationRequest(
  walletId: string,
  presentationRequest: string,
  token: string,
  api: string
): Promise<string> {
  if (!api) {
    throw new Error('No SSI Wallet API configured')
  }
  try {
    const response = await axios.post(
      `${api}/wallet-api/wallet/${walletId}/exchange/resolvePresentationRequest`,
      presentationRequest,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        withCredentials: true
      }
    )

    return response.data
  } catch (error) {
    throw error.response
  }
}

export async function getWalletDids(
  walletId: string,
  token: string,
  api: string
): Promise<SsiWalletDid[]> {
  if (!api) {
    throw new Error('No SSI Wallet API configured')
  }
  try {
    const response = await axios.get(
      `${api}/wallet-api/wallet/${walletId}/dids`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        withCredentials: true
      }
    )

    return response.data
  } catch (error) {
    throw error.response
  }
}


export async function requestCredentialPresentation(
  asset: Asset,
  consumerAddress: string,
  serviceId: string,
  providerUrl: string
): Promise<{
  success: boolean
  openid4vc: string
  policyServerData: PolicyServerInitiateActionData,
}> {
  try {
    const sessionId = crypto.randomUUID()

    const policyServer: PolicyServerInitiateActionData = {
      sessionId,
      successRedirectUri: ``,
      errorRedirectUri: ``,
      responseRedirectUri: ``,
      presentationDefinitionUri: ``
    }

    const action: PolicyServerInitiateAction = {
      action: PolicyServerActions.INITIATE,
      ddo: asset,
      policyServer,
      serviceId,
      consumerAddress
    }
    const response = await axios.post(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      {
        policyServerPassthrough: action
      }
    )

    if (response.data.length === 0) {
      // eslint-disable-next-line no-throw-literal
      throw { success: false, message: 'No openid4vc url found' }
    }

    return {
      success: response.data?.success,
      openid4vc: response.data?.message,
      policyServerData: policyServer
    }
  } catch (error) {
    if (error.request?.response) {
      const err = JSON.parse(error.request.response)
      throw err
    }
    if (error.response?.data) {
      throw error.response?.data
    }
    throw error
  }
}

export async function matchCredentialForPresentationDefinition(
  api: string,
  walletId: string,
  presentationDefinition: any,
  token: string
): Promise<SsiVerifiableCredential[]> {
  if (!api) {
    throw new Error('No SSI Wallet API configured')
  }
  try {
    const response = await axios.post(
      `${api}/wallet-api/wallet/${walletId}/exchange/matchCredentialsForPresentationDefinition`,
      presentationDefinition,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        withCredentials: true
      }
    )

    return response.data
  } catch (error) {
    throw error.response
  }
}

export async function getPd(
  sessionId: string,
  providerUrl: string
): Promise<PolicyServerPresentationDefinition> {
  try {
    const action: PolicyServerGetPdAction = {
      action: PolicyServerActions.GET_PD,
      sessionId
    }
    const response = await axios.post(
      `${providerUrl}/api/services/PolicyServerPassthrough`,
      {
        policyServerPassthrough: action
      }
    )

    if (typeof response.data === 'string' && response.data.length === 0) {
      // eslint-disable-next-line no-throw-literal
      throw {
        success: false,
        message: 'Could not read presentation definition'
      }
    }

    return response.data?.message
  } catch (error) {
    if (error.response?.data) {
      throw error.response?.data
    }
    throw error
  }
}

export function extractURLSearchParams(
  urlString: string
): Record<string, string> {
  const url = new URL(urlString)
  const { searchParams } = url
  const params: Record<string, string> = {}
  searchParams.forEach((value, key) => (params[key] = value))
  return params
}

export async function getPolicyServerOBJ(
  ddo: Asset,
  serviceId: string,
  signer: Signer,
  providerUrl: string
): Promise<PolicyServerInitiateActionData> {
  try {
    const accountId = await signer.getAddress()
    const presentationResult = await requestCredentialPresentation(
      ddo,
      accountId,
      serviceId,
      providerUrl
    )

    if (
      !presentationResult.openid4vc ||
      !presentationResult.success ||
      !presentationResult.policyServerData.sessionId
    ) {
      throw new Error('No valid openid4vc url found')
    }
    const verifierSessionId = presentationResult.policyServerData.sessionId

    const presentationDefinition = await getPd(verifierSessionId, providerUrl)
    const ssiApi = process.env.SSI_WALLET_API
    if (!ssiApi) {
      throw new Error('No SSI_WALLET_API configured')
    }
    const sessionToken = await connectToSSIWallet(signer, ssiApi)
    const walletId = process.env.SSI_WALLET_ID
    if (!walletId) {
      throw new Error('No SSI_WALLET_ID configured')
    }
    const verifiableCredentials = await matchCredentialForPresentationDefinition(
      ssiApi,
      walletId,
      presentationDefinition,
      sessionToken.token
    )
    const dids = await getWalletDids(
      walletId,
      sessionToken.token,
      ssiApi
    )
    if (!dids || dids.length === 0) {
      throw new Error('No DIDs found in wallet')
    }
    const resolvedPresentationRequest = await resolvePresentationRequest(
      walletId,
      presentationResult.openid4vc,
      sessionToken.token,
      ssiApi
    )
    const myDid = process.env.SSI_WALLET_DID
    if (myDid && !dids.find((d) => d.did === myDid)) {
      throw new Error(`DID ${myDid} not found in wallet`)
    }
    const did = myDid ? myDid : dids[0].did
    const result = await sendPresentationRequest(
      walletId,
      did,
      resolvedPresentationRequest,
      verifiableCredentials.map((vc) => vc.id),
      sessionToken.token,
      ssiApi
    )
    if (
      'errorMessage' in result ||
      (result.redirectUri && result.redirectUri.includes('error'))
    ) {
      throw new Error('Credential presentation failed')
    }
    return {
      sessionId: verifierSessionId,
      successRedirectUri: '',
      errorRedirectUri: '',
      responseRedirectUri: '',
      presentationDefinitionUri: ''
    }
  } catch (error: any) {
    console.error('getPolicyServerOBJ error:', error)
    if (error?.message) {
      throw new Error(`getPolicyServerOBJ failed: ${error.message}`)
    }
    throw new Error('getPolicyServerOBJ failed')
  }
}

export async function getPolicyServerOBJs(
  ddos: {
    documentId: string
    serviceId: string
    asset: Asset
    version?: string
  }[],
  algo: {
    documentId: string
    serviceId: string
    asset: Asset
    version?: string
  },
  signer: Signer,
  providerUrl: string
): Promise<PolicyServerInitiateComputeActionData[] | null> {
  try {
    const results: PolicyServerInitiateComputeActionData[] = []

    // --- datasets
    for (const ddo of ddos) {
      if (!ddo.version || ddo.version < '5.0.0') {
        return null
      }
      const result = await getPolicyServerOBJ(
        ddo.asset,
        ddo.serviceId,
        signer,
        providerUrl
      )
      results.push({
        ...result,
        documentId: ddo.documentId,
        serviceId: ddo.serviceId
      })
    }

    // --- algo
    if (!algo?.version || algo.version < '5.0.0') {
      return null
    }
    if (algo.serviceId) {
      const algoResult = await getPolicyServerOBJ(
        algo.asset,
        algo.serviceId,
        signer,
        providerUrl
      )
      results.push({
        ...algoResult,
        documentId: algo.documentId,
        serviceId: algo.serviceId
      })
    }

    return results
  } catch (error: any) {
    console.error('getPolicyServerOBJs error:', error)
    if (error?.message) {
      throw new Error(`getPolicyServerOBJs failed: ${error.message}`)
    }
    throw new Error('getPolicyServerOBJs failed')
  }
}
