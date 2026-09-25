import { z } from "zod"
import { isTauri } from "@/lib/tauri"
import { writeTextFile } from "@/lib/tauri/commands"
import { pickSavePath } from "@/lib/tauri/dialog"
import { getMoreTokenPort } from "./port"
import { parseManagementOperation, parseManagementResponseData } from "./schemas"
import type {
  CredentialState,
  ForgetCredentialResult,
  ManagementEnvelope,
  ManagementErrorEnvelope,
  ManagementOperation,
  ManagementStepUpPollResult,
  ManagementStepUpStartResult,
  MoreTokenInstance,
  MoreTokenInstanceDraft,
  PairingResult,
  PersonalOAuthPollResult,
  PersonalOAuthStartResult,
  QuotaDisplaySetting,
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

export const listInstances = (): Promise<MoreTokenInstance[]> => getMoreTokenPort().listInstances()
export const saveInstance = (draft: MoreTokenInstanceDraft): Promise<MoreTokenInstance> =>
  getMoreTokenPort().saveInstance(draft)
export const removeInstance = (instanceId: string): Promise<void> =>
  getMoreTokenPort().removeInstance(instanceId)
export const credentialState = (instanceId: string): Promise<CredentialState> =>
  getMoreTokenPort().credentialState(instanceId)
export const forgetCredential = (
  instanceId: string,
  allowLocalOnly = false
): Promise<ForgetCredentialResult> =>
  getMoreTokenPort().forgetCredential(instanceId, allowLocalOnly)
export const pairInstance = (
  instanceId: string,
  pairingCode: string,
  clientId = "agentpack-desktop"
): Promise<PairingResult> => getMoreTokenPort().pair(instanceId, pairingCode, clientId)
export const loginPersonalInstance = (
  instanceId: string,
  username: string,
  password: string,
  twoFactorCode: string | null,
  clientId = "agentpack-personal-desktop",
  clientLabel = "AgentPack Desktop"
): Promise<PairingResult> =>
  getMoreTokenPort().personalLogin(
    instanceId,
    username,
    password,
    twoFactorCode,
    clientId,
    clientLabel
  )
export const startPersonalOAuth = (
  instanceId: string,
  clientId = "agentpack-personal-desktop",
  clientLabel = "AgentPack Desktop"
): Promise<PersonalOAuthStartResult> =>
  getMoreTokenPort().personalOAuthStart(instanceId, clientId, clientLabel)
export const pollPersonalOAuth = (
  instanceId: string,
  handle: string
): Promise<PersonalOAuthPollResult> => getMoreTokenPort().personalOAuthPoll(instanceId, handle)
export const cancelPersonalOAuth = (instanceId: string, handle: string): Promise<void> =>
  getMoreTokenPort().personalOAuthCancel(instanceId, handle)
export const startManagementStepUp = (
  instanceId: string,
  previewToken: string
): Promise<ManagementStepUpStartResult> =>
  getMoreTokenPort().managementStepUpStart(instanceId, previewToken)
export const pollManagementStepUp = (
  instanceId: string,
  handle: string
): Promise<ManagementStepUpPollResult> =>
  getMoreTokenPort().managementStepUpPoll(instanceId, handle)
export const cancelManagementStepUp = (instanceId: string, handle: string): Promise<void> =>
  getMoreTokenPort().managementStepUpCancel(instanceId, handle)

const successEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
  request_id: z.string(),
  server_time: z.number(),
})
const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
    retryable: z.boolean(),
    details: z.unknown().optional(),
  }),
})

export async function managementRequest<T>(
  instanceId: string,
  operation: ManagementOperation,
  signal?: AbortSignal
): Promise<ManagementEnvelope<T>> {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  const response = await getMoreTokenPort().request(instanceId, parseManagementOperation(operation))
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  const parsedBody =
    response.status >= 400
      ? errorEnvelopeSchema.safeParse(response.body)
      : successEnvelopeSchema.safeParse(response.body)
  if (!parsedBody.success) {
    throw new ManagementApiError(
      "INVALID_SERVER_RESPONSE",
      "more-token returned an invalid response",
      "",
      false,
      response.status
    )
  }
  const body = parsedBody.data as ManagementEnvelope<T> | ManagementErrorEnvelope
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
  try {
    return { ...body, data: parseManagementResponseData(operation, body.data) as T }
  } catch {
    throw new ManagementApiError(
      "INVALID_SERVER_RESPONSE",
      `more-token returned invalid data for ${operation.kind}`,
      body.request_id,
      false,
      response.status
    )
  }
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

export function quotaDisplayAmount(value: number, display: QuotaDisplaySetting): number | null {
  if (
    !Number.isFinite(value) ||
    display.quota_per_unit <= 0 ||
    display.conversion_numerator <= 0 ||
    display.conversion_denominator <= 0 ||
    (display.rate_valid_until > 0 && display.rate_valid_until <= Math.floor(Date.now() / 1000))
  ) {
    return null
  }
  return (
    (value / display.quota_per_unit) *
    (display.conversion_numerator / display.conversion_denominator)
  )
}

export function quotaCurrencyLabel(value: number, display: QuotaDisplaySetting): string {
  const amount = quotaDisplayAmount(value, display)
  const raw = `${new Intl.NumberFormat().format(value)} quota`
  if (amount === null) return raw
  const isSmallNonZeroAmount = Math.abs(amount) > 0 && Math.abs(amount) < 0.01
  try {
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: display.display_currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: isSmallNonZeroAmount ? 4 : 2,
    }).format(amount)
    return `${formatted} · ${raw}`
  } catch {
    return `${amount.toFixed(isSmallNonZeroAmount ? 4 : 2)} ${display.display_currency} · ${raw}`
  }
}

/**
 * `quotaCurrencyLabel` split into its converted half and its raw-quota half, so
 * a panel can lead with the amount and demote the authoritative raw quota to a
 * meta line instead of printing both in one run-on string. `raw` is null
 * exactly when the raw quota IS the label.
 */
export function quotaCurrencyParts(
  value: number,
  display: QuotaDisplaySetting
): { primary: string; raw: string | null } {
  const label = quotaCurrencyLabel(value, display)
  const separator = label.indexOf(" · ")
  if (separator < 0) return { primary: label, raw: null }
  return { primary: label.slice(0, separator), raw: label.slice(separator + 3) }
}

/** The file body, BOM first so a spreadsheet opens it as UTF-8. */
export function csvText(rows: Array<Array<string | number>>): string {
  return `\ufeff${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}`
}

export type CsvSaveResult =
  { kind: "saved"; path: string } | { kind: "downloaded" } | { kind: "cancelled" }

/**
 * The desktop build is a WebKit view, where `<a download>` on a blob URL does
 * nothing at all \u2014 so there it goes through the native save dialog and the
 * Rust writer, like the usage export. Only web mode (the injected e2e port)
 * falls back to a blob download, and even there the URL outlives the click:
 * WebKit reads the blob after `click()` returns.
 */
export async function downloadCsv(
  filename: string,
  rows: Array<Array<string | number>>
): Promise<CsvSaveResult> {
  const text = csvText(rows)
  if (isTauri()) {
    const path = await pickSavePath({
      defaultPath: filename,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    })
    if (!path) return { kind: "cancelled" }
    await writeTextFile(path, text)
    return { kind: "saved", path }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { kind: "downloaded" }
}

export function escapeCsvCell(cell: string | number): string {
  let value = String(cell)
  if (/^[\t\r ]*[=+\-@]/.test(value)) value = `'${value}`
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function sameOriginServerUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl)
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("SERVER_URL_NOT_ALLOWED")
  const target = new URL(path, base)
  if (target.origin !== base.origin || target.username || target.password) {
    throw new Error("SERVER_URL_NOT_ALLOWED")
  }
  return target.toString()
}
