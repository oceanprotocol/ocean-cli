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

export enum SSI_ACTIONS {
  INITIATE = "initiate",
  GET_PD = "getPD",
  CHECK_SESSION_ID = "checkSessionId",
  PRESENTATION_REQUEST = "presentationRequest",
  VERIFY = "verify",
  DOWNLOAD = "download"
}

export interface PolicyServerInitiateAction {
  action: SSI_ACTIONS.INITIATE;
  sessionId?: string;
  ddo: any;
  policyServer: PolicyServerInitiateActionData;
}

export interface PolicyServerGetPdAction {
  action: SSI_ACTIONS.GET_PD;
  sessionId: string;
}

export interface PolicyServerCheckSessionIdAction {
  action: SSI_ACTIONS.CHECK_SESSION_ID;
  sessionId: string;
  policyServer: any;
}

export interface PolicyServerVerifyAction {
  action: SSI_ACTIONS.VERIFY;
  vpToken: string;
}

export interface PolicyServerDownloadAction {
  action: SSI_ACTIONS.DOWNLOAD;
  policyServer: PolicyServerDownalodAction;
}

export interface PolicyServerPresentationRequestAction {
  action: SSI_ACTIONS.PRESENTATION_REQUEST;
  sessionId: string;
  vpToken: any;
  response: any;
  presentation_submission: any;
}

export interface PolicyServerDownalodAction {
  sessionId: string;
}

export type ConfigRule = {
  [key: string]: string | "*all" | "first";
};

export const ConfigRules: ConfigRule[] = [
  { VerifiableId: "*all" },
  { UniversityDegree: "first" },
  { LegalPerson: "https://example.org/legal-participant/68a5bbea9518e7e2ac1cc75bcc8819a7edd5c4711e073ffa4bb260034dc6423c/data.json" }
];


