import { z } from "zod"
import type { ManagementOperation } from "./types"

const MAX_SAFE_QUOTA = Number.MAX_SAFE_INTEGER
const id = z.number().int().positive().max(MAX_SAFE_QUOTA)
const page = z.number().int().positive().max(1_000_000)
const pageSize = z.number().int().positive().max(200)
const quota = z.number().int().nonnegative().max(MAX_SAFE_QUOTA)
const positiveQuota = z.number().int().positive().max(MAX_SAFE_QUOTA)
const operationId = z.uuid({ version: "v7" })
const reason = z.string().trim().min(1).max(512)
const previewToken = z.string().min(32).max(256)
const nullableText = z.string().max(256).nullable().optional()

const previewAuthorization = {
  preview_token: previewToken,
  operation_id: operationId,
  reason,
}

const quotaDisplay = {
  quota_per_unit: positiveQuota,
  display_currency: z.string().regex(/^[A-Z]{3}$/),
  conversion_numerator: positiveQuota,
  conversion_denominator: positiveQuota,
  rate_valid_until: z.number().int().nonnegative(),
  version: z.number().int().positive(),
}

const quotaPolicy = {
  id: id.optional(),
  master_id: id,
  minimum_reserve: quota,
  child_balance_cap: quota,
  single_transfer_limit: quota,
  daily_transfer_limit: quota,
  auto_refill_enabled: z.boolean(),
  auto_refill_threshold: quota,
  auto_refill_amount: quota,
  auto_refill_daily_cap: quota,
  auto_refill_cooldown_sec: z.number().int().nonnegative(),
  monthly_soft_budget: quota,
  disable_on_exhaustion: z.boolean(),
  version: z.number().int().positive(),
}

const mutationSchemas = {
  updateQuotaDisplay: z.object({
    kind: z.literal("updateQuotaDisplay"),
    body: z.object({ ...quotaDisplay, preview_token: previewToken, reason }),
  }),
  createAccount: z.object({
    kind: z.literal("createAccount"),
    body: z.object({
      ...previewAuthorization,
      username: z.string().trim().min(1).max(64),
      display_name: z.string().trim().max(64),
      email: z.email().or(z.literal("")),
      group: z.string().trim().min(1).max(64),
      master_id: z.number().int().nonnegative(),
      initial_quota: quota,
      invite_by_email: z.boolean(),
    }),
  }),
  createAccountBatch: z.object({
    kind: z.literal("createAccountBatch"),
    body: z.object({
      batch_operation_id: operationId,
      mode: z.enum(["atomic", "best_effort"]),
      action: z.enum(["enable", "disable", "archive", "restore", "detach"]),
      account_ids: z.array(id).min(1).max(500),
      reason,
      preview_token: previewToken,
    }),
  }),
  actionPreview: z.object({
    kind: z.literal("actionPreview"),
    body: z.object({
      action: z.string().trim().min(1).max(64),
      payload: z.record(z.string(), z.unknown()),
    }),
  }),
  accountAction: z.object({
    kind: z.literal("accountAction"),
    id,
    action: z.enum([
      "enable",
      "disable",
      "archive",
      "restore",
      "attach",
      "detach",
      "promote",
      "demote",
      "password",
    ]),
    body: z.object({
      ...previewAuthorization,
      master_id: z.number().int().nonnegative().optional(),
      balance_target_id: z.number().int().nonnegative().optional(),
      write_off: z.boolean().optional(),
      password: z.string().max(20).optional(),
    }),
  }),
  closeAccount: z.object({
    kind: z.literal("closeAccount"),
    id,
    body: z.object({
      ...previewAuthorization,
      master_id: z.number().int().nonnegative().optional(),
      balance_target_id: z.number().int().nonnegative().optional(),
      write_off: z.boolean().optional(),
      password: z.string().max(20).optional(),
    }),
  }),
  quotaTransfer: z.object({
    kind: z.literal("quotaTransfer"),
    body: z.object({
      ...previewAuthorization,
      source_id: id,
      target_id: id,
      amount: positiveQuota,
    }),
  }),
  quotaAdjustment: z.object({
    kind: z.literal("quotaAdjustment"),
    body: z.object({
      ...previewAuthorization,
      account_id: id,
      amount: positiveQuota,
      direction: z.enum(["credit", "debit"]),
    }),
  }),
  reverseQuota: z.object({
    kind: z.literal("reverseQuota"),
    id,
    body: z.object(previewAuthorization),
  }),
  createQuotaBatch: z.object({
    kind: z.literal("createQuotaBatch"),
    body: z.object({
      batch_operation_id: operationId,
      mode: z.enum(["atomic", "best_effort"]),
      items: z
        .array(
          z.object({
            item_key: z.string().trim().min(1).max(128),
            source_id: id,
            target_id: id,
            amount: positiveQuota,
            reason,
          })
        )
        .min(1)
        .max(500),
      preview_token: previewToken,
    }),
  }),
  updateQuotaPolicy: z.object({
    kind: z.literal("updateQuotaPolicy"),
    body: z.object({ ...quotaPolicy, preview_token: previewToken, reason }),
  }),
  createAlertRule: z.object({
    kind: z.literal("createAlertRule"),
    body: z.object({
      owner_id: id.optional(),
      name: z.string().trim().min(1).max(128),
      kind: z.enum(["balance_below", "monthly_budget", "token_exhausted"]),
      threshold: quota,
      enabled: z.boolean(),
      cooldown_sec: z.number().int().positive(),
      version: z.number().int().positive().optional(),
    }),
  }),
  updateAlertRule: z.object({
    kind: z.literal("updateAlertRule"),
    id,
    body: z.object({
      owner_id: id.optional(),
      name: z.string().trim().min(1).max(128),
      kind: z.enum(["balance_below", "monthly_budget", "token_exhausted"]),
      threshold: quota,
      enabled: z.boolean(),
      cooldown_sec: z.number().int().positive(),
      version: z.number().int().positive().optional(),
    }),
  }),
  resendAccountInvitation: z.object({
    kind: z.literal("resendAccountInvitation"),
    id,
    body: z.object({ operation_id: operationId, reason, preview_token: previewToken }),
  }),
  revokeAccountInvitation: z.object({
    kind: z.literal("revokeAccountInvitation"),
    id,
    body: z.object({ operation_id: operationId, reason, preview_token: previewToken }),
  }),
  updatePersonalProfile: z.object({
    kind: z.literal("updatePersonalProfile"),
    body: z.object({
      display_name: z.string().trim().min(1).max(64),
      email: z.email().or(z.literal("")),
    }),
  }),
  changePersonalPassword: z.object({
    kind: z.literal("changePersonalPassword"),
    body: z.object({
      current_password: z.string().min(1).max(128),
      new_password: z.string().min(8).max(20),
    }),
  }),
  closePersonalAccount: z.object({
    kind: z.literal("closePersonalAccount"),
    body: z.object({
      operation_id: operationId,
      reason,
      current_password: z.string().min(1).max(128),
      confirm_username: z.string().min(1).max(64),
    }),
  }),
} as const

const readOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("capabilities") }),
  z.object({ kind: z.literal("quotaDisplay") }),
  z.object({ kind: z.literal("overview") }),
  z.object({
    kind: z.literal("accounts"),
    page,
    pageSize,
    search: nullableText,
    lifecycleState: nullableText,
    masterId: id.nullable().optional(),
    accessStatus: z.enum(["enabled", "disabled"]).nullable().optional(),
    relation: z.enum(["master", "child"]).nullable().optional(),
    role: z.enum(["root", "admin", "master", "child"]).nullable().optional(),
    group: nullableText,
    sortBy: z.enum(["created_at", "username", "quota", "last_login_at"]).nullable().optional(),
    sortOrder: z.enum(["asc", "desc"]).nullable().optional(),
  }),
  z.object({ kind: z.literal("account"), id }),
  z.object({ kind: z.literal("quotaSummary") }),
  z.object({ kind: z.literal("quotaOperation"), operationId: z.string().min(1).max(128) }),
  z.object({
    kind: z.literal("quotaTransactions"),
    page,
    pageSize,
    sourceId: id.nullable().optional(),
    targetId: id.nullable().optional(),
    transactionType: nullableText,
    start: z.number().int().positive().nullable().optional(),
    end: z.number().int().positive().nullable().optional(),
  }),
  z.object({ kind: z.literal("quotaBatch"), id }),
  z.object({ kind: z.literal("quotaPolicy"), masterId: id.nullable().optional() }),
  z.object({
    kind: z.literal("analytics"),
    start: z.number().int(),
    end: z.number().int(),
    accountId: id.nullable().optional(),
    model: nullableText,
    group: nullableText,
    apiKey: nullableText,
    status: z.enum(["success", "error", "all"]).nullable().optional(),
    timezone: nullableText,
  }),
  z.object({
    kind: z.literal("auditEvents"),
    page,
    pageSize,
    action: nullableText,
    resourceType: nullableText,
    resourceId: nullableText,
    errorCode: nullableText,
    start: z.number().int().positive().nullable().optional(),
    end: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    kind: z.literal("alertRules"),
    page,
    pageSize,
    search: nullableText,
    ruleKind: z.enum(["balance_below", "monthly_budget", "token_exhausted"]).nullable().optional(),
    enabled: z.boolean().nullable().optional(),
  }),
  z.object({ kind: z.literal("deleteAlertRule"), id }),
  z.object({
    kind: z.literal("alertEvents"),
    page,
    pageSize,
    acknowledged: z.boolean().nullable().optional(),
  }),
  z.object({ kind: z.literal("acknowledgeAlert"), id }),
  z.object({ kind: z.literal("notifications") }),
  z.object({ kind: z.literal("acknowledgeNotification"), id }),
  z.object({ kind: z.literal("personalCapabilities") }),
  z.object({ kind: z.literal("personalOverview") }),
  z.object({ kind: z.literal("personalProfile") }),
  z.object({ kind: z.literal("personalBalance") }),
  z.object({ kind: z.literal("personalLedger"), page, pageSize }),
  z.object({
    kind: z.literal("personalUsage"),
    start: z.number().int(),
    end: z.number().int(),
    page,
    pageSize,
    model: nullableText,
    group: nullableText,
    tokenName: nullableText,
    status: z.enum(["billable", "success", "refund", "error", "all"]).nullable().optional(),
  }),
  z.object({ kind: z.literal("personalModels") }),
  z.object({ kind: z.literal("personalSessions") }),
  z.object({ kind: z.literal("revokePersonalSession"), id }),
  z.object({ kind: z.literal("personalActivity"), page, pageSize }),
])

export function parseManagementOperation(operation: ManagementOperation): ManagementOperation {
  const bodySchema = mutationSchemas[operation.kind as keyof typeof mutationSchemas]
  const result = bodySchema
    ? bodySchema.safeParse(operation)
    : readOperationSchema.safeParse(operation)
  if (!result.success) {
    throw new Error(`Invalid more-token operation: ${result.error.issues[0]?.message ?? "invalid"}`)
  }
  return result.data as ManagementOperation
}

const accountResponseSchema = z.object({
  id,
  username: z.string(),
  display_name: z.string(),
  role: z.number().int(),
  status: z.number().int(),
  quota,
  used_quota: quota,
  is_master: z.boolean(),
  master_id: z.number().int().nonnegative(),
  lifecycle_state: z.enum(["active", "closing", "archived", ""]),
  quota_version: z.number().int().nonnegative(),
  management_version: z.number().int().nonnegative(),
  children_count: z.number().int().nonnegative(),
  created_at: z.number().int(),
  last_login_at: z.number().int(),
  group: z.string(),
})

const quotaDisplayResponseSchema = z.object(quotaDisplay)
const pageEnvelope = (itemSchema: z.ZodType) =>
  z.object({
    items: z.array(itemSchema),
    page,
    page_size: pageSize,
    total: z.number().int().nonnegative(),
  })
const structuredResponse = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

const responseSchemas: Partial<Record<ManagementOperation["kind"], z.ZodType>> = {
  capabilities: z.object({
    management_api_version: z.number().int().min(2),
    minimum_desktop_version: z.string(),
    role: z.enum(["master", "admin", "root"]),
    scopes: z.array(z.string()),
    features: z.object({
      management_api_enabled: z.boolean(),
      personal_api_enabled: z.boolean(),
      quota_transfer_enabled: z.boolean(),
      quota_policy_automation_enabled: z.boolean(),
      distribution_detail_enabled: z.boolean(),
      step_up_required: z.boolean(),
      account_invites_enabled: z.boolean(),
      remote_revoke_enabled: z.boolean(),
    }),
    quota_display: quotaDisplayResponseSchema,
    quota_display_version: z.string(),
  }),
  quotaDisplay: quotaDisplayResponseSchema,
  overview: z.object({
    summary: z.object({
      accounts: z.number().int().nonnegative(),
      masters: z.number().int().nonnegative(),
      children: z.number().int().nonnegative(),
      disabled: z.number().int().nonnegative(),
      archived: z.number().int().nonnegative(),
      total_quota: quota,
    }),
    open_alerts: z.number().int().nonnegative(),
    partial: z.boolean(),
  }),
  accounts: pageEnvelope(accountResponseSchema),
  account: z.object({
    account: accountResponseSchema.extend({
      email: z.string(),
      must_change_password: z.boolean(),
      invitation_status: z.string().optional(),
      active_billing_sessions: z.number().int().nonnegative(),
    }),
  }),
  quotaSummary: z.object({ total: quota, available: quota, used: quota, accounts: quota }),
  quotaTransactions: pageEnvelope(
    z.object({
      id,
      operation_id: z.string(),
      type: z.string(),
      actor_id: z.number().int().nonnegative(),
      source_id: z.number().int().nonnegative(),
      target_id: z.number().int().nonnegative(),
      amount: quota,
      source_before: quota,
      source_after: quota,
      target_before: quota,
      target_after: quota,
      status: z.string(),
      reason: z.string(),
      reversal_of: z.number().int().nonnegative().optional(),
      request_id: z.string(),
      created_at: z.number().int(),
    })
  ),
  personalCapabilities: z.object({
    personal_api_version: z.string(),
    role: z.literal("user"),
    scopes: z.array(z.string()),
    features: z.record(z.string(), z.boolean()),
    must_change_password: z.boolean(),
    current_session_id: z.number().int().nonnegative(),
    password_policy: z.object({
      minimum_length: z.number().int().positive(),
      maximum_length: z.number().int().positive(),
    }),
    billing_portal_path: z.string(),
  }),
  personalBalance: z.object({
    available: quota,
    used: quota,
    total: quota,
    request_count: z.number().int().nonnegative(),
    quota_display: quotaDisplayResponseSchema,
  }),
  personalSessions: z.array(
    z.object({
      id,
      public_id: z.string(),
      user_id: id,
      client_id: z.string(),
      client_label: z.string(),
      scopes: z.string(),
      expires_at: z.number().int(),
      last_used_at: z.number().int(),
      revoked_at: z.number().int(),
      created_at: z.number().int(),
    })
  ),
}

export function parseManagementResponseData(
  operation: ManagementOperation,
  responseData: unknown
): unknown {
  const schema = responseSchemas[operation.kind] ?? structuredResponse
  const result = schema.safeParse(responseData)
  if (!result.success) {
    throw new Error(
      `Invalid more-token ${operation.kind} response: ${result.error.issues[0]?.message ?? "invalid"}`
    )
  }
  return result.data
}
