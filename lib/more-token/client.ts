import {
  moreTokenCredentialState,
  moreTokenForgetCredential,
  moreTokenListInstances,
  moreTokenPair,
  moreTokenRemoveInstance,
  moreTokenRequest,
  moreTokenSaveInstance,
} from "@/lib/tauri/commands"
import type {
  CredentialState,
  ManagementEnvelope,
  ManagementErrorEnvelope,
  ManagementOperation,
  MoreTokenInstance,
  MoreTokenInstanceDraft,
  PairingResult,
} from "./types"

export class ManagementApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId = "",
    public readonly retryable = false,
    public readonly status = 0
  ) {
    super(message)
    this.name = "ManagementApiError"
  }
}

export const listInstances = (): Promise<MoreTokenInstance[]> => moreTokenListInstances()
export const saveInstance = (draft: MoreTokenInstanceDraft): Promise<MoreTokenInstance> =>
  moreTokenSaveInstance(draft)
export const removeInstance = (instanceId: string): Promise<void> =>
  moreTokenRemoveInstance(instanceId)
export const credentialState = (instanceId: string): Promise<CredentialState> =>
  moreTokenCredentialState(instanceId)
export const forgetCredential = (instanceId: string): Promise<void> =>
  moreTokenForgetCredential(instanceId)
export const pairInstance = (
  instanceId: string,
  pairingCode: string,
  clientId = "agentpack-desktop"
): Promise<PairingResult> => moreTokenPair(instanceId, pairingCode, clientId)

export async function managementRequest<T>(
  instanceId: string,
  operation: ManagementOperation,
  signal?: AbortSignal
): Promise<ManagementEnvelope<T>> {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  const response = await moreTokenRequest(instanceId, operation)
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  const body = response.body as ManagementEnvelope<T> | ManagementErrorEnvelope
  if (response.status >= 400 || body.success === false) {
    const error = body.success === false ? body.error : null
    throw new ManagementApiError(
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? "more-token request failed",
      error?.request_id,
      error?.retryable,
      response.status
    )
  }
  return body
}

export function operationId(): string {
  return typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
    ? uuidV7()
    : fallbackUuidV7()
}

function uuidV7(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let now = Date.now()
  for (let index = 0; index < 6; index += 1) {
    bytes[5 - index] = now % 256
    now = Math.floor(now / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuid(bytes)
}

function fallbackUuidV7(): string {
  const seed = `${Date.now().toString(16).padStart(12, "0")}70008000${Math.random()
    .toString(16)
    .slice(2)
    .padEnd(12, "0")}`.slice(0, 32)
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-${seed.slice(12, 16)}-${seed.slice(
    16,
    20
  )}-${seed.slice(20)}`
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`
}

export function quotaLabel(value: number, quotaPerUnit = 500_000): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value / quotaPerUnit)
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell)
          return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
        })
        .join(",")
    )
    .join("\n")
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
