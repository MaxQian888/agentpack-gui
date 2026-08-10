import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import type {
  AccountDetail,
  ManagementCapabilities,
  MoreTokenInstance,
} from "@/lib/more-token/types"
import { AccountDetailSheet } from "./account-detail-sheet"

const account: AccountDetail = {
  id: 1,
  username: "master-a",
  display_name: "Master A",
  role: 1,
  status: 1,
  quota: 1_000,
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
  email: "master@example.com",
  must_change_password: false,
  active_billing_sessions: 0,
  parent: null,
  children: [
    {
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
    },
  ],
  children_truncated: false,
  active_sessions: [],
  active_sessions_truncated: false,
}

const capabilities: ManagementCapabilities = {
  management_api_version: 2,
  minimum_desktop_version: "0.16.0",
  role: "root",
  scopes: ["accounts:read"],
  features: {
    management_api_enabled: true,
    personal_api_enabled: true,
    quota_transfer_enabled: true,
    quota_policy_automation_enabled: true,
    distribution_detail_enabled: true,
    step_up_required: true,
    account_invites_enabled: false,
    remote_revoke_enabled: true,
  },
  quota_display: {
    quota_per_unit: 500_000,
    display_currency: "CNY",
    conversion_numerator: 1,
    conversion_denominator: 1,
    rate_valid_until: 0,
    version: 1,
  },
  quota_display_version: "1",
}

const instance: MoreTokenInstance = {
  id: "primary",
  name: "Primary",
  baseUrl: "https://more-token.example",
  caFingerprint: null,
  readOnly: false,
  displayCurrency: "CNY",
  package: "management",
}

it("localizes child lifecycle states in account details", () => {
  localStorage.setItem("agentpack.lang", "zh-CN")
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AccountDetailSheet
          account={account}
          quotaDisplay={capabilities.quota_display}
          instance={instance}
          capabilities={capabilities}
          onDone={jest.fn()}
          onOpenChange={jest.fn()}
        />
      </I18nProvider>
    </QueryClientProvider>
  )

  expect(screen.getByText("Child A · 正常")).toBeInTheDocument()
  expect(screen.queryByText(/Child A · active/)).not.toBeInTheDocument()
})
