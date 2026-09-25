import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import {
  credentialState,
  downloadCsv,
  forgetCredential,
  listInstances,
  managementRequest,
  pairInstance,
  removeInstance,
  saveInstance,
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
// Browser approval is its own module; here it approves at once.
jest.mock("@/lib/more-token/step-up", () => ({
  ...jest.requireActual("@/lib/more-token/step-up"),
  authorizeManagementPreview: jest.fn(() => Promise.resolve()),
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

let previewCount = 0

function mockOperation(operation: ManagementOperation) {
  switch (operation.kind) {
    case "actionPreview":
      previewCount += 1
      return response({
        preview_token: `preview-${previewCount}`,
        impact: [{ id: 1, quota: 990, quota_version: 4 }],
      })
    case "createAccount":
      return response({ temporary_password: "Temp-9x!Q", credential_mode: "temporary_password" })
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
  jest.clearAllMocks()
  previewCount = 0
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

function calls(kind: ManagementOperation["kind"]) {
  return (managementRequest as jest.Mock).mock.calls
    .map((call) => call[1] as ManagementOperation)
    .filter((operation) => operation.kind === kind)
}

async function fillTransfer(dialog: HTMLElement, amount: string) {
  await userEvent.type(within(dialog).getByLabelText(en.management.sourceId), "1")
  await userEvent.type(within(dialog).getByLabelText(en.management.targetId), "2")
  await userEvent.type(within(dialog).getByLabelText(en.management.amount), amount)
  await userEvent.type(within(dialog).getByLabelText(en.management.reason), "rebalance")
}

it("starts a transfer from scratch after Cancel and confirms the payload that was previewed", async () => {
  renderSection("quota")
  await userEvent.click(await screen.findByRole("button", { name: en.management.transfer }))
  let dialog = await screen.findByRole("dialog")
  await fillTransfer(dialog, "10")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.preview }))
  expect(await within(dialog).findByText(en.management.previewImpact)).toBeInTheDocument()
  // A preview certifies one payload, so the fields lock until Edit.
  expect(within(dialog).getByLabelText(en.management.amount)).toBeDisabled()

  await userEvent.click(within(dialog).getByRole("button", { name: en.management.cancel }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: en.management.transfer }))
  dialog = await screen.findByRole("dialog")
  expect(within(dialog).queryByText(en.management.previewImpact)).not.toBeInTheDocument()
  expect(within(dialog).getByLabelText(en.management.amount)).toBeEnabled()
  await fillTransfer(dialog, "20")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.preview }))
  await userEvent.click(await within(dialog).findByRole("button", { name: en.management.confirm }))

  await waitFor(() => expect(calls("quotaTransfer")).toHaveLength(1))
  expect(calls("quotaTransfer")[0]).toMatchObject({
    body: { amount: 20, preview_token: "preview-2" },
  })
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

it("lets a previewed transfer go back to editing", async () => {
  renderSection("quota")
  await userEvent.click(await screen.findByRole("button", { name: en.management.transfer }))
  const dialog = await screen.findByRole("dialog")
  await fillTransfer(dialog, "10")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.preview }))
  await userEvent.click(await within(dialog).findByRole("button", { name: en.management.edit }))

  expect(within(dialog).queryByText(en.management.previewImpact)).not.toBeInTheDocument()
  expect(within(dialog).getByLabelText(en.management.amount)).toBeEnabled()
  expect(within(dialog).getByLabelText(en.management.amount)).toHaveValue(10)
})

it("opens Add instance as a blank connection with a fresh id each time", async () => {
  const now = jest.spyOn(Date, "now")
  let clock = 1_800_000_000_000
  now.mockImplementation(() => (clock += 1_000))
  const saved: MoreTokenInstance[] = [instance]
  ;(listInstances as jest.Mock).mockImplementation(async () => saved)
  ;(saveInstance as jest.Mock).mockImplementation(async (draft) => {
    const next = { ...instance, id: draft.id, name: draft.name }
    saved.push(next)
    return next
  })
  renderSection("management-overview")
  await screen.findByText("master-a")

  await userEvent.click(screen.getByRole("button", { name: en.management.addInstance }))
  let dialog = await screen.findByRole("dialog")
  expect(
    within(dialog).getByRole("heading", { name: en.management.addInstance })
  ).toBeInTheDocument()
  const firstId = (within(dialog).getByLabelText(en.management.instanceId) as HTMLInputElement)
    .value
  expect(firstId).not.toBe(instance.id)
  expect(within(dialog).getByLabelText(en.management.instanceId)).not.toHaveAttribute("readonly")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.save }))
  await waitFor(() => expect(saveInstance).toHaveBeenCalledTimes(1))
  expect((saveInstance as jest.Mock).mock.calls[0][0]).toMatchObject({
    id: firstId,
    package: "management",
  })

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole("button", { name: en.management.addInstance }))
  dialog = await screen.findByRole("dialog")
  const secondId = (within(dialog).getByLabelText(en.management.instanceId) as HTMLInputElement)
    .value
  expect(secondId).not.toBe(firstId)

  await userEvent.click(within(dialog).getByRole("button", { name: en.management.cancel }))
  // The first add is now the selected instance; Edit opens that one, read-only id.
  await userEvent.click(screen.getByRole("button", { name: en.management.editInstance }))
  dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByLabelText(en.management.instanceId)).toHaveValue(firstId)
  expect(within(dialog).getByLabelText(en.management.instanceId)).toHaveAttribute("readonly")
  now.mockRestore()
})

it("confirms removal and revokes the server credential before deleting the instance", async () => {
  ;(forgetCredential as jest.Mock).mockResolvedValue({
    remoteRevoked: true,
    localDeleted: true,
    remoteError: null,
  })
  ;(removeInstance as jest.Mock).mockResolvedValue(undefined)
  renderSection("management-overview")
  await screen.findByText("master-a")
  await userEvent.click(screen.getByRole("button", { name: en.management.editInstance }))
  const dialog = await screen.findByRole("dialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.removeInstance }))

  const confirm = await screen.findByRole("alertdialog")
  expect(confirm).toHaveTextContent(en.management.removeInstanceBody)
  expect(removeInstance).not.toHaveBeenCalled()
  await userEvent.click(within(confirm).getByRole("button", { name: en.management.removeInstance }))

  await waitFor(() => expect(removeInstance).toHaveBeenCalledWith(instance.id))
  expect(forgetCredential).toHaveBeenCalledWith(instance.id)
  expect((forgetCredential as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (removeInstance as jest.Mock).mock.invocationCallOrder[0]
  )
})

it("shows the analytics range in local time and survives a cleared field", async () => {
  const { container } = renderSection("analytics")
  await screen.findByText(en.management.serverBilling)
  const [from] = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')
  )

  fireEvent.change(from, { target: { value: "2026-09-01T08:30" } })
  expect(from).toHaveValue("2026-09-01T08:30")
  const expected = Math.floor(new Date(2026, 8, 1, 8, 30).getTime() / 1000)
  await waitFor(() =>
    expect(
      calls("analytics").some((operation) => "start" in operation && operation.start === expected)
    ).toBe(true)
  )

  fireEvent.change(from, { target: { value: "" } })
  expect(from).toHaveValue("2026-09-01T08:30")
  expect(
    calls("analytics").every(
      (operation) => "start" in operation && Number.isFinite(operation.start)
    )
  ).toBe(true)
  expect(screen.getByText(en.management.serverBilling)).toBeInTheDocument()
})

it("clears a shown temporary password so the next Create account starts blank", async () => {
  renderSection("accounts")
  await screen.findByRole("table")
  await userEvent.click(screen.getByRole("button", { name: en.management.createAccount }))
  let dialog = await screen.findByRole("dialog")
  await userEvent.type(within(dialog).getByLabelText(en.management.username), "new-child")
  await userEvent.type(within(dialog).getByLabelText(en.management.reason), "provisioning")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.createAccount }))
  expect(await within(dialog).findByText("Temp-9x!Q")).toBeInTheDocument()

  await userEvent.click(within(dialog).getByRole("button", { name: en.management.confirm }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: en.management.createAccount }))
  dialog = await screen.findByRole("dialog")
  expect(within(dialog).queryByText("Temp-9x!Q")).not.toBeInTheDocument()
  expect(within(dialog).getByRole("button", { name: en.management.createAccount })).toHaveAttribute(
    "type",
    "submit"
  )
  expect(within(dialog).getByLabelText(en.management.username)).toBeEnabled()
})

it("asks before archiving a selection and never toasts an all-failed batch as success", async () => {
  ;(managementRequest as jest.Mock).mockImplementation(
    (_instanceId: string, operation: ManagementOperation) =>
      operation.kind === "createAccountBatch"
        ? response({ succeeded: 0, failed: 1 })
        : mockOperation(operation)
  )
  renderSection("accounts")
  const table = await screen.findByRole("table")
  await userEvent.click(within(table).getByRole("checkbox", { name: "child-a" }))
  await userEvent.click(screen.getByRole("button", { name: en.management.batchArchive }))

  const confirm = await screen.findByRole("alertdialog")
  expect(confirm).toHaveTextContent(en.management.batchArchiveTitle(1))
  await userEvent.click(within(confirm).getByRole("button", { name: en.management.cancel }))
  expect(calls("actionPreview")).toHaveLength(0)

  await userEvent.click(screen.getByRole("button", { name: en.management.batchArchive }))
  await userEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: en.management.batchArchive,
    })
  )
  await waitFor(() => expect(calls("createAccountBatch")).toHaveLength(1))
  expect(calls("createAccountBatch")[0]).toMatchObject({
    body: { action: "archive", account_ids: [2], reason: en.management.bulkReason.archive },
  })
})

it("hides selection when the connection cannot write accounts", async () => {
  ;(listInstances as jest.Mock).mockResolvedValue([{ ...instance, readOnly: true }])
  renderSection("accounts")
  const table = await screen.findByRole("table")
  expect(within(table).queryByRole("checkbox")).not.toBeInTheDocument()
})

it("shows a failed account page as an error with retry, not as an empty result", async () => {
  ;(managementRequest as jest.Mock).mockImplementation(
    (_instanceId: string, operation: ManagementOperation) =>
      operation.kind === "accounts"
        ? Promise.reject(new Error("accounts offline"))
        : mockOperation(operation)
  )
  renderSection("accounts")
  const alert = (await screen.findByText("accounts offline")).closest('[role="alert"]')
  expect(alert).not.toBeNull()
  expect(screen.queryByText(en.management.noData)).not.toBeInTheDocument()
  expect(
    within(alert as HTMLElement).getByRole("button", { name: en.management.retry })
  ).toBeEnabled()
})

it("keeps a disabled alert rule disabled when its threshold is edited", async () => {
  ;(managementRequest as jest.Mock).mockImplementation(
    (_instanceId: string, operation: ManagementOperation) =>
      operation.kind === "alertRules"
        ? response({
            items: [
              {
                id: 1,
                owner_id: 1,
                name: "Low child balance",
                kind: "balance_below",
                threshold: 100,
                enabled: false,
                cooldown_sec: 3600,
                version: 3,
              },
            ],
            page: 1,
            page_size: 20,
            total: 1,
          })
        : mockOperation(operation)
  )
  renderSection("audit")
  await userEvent.click((await screen.findByText("Low child balance")).closest("button")!)
  const dialog = await screen.findByRole("dialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.save }))

  await waitFor(() => expect(calls("updateAlertRule")).toHaveLength(1))
  expect(calls("updateAlertRule")[0]).toMatchObject({ id: 1, body: { enabled: false, version: 3 } })
})

it("asks in-app before deleting an alert rule", async () => {
  renderSection("audit")
  await userEvent.click(
    await screen.findByRole("button", { name: `${en.management.delete}: Low child balance` })
  )
  const confirm = await screen.findByRole("alertdialog")
  expect(confirm).toHaveTextContent(en.management.deleteRuleTitle("Low child balance"))
  await userEvent.click(within(confirm).getByRole("button", { name: en.management.delete }))
  await waitFor(() => expect(calls("deleteAlertRule")).toHaveLength(1))
})

async function editAddress(address: string) {
  await userEvent.click(await screen.findByRole("button", { name: en.management.editInstance }))
  const dialog = await screen.findByRole("dialog")
  const field = within(dialog).getByLabelText(en.management.instanceUrl)
  await userEvent.clear(field)
  await userEvent.type(field, address)
  return dialog
}

it("revokes the server credential before saving a new address, and saves nothing if it is kept", async () => {
  ;(saveInstance as jest.Mock).mockResolvedValue({ ...instance, baseUrl: "https://other.example" })
  ;(forgetCredential as jest.Mock)
    .mockRejectedValueOnce(new Error("REMOTE_REVOKE_FAILED_LOCAL_RETAINED:NETWORK_ERROR"))
    .mockRejectedValueOnce(new Error("REMOTE_REVOKE_FAILED_LOCAL_RETAINED:NETWORK_ERROR"))
    .mockResolvedValue({ remoteRevoked: false, localDeleted: true, remoteError: "NETWORK_ERROR" })
  renderSection("management-overview")
  await screen.findByText("master-a")
  const dialog = await editAddress("https://other.example")

  // The server refused the revoke: keeping the credential keeps the old address.
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.save }))
  let warning = await screen.findByRole("alertdialog")
  expect(warning).toHaveTextContent(en.management.localOnlyCredentialWarning)
  await userEvent.click(within(warning).getByRole("button", { name: en.management.cancel }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  expect(forgetCredential).toHaveBeenCalledWith(instance.id)
  expect(saveInstance).not.toHaveBeenCalled()

  // Accepting the local-only delete is what lets the save through.
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.save }))
  warning = await screen.findByRole("alertdialog")
  await userEvent.click(
    within(warning).getByRole("button", { name: en.management.deleteLocalCopy })
  )
  await waitFor(() => expect(saveInstance).toHaveBeenCalledTimes(1))
  expect(forgetCredential).toHaveBeenLastCalledWith(instance.id, true)
  expect((saveInstance as jest.Mock).mock.calls[0][0]).toMatchObject({
    baseUrl: "https://other.example",
  })
  expect((forgetCredential as jest.Mock).mock.invocationCallOrder.at(-1)).toBeLessThan(
    (saveInstance as jest.Mock).mock.invocationCallOrder[0]
  )
})

it("saves an address change directly when there is no credential to revoke", async () => {
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
  ;(saveInstance as jest.Mock).mockResolvedValue({ ...instance, baseUrl: "https://other.example" })
  renderSection("management-overview")
  await screen.findByPlaceholderText("ABCDE-FGHIJ")
  const dialog = await editAddress("https://other.example")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.save }))

  await waitFor(() => expect(saveInstance).toHaveBeenCalledTimes(1))
  expect(forgetCredential).not.toHaveBeenCalled()
})

it("does not revoke anything for an edit that keeps the address and CA", async () => {
  ;(saveInstance as jest.Mock).mockResolvedValue({ ...instance, name: "Renamed" })
  renderSection("management-overview")
  await screen.findByText("master-a")
  await userEvent.click(screen.getByRole("button", { name: en.management.editInstance }))
  const dialog = await screen.findByRole("dialog")
  const name = within(dialog).getByLabelText(en.management.instanceName)
  await userEvent.clear(name)
  await userEvent.type(name, "Renamed")
  await userEvent.click(within(dialog).getByRole("button", { name: en.management.save }))

  await waitFor(() => expect(saveInstance).toHaveBeenCalledTimes(1))
  expect(forgetCredential).not.toHaveBeenCalled()
})
