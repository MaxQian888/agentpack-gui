/**
 * Shared setup for the MoreTokenSection suites. Each suite still declares its
 * own `jest.mock` calls (they are hoisted per file); this module only holds the
 * server fixtures, the operation router and the render helper.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { managementRequest } from "@/lib/more-token/client"
import type { Account, ManagementOperation, MoreTokenInstance } from "@/lib/more-token/types"
import { MoreTokenSection, type MoreTokenSectionProps } from ".."

export const instance: MoreTokenInstance = {
  id: "primary",
  name: "Primary",
  baseUrl: "https://more-token.example",
  caFingerprint: null,
  readOnly: false,
  displayCurrency: "CNY",
  package: "management",
}

export const capabilities = {
  management_api_version: 1,
  minimum_desktop_version: "0.14.5",
  role: "admin" as "master" | "admin" | "root",
  scopes: [
    "accounts:read",
    "accounts:write",
    "quota:read",
    "quota:transfer",
    "audit:read",
    "alerts:write",
  ],
  features: {
    management_api_enabled: true,
    quota_transfer_enabled: true,
    quota_policy_automation_enabled: true,
    distribution_detail_enabled: true,
    personal_api_enabled: false,
    step_up_required: true,
    account_invites_enabled: false,
    remote_revoke_enabled: true,
  },
  quota_display: {
    quota_per_unit: 500_000,
    display_currency: "CNY",
    conversion_numerator: 1,
    conversion_denominator: 1,
    rate_valid_until: 2_000_000_000,
    version: 1,
  },
  quota_display_version: "1",
}

export type Capabilities = typeof capabilities

export const master: Account = {
  id: 1,
  username: "master-a",
  display_name: "Master A",
  role: 1,
  status: 1,
  quota: 1000,
  used_quota: 200,
  is_master: true,
  master_id: 0,
  lifecycle_state: "active",
  quota_version: 3,
  management_version: 2,
  children_count: 1,
  created_at: 1_700_000_000,
  last_login_at: 1_700_000_500,
  group: "default",
}

export const child: Account = {
  id: 2,
  username: "child-a",
  display_name: "Child A",
  role: 1,
  status: 1,
  quota: 80,
  used_quota: 20,
  is_master: false,
  master_id: 1,
  lifecycle_state: "active",
  quota_version: 2,
  management_version: 1,
  children_count: 0,
  created_at: 1_700_000_100,
  last_login_at: 1_700_000_600,
  group: "default",
}

export function response<T>(data: T) {
  return Promise.resolve({ success: true as const, data, request_id: "request-1", server_time: 1 })
}

export function page<T>(items: T[], total = items.length) {
  return { items, page: 1, page_size: 25, total }
}

export function accountDetail(account: Account, extra: Record<string, unknown> = {}) {
  return {
    account: {
      ...account,
      email: `${account.username}@example.com`,
      must_change_password: false,
      active_billing_sessions: 0,
      invitation_status: "",
      parent: null,
      children: [],
      children_truncated: false,
      active_sessions: [],
      active_sessions_truncated: false,
      ...extra,
    },
  }
}

export type Handler = (operation: ManagementOperation) => Promise<unknown> | undefined

/** The default server: two accounts, one alert, one ledger entry, one rule. */
export function defaultOperation(
  operation: ManagementOperation,
  caps: Capabilities = capabilities
): Promise<unknown> {
  switch (operation.kind) {
    case "actionPreview":
      return response({
        preview_token: "preview-1",
        impact: [{ id: 2, quota: 90, quota_version: 3 }],
      })
    case "capabilities":
      return response(caps)
    case "notifications":
      return response([])
    case "overview":
      return response({
        summary: {
          accounts: 2,
          masters: 1,
          children: 1,
          disabled: 0,
          archived: 0,
          total_quota: 1080,
        },
        open_alerts: 0,
        partial: false,
      })
    case "accounts":
      return response(page([master, child]))
    case "account":
      return response(accountDetail(operation.id === 2 ? child : master))
    case "alertEvents":
      return response(page([]))
    case "quotaSummary":
      return response({ total: 1300, available: 1080, used: 220, accounts: 2 })
    case "quotaTransactions":
      return response(page([]))
    case "quotaPolicy":
      return response({
        master_id: 1,
        minimum_reserve: 100,
        child_balance_cap: 500,
        single_transfer_limit: 200,
        daily_transfer_limit: 1000,
        auto_refill_enabled: true,
        auto_refill_threshold: 50,
        auto_refill_amount: 100,
        auto_refill_daily_cap: 300,
        auto_refill_cooldown_sec: 3600,
        monthly_soft_budget: 5000,
        disable_on_exhaustion: false,
        version: 1,
      })
    case "analytics":
      return response({
        metrics: {
          requests: 12,
          prompt_tokens: 100,
          completion_tokens: 50,
          quota: 150,
          peak_rpm: 4,
          peak_tpm: 80,
        },
        series: [{ bucket: 1_700_000_000, rpm: 4, tpm: 80, quota: 150 }],
        start: 1_699_000_000,
        end: 1_700_000_000,
        timezone: "Asia/Shanghai",
        generated_at: 1_700_000_100,
        partial: false,
        definition: "billing logs",
      })
    case "auditEvents":
      return response(page([]))
    case "alertRules":
      return response(page([]))
    default:
      return response({})
  }
}

/**
 * Route every management request through `handler` first, falling back to the
 * default server for anything it leaves undefined.
 */
export function serve(handler: Handler = () => undefined, caps: Capabilities = capabilities) {
  ;(managementRequest as jest.Mock).mockImplementation(
    (_instanceId: string, operation: ManagementOperation) =>
      handler(operation) ?? defaultOperation(operation, caps)
  )
}

export function calls<K extends ManagementOperation["kind"]>(kind: K) {
  return (managementRequest as jest.Mock).mock.calls
    .map((call) => call[1] as ManagementOperation)
    .filter((operation): operation is Extract<ManagementOperation, { kind: K }> => {
      return operation.kind === kind
    })
}

export function renderSection(
  view: MoreTokenSectionProps["view"],
  localUsage: MoreTokenSectionProps["localUsage"] = {
    data: null,
    loading: false,
    request: jest.fn(),
  }
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <MoreTokenSection view={view} localUsage={localUsage} />
      </I18nProvider>
    </QueryClientProvider>
  )
}
