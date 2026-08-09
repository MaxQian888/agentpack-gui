import {
  moreTokenCredentialState,
  moreTokenForgetCredential,
  moreTokenListInstances,
  moreTokenManagementStepUpCancel,
  moreTokenManagementStepUpPoll,
  moreTokenManagementStepUpStart,
  moreTokenPair,
  moreTokenPersonalLogin,
  moreTokenPersonalOAuthCancel,
  moreTokenPersonalOAuthPoll,
  moreTokenPersonalOAuthStart,
  moreTokenRemoveInstance,
  moreTokenRequest,
  moreTokenSaveInstance,
} from "@/lib/tauri/commands"
import type {
  CredentialState,
  ForgetCredentialResult,
  ManagementOperation,
  ManagementStepUpPollResult,
  ManagementStepUpStartResult,
  MoreTokenInstance,
  MoreTokenInstanceDraft,
  PairingResult,
  PersonalOAuthPollResult,
  PersonalOAuthStartResult,
} from "./types"

export interface MoreTokenPort {
  listInstances(): Promise<MoreTokenInstance[]>
  saveInstance(draft: MoreTokenInstanceDraft): Promise<MoreTokenInstance>
  removeInstance(instanceId: string): Promise<void>
  credentialState(instanceId: string): Promise<CredentialState>
  forgetCredential(instanceId: string, allowLocalOnly: boolean): Promise<ForgetCredentialResult>
  pair(instanceId: string, pairingCode: string, clientId: string): Promise<PairingResult>
  personalLogin(
    instanceId: string,
    username: string,
    password: string,
    twoFactorCode: string | null,
    clientId: string,
    clientLabel: string
  ): Promise<PairingResult>
  personalOAuthStart(
    instanceId: string,
    clientId: string,
    clientLabel: string
  ): Promise<PersonalOAuthStartResult>
  personalOAuthPoll(instanceId: string, handle: string): Promise<PersonalOAuthPollResult>
  personalOAuthCancel(instanceId: string, handle: string): Promise<void>
  managementStepUpStart(
    instanceId: string,
    previewToken: string
  ): Promise<ManagementStepUpStartResult>
  managementStepUpPoll(instanceId: string, handle: string): Promise<ManagementStepUpPollResult>
  managementStepUpCancel(instanceId: string, handle: string): Promise<void>
  request(
    instanceId: string,
    operation: ManagementOperation
  ): Promise<{ status: number; body: unknown }>
}

export const tauriMoreTokenPort: MoreTokenPort = {
  listInstances: moreTokenListInstances,
  saveInstance: moreTokenSaveInstance,
  removeInstance: moreTokenRemoveInstance,
  credentialState: moreTokenCredentialState,
  forgetCredential: moreTokenForgetCredential,
  pair: moreTokenPair,
  personalLogin: moreTokenPersonalLogin,
  personalOAuthStart: moreTokenPersonalOAuthStart,
  personalOAuthPoll: moreTokenPersonalOAuthPoll,
  personalOAuthCancel: moreTokenPersonalOAuthCancel,
  managementStepUpStart: moreTokenManagementStepUpStart,
  managementStepUpPoll: moreTokenManagementStepUpPoll,
  managementStepUpCancel: moreTokenManagementStepUpCancel,
  request: moreTokenRequest,
}

let activePort: MoreTokenPort = tauriMoreTokenPort

export function getMoreTokenPort(): MoreTokenPort {
  return activePort
}

export function setMoreTokenPortForTests(port: MoreTokenPort | null): void {
  activePort = port ?? tauriMoreTokenPort
}

export function createMemoryMoreTokenPort(overrides: Partial<MoreTokenPort> = {}): MoreTokenPort {
  const unsupported = async (): Promise<never> => {
    throw new Error("MEMORY_PORT_OPERATION_NOT_IMPLEMENTED")
  }
  return {
    listInstances: async () => [],
    saveInstance: unsupported,
    removeInstance: async () => undefined,
    credentialState: async () => ({ connected: false, persistent: false }),
    forgetCredential: async () => ({ remoteRevoked: false, localDeleted: true, remoteError: null }),
    pair: unsupported,
    personalLogin: unsupported,
    personalOAuthStart: unsupported,
    personalOAuthPoll: unsupported,
    personalOAuthCancel: async () => undefined,
    managementStepUpStart: unsupported,
    managementStepUpPoll: unsupported,
    managementStepUpCancel: async () => undefined,
    request: unsupported,
    ...overrides,
  }
}
