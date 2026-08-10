import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import {
  credentialState,
  downloadCsv,
  listInstances,
  managementRequest,
  pairInstance,
} from "@/lib/more-token/client"
import type { ManagementOperation, MoreTokenInstance } from "@/lib/more-token/types"
import { MoreTokenSection, type MoreTokenSectionProps } from "."

jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/system", () => ({ notify: jest.fn() }))
jest.mock("@/lib/more-token/client", () => ({
  ...jest.requireActual("@/lib/more-token/client"),
  credentialState: jest.fn(),
  downloadCsv: jest.fn(),
  forgetCredential: jest.fn(),
  listInstances: jest.fn(),
  managementRequest: jest.fn(),
  pairInstance: jest.fn(),
  removeInstance: jest.fn(),
  saveInstance: jest.fn(),
}))

const instance: MoreTokenInstance = {
  id: "primary",
  name: "Primary",
  baseUrl: "https://more-token.example",
  caFingerprint: null,
  readOnly: false,
  displayCurrency: "CNY",
  package: "management",
}

const capabilities = {
  management_api_version: 1,
  minimum_desktop_version: "0.14.5",
  role: "admin" as const,
  scopes: ["accounts:read", "accounts:write", "quota:read", "quota:transfer", "audit:read"],
  features: {
    management_api_enabled: true,
    quota_transfer_enabled: true,
    quota_policy_automation_enabled: true,
    distribution_detail_enabled: true,
  },
  quota_display: {
    quota_per_unit: 500_000,
    display_currency: "CNY",
    conversion_numerator: 1,
    conversion_denominator: 1,
    rate_valid_until: 2_000_000_000,
  },
}

const accounts = [
  {
    id: 1,
    username: "master-a",
    display_name: "Master A",
    role: 1,
    status: 1,
    quota: 1000,
    used_quota: 200,
    is_master: true,
    master_id: 0,
    lifecycle_state: "active" as const,
    quota_version: 3,
    management_version: 2,
    created_time: 1_700_000_000,
  },
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
    lifecycle_state: "active" as const,
    quota_version: 2,
    management_version: 1,
    created_time: 1_700_000_100,
  },
]

function response<T>(data: T) {
  return Promise.resolve({ success: true as const, data, request_id: "request-1", server_time: 1 })
}

function mockOperation(operation: ManagementOperation) {
  switch (operation.kind) {
    case "capabilities":
      return response(capabilities)
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
        open_alerts: 1,
        partial: false,
      })
    case "accounts":
      return response({ items: accounts, page: 1, page_size: 200, total: 2 })
    case "account":
      return response({
        account: {
          ...(operation.id === 2 ? accounts[1] : accounts[0]),
          email: operation.id === 2 ? "child@example.com" : "master@example.com",
          must_change_password: false,
          active_billing_sessions: 1,
          parent: operation.id === 2 ? accounts[0] : null,
          children: operation.id === 2 ? [] : [accounts[1]],
          children_truncated: false,
          active_sessions: [
            {
              id: 41,
              status: "ACTIVE",
              funding_source: "wallet",
              reserved_quota: 25,
              lease_expires_at: 2_000_000_000,
              started_at: 1_700_000_400,
            },
          ],
          active_sessions_truncated: false,
        },
      })
    case "alertEvents":
      return response({
        items: [
          {
            id: 8,
            rule_id: 1,
            owner_id: 1,
            account_id: 2,
            kind: "balance_below",
            message: "Child A is nearly depleted",
            observed_value: 80,
            acknowledged_at: 0,
            created_at: 1_700_000_200,
          },
        ],
        page: 1,
        page_size: 100,
        total: 1,
      })
    case "quotaSummary":
      return response({ total: 1300, available: 1080, used: 220, accounts: 2 })
    case "quotaTransactions":
      return response({
        items: [
          {
            id: 7,
            operation_id: "0198fefe-1111-7111-8111-111111111111",
            type: "transfer",
            actor_id: 1,
            source_id: 1,
            target_id: 2,
            amount: 25,
            source_before: 1000,
            source_after: 975,
            target_before: 80,
            target_after: 105,
            status: "committed",
            reason: '=HYPERLINK("https://evil.example")',
            request_id: "request-7",
            created_at: 1_700_000_000,
          },
        ],
        page: 1,
        page_size: 50,
        total: 1,
      })
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
        disable_on_exhaustion: true,
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
      return response({
        items: [
          {
            id: 9,
            actor_id: 1,
            action: "account.disable",
            resource_type: "user",
            resource_id: "2",
            before: '{"status":1}',
            after: '{"status":2}',
            reason: "security review",
            request_id: "request-9",
            created_at: 1_700_000_300,
          },
        ],
        page: 1,
        page_size: 100,
        total: 1,
      })
    case "alertRules":
      return response({
        items: [
          {
            id: 1,
            owner_id: 1,
            name: "Low child balance",
            kind: "balance_below",
            threshold: 100,
            enabled: true,
            cooldown_sec: 3600,
            version: 1,
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
      })
    default:
      return response({})
  }
}

function renderSection(view: MoreTokenSectionProps["view"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <MoreTokenSection
          view={view}
          localUsage={{ data: null, loading: false, request: jest.fn() }}
        />
      </I18nProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(listInstances as jest.Mock).mockResolvedValue([instance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  ;(managementRequest as jest.Mock).mockImplementation(
    (_instanceId: string, operation: ManagementOperation) => mockOperation(operation)
  )
})

it("keeps the management workspace desktop-only", () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  renderSection("management-overview")
  expect(screen.getByText(en.management.desktopOnly)).toBeInTheDocument()
  expect(listInstances).not.toHaveBeenCalled()
})

it("shows the empty instance state without attempting management requests", async () => {
  ;(listInstances as jest.Mock).mockResolvedValue([])
  renderSection("management-overview")
  expect(await screen.findByText(en.management.noInstances)).toBeInTheDocument()
  expect(managementRequest).not.toHaveBeenCalled()
})

it("shows retryable instance discovery failures instead of an empty state", async () => {
  ;(listInstances as jest.Mock).mockRejectedValue(new Error("instance store offline"))
  renderSection("management-overview")

  expect(await screen.findAllByText("instance store offline")).toHaveLength(2)
  expect(screen.queryByText(en.management.noInstances)).not.toBeInTheDocument()
  expect(
    within(screen.getByRole("alert")).getByRole("button", { name: en.management.retry })
  ).toBeEnabled()
})

it("keeps a measurable loading state while instance discovery is pending", () => {
  ;(listInstances as jest.Mock).mockReturnValue(new Promise(() => undefined))
  const { container } = renderSection("management-overview")

  expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
})

it("pairs an unconnected instance without exposing the returned token", async () => {
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
  ;(pairInstance as jest.Mock).mockResolvedValue({
    tokenId: 7,
    expiresAt: 1_800_000_000,
    credentialPersistent: false,
  })
  renderSection("management-overview")
  const input = await screen.findByPlaceholderText("ABCDE-FGHIJ")
  await userEvent.type(input, "ABCDEFGHJK")
  await userEvent.click(screen.getByRole("button", { name: en.management.pair }))
  await waitFor(() =>
    expect(pairInstance).toHaveBeenCalledWith("primary", "ABCDEFGHJK", "agentpack-desktop")
  )
  expect(screen.queryByText(/management token/i)).not.toBeInTheDocument()
})

it("renders account topology, quota risk and open alerts", async () => {
  renderSection("management-overview")
  expect(await screen.findByText("master-a")).toBeInTheDocument()
  expect(screen.getByText("child-a")).toBeInTheDocument()
  expect(screen.getByText("Child A is nearly depleted")).toBeInTheDocument()
  expect(screen.getByText(en.management.balanceRisk)).toBeInTheDocument()
})

it("presents management state and controls in the shared workbench", async () => {
  renderSection("management-overview")
  await screen.findByText("master-a")

  const summary = screen.getByRole("region", { name: "Management status" })
  expect(within(summary).getAllByText("1")).toHaveLength(2)
  expect(within(summary).getByText(en.management.healthy)).toBeInTheDocument()
  expect(within(summary).getByText("admin")).toBeInTheDocument()

  const controls = screen.getByRole("complementary", { name: "Management controls" })
  expect(within(controls).getByRole("region", { name: "Connection" })).toHaveTextContent(
    instance.baseUrl
  )
  expect(within(controls).getByRole("region", { name: "Workspace" })).toHaveTextContent(
    en.management.tabs.overview
  )
})

it("renders the account center and clearly marks a read-only instance", async () => {
  ;(listInstances as jest.Mock).mockResolvedValue([{ ...instance, readOnly: true }])
  renderSection("accounts")
  expect(await screen.findByText(en.management.readonlyBanner)).toBeInTheDocument()
  expect(await screen.findAllByText("master-a")).not.toHaveLength(0)
  expect(screen.getByRole("button", { name: en.management.createAccount })).toBeDisabled()
})

it("shows safe child relationships and active billing sessions in account details", async () => {
  renderSection("accounts")
  const accountTable = await screen.findByRole("table")
  const accountButton = within(accountTable)
    .getAllByRole("button", { name: /master-a/i })
    .find((button) => button.textContent?.includes("Master A"))
  expect(accountButton).toBeDefined()
  await userEvent.click(accountButton!)

  expect(await screen.findByText(en.management.accountDetail)).toBeInTheDocument()
  const detail = screen.getByRole("dialog")
  expect(within(detail).getByText(en.management.directChildren)).toBeInTheDocument()
  expect(within(detail).getByText("child-a")).toBeInTheDocument()
  expect(within(detail).getByText(en.management.activeBillingSessions)).toBeInTheDocument()
  expect(within(detail).getByText(/wallet/)).toBeInTheDocument()
  expect(within(detail).getByText(/ACTIVE/)).toBeInTheDocument()
})

it("renders ledger policy and disables writes when the server closes the quota gate", async () => {
  ;(managementRequest as jest.Mock).mockImplementation(
    (_instanceId: string, operation: ManagementOperation) =>
      operation.kind === "capabilities"
        ? response({
            ...capabilities,
            features: { ...capabilities.features, quota_transfer_enabled: false },
          })
        : mockOperation(operation)
  )
  renderSection("quota")
  expect(await screen.findByText(en.management.featureDisabled)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.management.transfer })).toBeDisabled()
  expect(screen.getByText(en.management.ledger)).toBeInTheDocument()
})

it("exports the current ledger page through the CSV-safe download path", async () => {
  renderSection("quota")
  const exportButton = await screen.findByRole("button", { name: en.management.exportLedgerPage })
  await userEvent.click(exportButton)

  expect(downloadCsv).toHaveBeenCalledWith(
    "more-token-ledger-primary-1.csv",
    expect.arrayContaining([expect.arrayContaining(['=HYPERLINK("https://evil.example")'])])
  )
})

it("labels authoritative analytics and local CLI estimates as different scopes", async () => {
  renderSection("analytics")
  expect(await screen.findByText(en.management.serverBilling)).toBeInTheDocument()
  expect(screen.getAllByText(en.management.localEstimate)).toHaveLength(2)
})

it("shows immutable audit details, alert rules and acknowledgement controls", async () => {
  renderSection("audit")
  expect(await screen.findByText("account.disable")).toBeInTheDocument()
  expect(screen.getByText("security review")).toBeInTheDocument()
  expect(screen.getByText("Low child balance")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.management.acknowledge })).toBeEnabled()
  await userEvent.click(screen.getByRole("button", { name: "View account #2" }))
  expect(await screen.findByText(en.management.accountDetail)).toBeInTheDocument()
  expect(within(screen.getByRole("dialog")).getByText("child-a")).toBeInTheDocument()
})
