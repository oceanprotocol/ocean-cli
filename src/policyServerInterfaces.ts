export interface SsiWalletSession {
  session_id: string
  status: string
  token: string
  expiration: Date
}

export interface SsiVerifiableCredential {
  id: string
  parsedDocument: {
    id: string
    type: string[]
    issuer: string
    issuanceDate: Date
    credentialSubject: Record<string, any>
  }
}

export interface SsiWalletDid {
  alias: string
  did: string
  document: string
  keyId: string
}

export enum PolicyServerActions {
  INITIATE = 'initiate',
  GET_PD = 'getPD',
  CHECK_SESSION_ID = 'checkSessionId',
  PRESENTATION_REQUEST = 'presentationRequest',
  DOWNLOAD = 'download',
  PASSTHROUGH = 'passthrough'
}

export interface PolicyServerResponse {
  success: boolean
  message: string
  httpStatus: number
}

export interface PolicyServerInitiateActionData {
  sessionId: string
  successRedirectUri: string
  errorRedirectUri: string
  responseRedirectUri: string
  presentationDefinitionUri: string
}

export interface PolicyServerInitiateComputeActionData
  extends PolicyServerInitiateActionData {
  documentId: string
  serviceId: string
}


export interface PolicyServerInitiateComputeActionData
  extends PolicyServerInitiateActionData {
  documentId: string
  serviceId: string
}

export interface PolicyServerInitiateAction {
  action: PolicyServerActions.INITIATE
  ddo: any
  policyServer: PolicyServerInitiateActionData
  serviceId: string
  consumerAddress: string
}

export interface PolicyServerGetPdAction {
  action: PolicyServerActions.GET_PD
  sessionId: string
}

export interface PolicyServerCheckSessionIdAction {
  action: PolicyServerActions.CHECK_SESSION_ID
  sessionId: string
}

export interface PolicyServerPresentationRequestAction {
  action: PolicyServerActions.PRESENTATION_REQUEST
  sessionId: string
  vp_token: any
  response: any
  presentation_submission: any
}

export interface PolicyServerDownloadAction {
  action: PolicyServerActions.DOWNLOAD
  policyServer: {
    sessionId: string
  }
}

export interface PolicyServerPassthrough {
  action: PolicyServerActions.PASSTHROUGH
  url: string
  httpMethod: 'GET'
  body: any
}

export interface PolicyServerPresentationDefinition {
  input_descriptors: any[]
}
