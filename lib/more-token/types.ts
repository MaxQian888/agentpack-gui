export type ManagementView = "management-overview" | "accounts" | "quota" | "analytics" | "audit"

export interface MoreTokenInstance {
  id: string
  name: string
  baseUrl: string
  caFingerprint: string | null
  readOnly: boolean
  displayCurrency: string | null
}

export interface MoreTokenInstanceDraft {
  id: string
  name: string
  baseUrl: string
  readOnly: boolean
  displayCurrency: string | null
  customCaPath: string | null
  clearCustomCa: boolean
}

export interface CredentialState {
  connected: boolean
  persistent: boolean
}

export interface PairingResult {
  tokenId: number
  expiresAt: number
  credentialPersistent: boolean
}

export type ManagementOperation =
  | { kind: "capabilities" }
  | { kind: "quotaDisplay" }
  | { kind: "updateQuotaDisplay"; body: unknown }
  | { kind: "overview" }
  | {
      kind: "accounts"
      page: number
      pageSize: number
      search?: string | null
      lifecycleState?: string | null
      masterId?: number | null
    }
  | { kind: "createAccount"; body: unknown }
  | { kind: "account"; id: number }
  | { kind: "actionPreview"; body: unknown }
  | { kind: "accountAction"; id: number; action: AccountAction; body: unknown }
  | { kind: "closeAccount"; id: number; body: unknown }
  | { kind: "quotaSummary" }
  | { kind: "quotaTransfer"; body: unknown }
  | { kind: "quotaAdjustment"; body: unknown }
  | { kind: "reverseQuota"; id: number; body: unknown }
  | { kind: "quotaOperation"; operationId: string }
  | { kind: "quotaTransactions"; page: number; pageSize: number }
  | { kind: "createQuotaBatch"; body: unknown }
  | { kind: "quotaBatch"; id: number }
  | { kind: "quotaPolicy"; masterId?: number | null }
  | { kind: "updateQuotaPolicy"; body: unknown }
  | {
      kind: "analytics"
      start: number
      end: number
      accountId?: number | null
      model?: string | null
      group?: string | null
      apiKey?: string | null
      status?: "success" | "error" | "all" | null
      timezone?: string | null
    }
  | { kind: "auditEvents"; page: number; pageSize: number }
  | { kind: "alertRules" }
  | { kind: "createAlertRule"; body: unknown }
  | { kind: "updateAlertRule"; id: number; body: unknown }
  | { kind: "deleteAlertRule"; id: number }
  | { kind: "alertEvents"; page: number; pageSize: number; acknowledged?: boolean | null }
  | { kind: "acknowledgeAlert"; id: number }
  | { kind: "notifications" }
  | { kind: "acknowledgeNotification"; id: number }

export type AccountAction =
  | "enable"
  | "disable"
  | "archive"
  | "restore"
  | "attach"
  | "detach"
  | "promote"
  | "demote"
  | "password"

export interface ManagementCapabilities {
  management_api_version: number
  minimum_desktop_version: string
  role: "master" | "admin" | "root"
  scopes: string[]
  features: {
    management_api_enabled: boolean
    quota_transfer_enabled: boolean
    quota_policy_automation_enabled: boolean
    distribution_detail_enabled: boolean
  }
  quota_display: QuotaDisplaySetting
}

export interface QuotaDisplaySetting {
  quota_per_unit: number
  display_currency: string
  conversion_numerator: number
  conversion_denominator: number
  rate_valid_until: number
}

export interface Account {
  id: number
  username: string
  display_name: string
  role: number
  status: number
  quota: number
  used_quota: number
  is_master: boolean
  master_id: number
  lifecycle_state: "active" | "closing" | "archived" | ""
  quota_version: number
  management_version: number
  created_time: number
}

export interface OverviewData {
  summary: {
    accounts: number
    masters: number
    children: number
    disabled: number
    archived: number
    total_quota: number
  }
  open_alerts: number
  partial: boolean
}

export interface Page<T> {
  items: T[]
  page: number
  page_size: number
  total: number
}

export interface QuotaSummary {
  total: number
  available: number
  used: number
  accounts: number
}

export interface QuotaTransaction {
  id: number
  operation_id: string
  type: string
  actor_id: number
  source_id: number
  target_id: number
  amount: number
  source_before: number
  source_after: number
  target_before: number
  target_after: number
  status: string
  reason: string
  reversal_of?: number
  request_id: string
  created_at: number
}

export interface QuotaPolicy {
  id?: number
  master_id: number
  minimum_reserve: number
  child_balance_cap: number
  single_transfer_limit: number
  daily_transfer_limit: number
  auto_refill_enabled: boolean
  auto_refill_threshold: number
  auto_refill_amount: number
  auto_refill_daily_cap: number
  auto_refill_cooldown_sec: number
  monthly_soft_budget: number
  disable_on_exhaustion: boolean
  version: number
}

export interface AnalyticsData {
  metrics: {
    requests: number
    prompt_tokens: number
    completion_tokens: number
    quota: number
    peak_rpm: number
    peak_tpm: number
  }
  series: Array<{ bucket: number; rpm: number; tpm: number; quota: number }>
  start: number
  end: number
  timezone: string
  generated_at: number
  partial: boolean
  definition: string
}

export interface AuditEvent {
  id: number
  actor_id: number
  action: string
  resource_type: string
  resource_id: string
  before?: string
  after?: string
  reason: string
  request_id: string
  error_code?: string
  created_at: number
}

export interface AlertRule {
  id: number
  owner_id: number
  name: string
  kind: "balance_below" | "monthly_budget" | "token_exhausted"
  threshold: number
  enabled: boolean
  cooldown_sec: number
  version: number
}

export interface AlertEvent {
  id: number
  rule_id: number
  owner_id: number
  account_id: number
  kind: string
  message: string
  observed_value: number
  acknowledged_at: number
  created_at: number
}

export interface ManagementEnvelope<T> {
  success: true
  data: T
  request_id: string
  server_time: number
}

export interface ManagementErrorEnvelope {
  success: false
  error: {
    code: string
    message: string
    request_id: string
    retryable: boolean
    details?: unknown
  }
}
