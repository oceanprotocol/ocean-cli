export interface SsiWalletSession {
  session_id: string
  status: string
  token: string
  expiration: Date
}

export interface SsiWalletDesc {
  id: string
  name: string
  createdOn: Date
  addedOn: Date
  permission: string
}

export interface SsiKeyDesc {
  algorithm: string
  cryptoProvider: string
  keyId: {
    id: string
  }
}

export interface PolicyServerInitiateActionData {
  successRedirectUri: string
  errorRedirectUri: string
  responseRedirectUri: string
  presentationDefinitionUri: string
}

export interface PolicyServerInitiateAction {
  action: 'initiate'
  sessionId?: string
  ddo: any
  policyServer: PolicyServerInitiateActionData
}