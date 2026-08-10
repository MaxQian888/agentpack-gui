export type ManagementView = "management-overview" | "accounts" | "quota" | "analytics" | "audit"
export type PersonalView = "my-account" | "my-balance" | "my-usage" | "my-models" | "my-security"
export type MoreTokenPackage = "management" | "personal"

export interface MoreTokenInstance {
  id: string
  name: string
  baseUrl: string
  caFingerprint: string | null
  readOnly: boolean
  displayCurrency: string | null
  package: MoreTokenPackage
}

export interface MoreTokenInstanceDraft {
  id: string
  name: string
  baseUrl: string
  readOnly: boolean
  displayCurrency: string | null
  customCaPath: string | null
  clearCustomCa: boolean
  package: MoreTokenPackage
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

export interface PersonalOAuthStartResult {
  handle: string
  authorizationUrl: string
  expiresAt: number
  intervalSeconds: number
}

export interface PersonalOAuthPollResult {
  status: "authorization_pending" | "slow_down" | "authorized"
  credential: PairingResult | null
}

export interface ManagementStepUpStartResult {
  handle: string
  authorizationUrl: string
  expiresAt: number
  intervalSeconds: number
}

export interface ManagementStepUpPollResult {
  status: "authorization_pending" | "authorized"
}

export interface ForgetCredentialResult {
  remoteRevoked: boolean
  localDeleted: boolean
  remoteError: string | null
}

export interface ActionPreviewBody {
  action: string
  payload: Record<string, unknown>
}

export interface PreviewAuthorizationBody {
  preview_token: string
  operation_id: string
  reason: string
}

export interface CreateAccountBody extends PreviewAuthorizationBody {
  username: string
  display_name: string
  email: string
  group: string
  master_id: number
  initial_quota: number
  invite_by_email: boolean
}

export interface AccountActionBody extends PreviewAuthorizationBody {
  master_id?: number
  balance_target_id?: number
  write_off?: boolean
  password?: string
}

export interface QuotaTransferBody extends PreviewAuthorizationBody {
  source_id: number
  target_id: number
  amount: number
}

export interface QuotaAdjustmentBody extends PreviewAuthorizationBody {
  account_id: number
  amount: number
  direction: "credit" | "debit"
}

export interface QuotaBatchBody {
  batch_operation_id: string
  mode: "atomic" | "best_effort"
  items: Array<{
    item_key: string
    source_id: number
    target_id: number
    amount: number
    reason: string
  }>
  preview_token: string
}

export interface AccountBatchBody {
  batch_operation_id: string
  mode: "atomic" | "best_effort"
  action: "enable" | "disable" | "archive" | "restore" | "detach"
  account_ids: number[]
  reason: string
  preview_token: string
}

export interface UpdateQuotaDisplayBody extends QuotaDisplaySetting {
  preview_token: string
  reason: string
}

export interface UpdateQuotaPolicyBody extends QuotaPolicy {
  preview_token: string
  reason: string
}

export interface AlertRuleBody {
  owner_id?: number
  name: string
  kind: AlertRule["kind"]
  threshold: number
  enabled: boolean
  cooldown_sec: number
  version?: number
}

export interface InvitationMutationBody {
  operation_id: string
  reason: string
  preview_token: string
}

export interface PersonalProfileBody {
  display_name: string
  email: string
}

export interface PersonalPasswordBody {
  current_password: string
  new_password: string
}

export interface PersonalCloseBody {
  operation_id: string
  current_password: string
  confirm_username: string
  reason: string
}

export type ManagementOperation =
  | { kind: "capabilities" }
  | { kind: "quotaDisplay" }
  | { kind: "updateQuotaDisplay"; body: UpdateQuotaDisplayBody }
  | { kind: "overview" }
  | {
      kind: "accounts"
      page: number
      pageSize: number
      search?: string | null
      lifecycleState?: string | null
      masterId?: number | null
      accessStatus?: "enabled" | "disabled" | null
      relation?: "master" | "child" | null
      role?: "root" | "admin" | "master" | "child" | null
      group?: string | null
      sortBy?: "created_at" | "username" | "quota" | "last_login_at" | null
      sortOrder?: "asc" | "desc" | null
    }
  | { kind: "createAccount"; body: CreateAccountBody }
  | { kind: "createAccountBatch"; body: AccountBatchBody }
  | { kind: "account"; id: number }
  | { kind: "actionPreview"; body: ActionPreviewBody }
  | { kind: "accountAction"; id: number; action: AccountAction; body: AccountActionBody }
  | { kind: "closeAccount"; id: number; body: AccountActionBody }
  | { kind: "quotaSummary" }
  | { kind: "quotaTransfer"; body: QuotaTransferBody }
  | { kind: "quotaAdjustment"; body: QuotaAdjustmentBody }
  | { kind: "reverseQuota"; id: number; body: PreviewAuthorizationBody }
  | { kind: "quotaOperation"; operationId: string }
  | {
      kind: "quotaTransactions"
      page: number
      pageSize: number
      sourceId?: number | null
      targetId?: number | null
      transactionType?: string | null
      start?: number | null
      end?: number | null
    }
  | { kind: "createQuotaBatch"; body: QuotaBatchBody }
  | { kind: "quotaBatch"; id: number }
  | { kind: "quotaPolicy"; masterId?: number | null }
  | { kind: "updateQuotaPolicy"; body: UpdateQuotaPolicyBody }
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
  | {
      kind: "auditEvents"
      page: number
      pageSize: number
      action?: string | null
      resourceType?: string | null
      resourceId?: string | null
      errorCode?: string | null
      start?: number | null
      end?: number | null
    }
  | {
      kind: "alertRules"
      page: number
      pageSize: number
      search?: string | null
      ruleKind?: AlertRule["kind"] | null
      enabled?: boolean | null
    }
  | { kind: "createAlertRule"; body: AlertRuleBody }
  | { kind: "updateAlertRule"; id: number; body: AlertRuleBody }
  | { kind: "deleteAlertRule"; id: number }
  | { kind: "resendAccountInvitation"; id: number; body: InvitationMutationBody }
  | { kind: "revokeAccountInvitation"; id: number; body: InvitationMutationBody }
  | { kind: "alertEvents"; page: number; pageSize: number; acknowledged?: boolean | null }
  | { kind: "acknowledgeAlert"; id: number }
  | { kind: "notifications" }
  | { kind: "acknowledgeNotification"; id: number }
  | { kind: "personalCapabilities" }
  | { kind: "personalOverview" }
  | { kind: "personalProfile" }
  | { kind: "updatePersonalProfile"; body: PersonalProfileBody }
  | { kind: "changePersonalPassword"; body: PersonalPasswordBody }
  | { kind: "closePersonalAccount"; body: PersonalCloseBody }
  | { kind: "personalBalance" }
  | { kind: "personalLedger"; page: number; pageSize: number }
  | {
      kind: "personalUsage"
      start: number
      end: number
      page: number
      pageSize: number
      model?: string | null
      group?: string | null
      tokenName?: string | null
      status?: "billable" | "success" | "refund" | "error" | "all" | null
    }
  | { kind: "personalModels" }
  | { kind: "personalSessions" }
  | { kind: "revokePersonalSession"; id: number }
  | { kind: "personalActivity"; page: number; pageSize: number }

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
    personal_api_enabled: boolean
    quota_transfer_enabled: boolean
    quota_policy_automation_enabled: boolean
    distribution_detail_enabled: boolean
    step_up_required: boolean
    account_invites_enabled: boolean
    remote_revoke_enabled: boolean
  }
  quota_display: QuotaDisplaySetting
  quota_display_version: string
}

export interface PersonalCapabilities {
  personal_api_version: string
  role: "user"
  scopes: string[]
  features: {
    profile_edit_enabled: boolean
    password_change_enabled: boolean
    account_close_enabled: boolean
    billing_portal_enabled: boolean
    browser_oauth_enabled?: boolean
    model_marketplace_enabled?: boolean
    usage_details_enabled?: boolean
    remote_revoke_enabled?: boolean
  }
  must_change_password: boolean
  current_session_id: number
  password_policy: { minimum_length: number; maximum_length: number }
  billing_portal_path: string
}

export interface PersonalAccount {
  id: number
  username: string
  display_name: string
  email: string
  role: number
  status: number
  lifecycle_state: "active" | "closing" | "archived" | ""
  master_id: number
  is_master: boolean
  quota: number
  used_quota: number
  request_count: number
  created_at: number
  group: string
  last_login_at: number
}

export interface PersonalOverview {
  account: PersonalAccount
  balance: { available: number; used: number; total: number }
  quota_display: QuotaDisplaySetting
  parent: { id: number; username: string; display_name: string } | null
  ledger_entries: number
  security?: {
    two_factor_enabled: boolean
    active_desktop_sessions: number
    auth_methods: string[]
  }
  access?: {
    group: string
    active_api_keys: number
    available_models: number
    last_login_at: number
  }
}

export interface PersonalBalance {
  available: number
  used: number
  total: number
  request_count: number
  quota_display: QuotaDisplaySetting
}

export interface PersonalLedgerEntry {
  id: number
  operation_id: string
  type: string
  amount: number
  delta: number
  balance_before: number
  balance_after: number
  counterparty: string
  reason: string
  status: string
  created_at: number
}

export interface PersonalUsage {
  definition: string
  start: number
  end: number
  bucket_seconds: number
  generated_at: number
  metrics: {
    requests: number
    prompt_tokens: number
    completion_tokens: number
    quota: number
  }
  series: Array<{
    bucket: number
    requests: number
    prompt_tokens: number
    completion_tokens: number
    quota: number
  }>
  model_breakdown?: Array<{
    model_name: string
    requests: number
    prompt_tokens: number
    completion_tokens: number
    quota: number
  }>
  records?: Array<{
    request_id: string
    status: "success" | "refund" | "error" | "unknown"
    created_at: number
    model_name: string
    token_name: string
    group: string
    prompt_tokens: number
    completion_tokens: number
    quota: number
    use_time: number
    is_stream: boolean
  }>
  filter_options?: {
    groups: string[]
    token_names: string[]
  }
  page?: number
  page_size?: number
  total?: number
  quota_display: QuotaDisplaySetting
}

export interface PersonalModel {
  model_name: string
  description?: string
  icon?: string
  tags?: string
  vendor_id?: number
  quota_type: number
  model_ratio: number
  model_price: number
  owner_by?: string
  completion_ratio: number
  cache_ratio?: number
  create_cache_ratio?: number
  image_ratio?: number
  audio_ratio?: number
  audio_completion_ratio?: number
  enable_groups: string[]
  supported_endpoint_types: string[]
  billing_mode?: string
}

export interface PersonalModelCatalog {
  items: PersonalModel[]
  vendors: Array<{ id: number; name: string; description?: string }>
  group_ratio: Record<string, number>
  usable_group: Record<string, string>
  supported_endpoint: Record<string, { path: string; method: string }>
  auto_groups: string[]
  pricing_version: string
  generated_at: number
}

export interface PersonalSession {
  id: number
  public_id: string
  user_id: number
  client_id: string
  client_label: string
  scopes: string
  expires_at: number
  last_used_at: number
  revoked_at: number
  created_at: number
}

export interface QuotaDisplaySetting {
  quota_per_unit: number
  display_currency: string
  conversion_numerator: number
  conversion_denominator: number
  rate_valid_until: number
  version: number
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
  children_count: number
  created_at: number
  last_login_at: number
  group: string
}

export interface AccountDetail extends Account {
  email: string
  must_change_password: boolean
  invitation_status?: string
  active_billing_sessions: number
  parent: Account | null
  children: Account[]
  children_truncated: boolean
  active_sessions: ActiveBillingSession[]
  active_sessions_truncated: boolean
}

export interface ActiveBillingSession {
  id: number
  status: string
  funding_source: string
  reserved_quota: number
  lease_expires_at: number
  started_at: number
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
