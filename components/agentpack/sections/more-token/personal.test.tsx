import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import {
  credentialState,
  listInstances,
  loginPersonalInstance,
  managementRequest,
  pairInstance,
} from "@/lib/more-token/client"
import type { ManagementOperation, MoreTokenInstance, PersonalView } from "@/lib/more-token/types"
import { PersonalMoreTokenSection } from "./personal"

jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))
jest.mock("@/lib/more-token/client", () => ({
  ...jest.requireActual("@/lib/more-token/client"),
  credentialState: jest.fn(),
  forgetCredential: jest.fn(),
  listInstances: jest.fn(),
  loginPersonalInstance: jest.fn(),
  managementRequest: jest.fn(),
  pairInstance: jest.fn(),
  removeInstance: jest.fn(),
  saveInstance: jest.fn(),
}))

const personalInstance: MoreTokenInstance = {
  id: "personal-local",
  name: "My local account",
  baseUrl: "http://127.0.0.1:3001",
  caFingerprint: null,
  readOnly: false,
  displayCurrency: null,
  package: "personal",
}

const managementInstance: MoreTokenInstance = {
  ...personalInstance,
  id: "management-local",
  name: "Operations",
  package: "management",
}

function response<T>(data: T) {
  return Promise.resolve({ success: true as const, data, request_id: "request-1", server_time: 1 })
}

function mockOperation(operation: ManagementOperation) {
  switch (operation.kind) {
    case "personalCapabilities":
      return response({
        personal_api_version: "1.0",
        role: "user",
        scopes: ["personal:account:read", "personal:balance:read"],
        features: {
          profile_edit_enabled: true,
          password_change_enabled: true,
          account_close_enabled: true,
          billing_portal_enabled: true,
        },
        billing_portal_path: "/console/topup",
      })
    case "personalOverview":
      return response({
        account: {
          id: 2,
          username: "atlas-user",
          display_name: "Atlas User",
          email: "atlas@example.com",
          role: 1,
          status: 1,
          lifecycle_state: "active",
          master_id: 1,
          is_master: false,
          quota: 2400,
          used_quota: 600,
          request_count: 18,
          created_at: 1_700_000_000,
        },
        balance: { available: 2400, used: 600, total: 3000 },
        quota_display: {
          quota_per_unit: 500_000,
          display_currency: "CNY",
          conversion_numerator: 1,
          conversion_denominator: 1,
          rate_valid_until: 2_000_000_000,
        },
        parent: { id: 1, username: "atlas-master", display_name: "Atlas Team" },
        ledger_entries: 3,
      })
    case "personalBalance":
      return response({ available: 2400, used: 600, total: 3000, request_count: 18 })
    case "personalLedger":
      return response({ items: [], page: 1, page_size: 50, total: 0 })
    default:
      return response({})
  }
}

function renderSection(view: PersonalView) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <PersonalMoreTokenSection view={view} />
      </I18nProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(listInstances as jest.Mock).mockResolvedValue([managementInstance, personalInstance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  ;(managementRequest as jest.Mock).mockImplementation(
    (_instanceId: string, operation: ManagementOperation) => mockOperation(operation)
  )
})

it("hides management-package instances from the personal workspace", async () => {
  ;(listInstances as jest.Mock).mockResolvedValue([managementInstance])
  renderSection("my-account")
  expect(await screen.findByText(en.management.noInstances)).toBeInTheDocument()
  expect(screen.queryByText("Operations")).not.toBeInTheDocument()
  expect(managementRequest).not.toHaveBeenCalled()
})

it("renders only the paired user's balance and parent relationship", async () => {
  renderSection("my-account")
  expect(await screen.findByDisplayValue("Atlas User")).toBeInTheDocument()
  expect(screen.getByText("Atlas Team")).toBeInTheDocument()
  expect(screen.getByText("2,400")).toBeInTheDocument()
  expect(screen.queryByText("Operations")).not.toBeInTheDocument()
  await waitFor(() => {
    const operations = (managementRequest as jest.Mock).mock.calls.map(
      (call) => (call[1] as ManagementOperation).kind
    )
    expect(operations).toEqual(expect.arrayContaining(["personalCapabilities", "personalOverview"]))
    expect(operations.every((kind) => kind.startsWith("personal"))).toBe(true)
  })
})

it("uses the personal client identity when pairing", async () => {
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
  ;(pairInstance as jest.Mock).mockResolvedValue({
    tokenId: 8,
    expiresAt: 1_800_000_000,
    credentialPersistent: true,
  })
  renderSection("my-balance")
  await userEvent.click(await screen.findByRole("button", { name: en.personal.pairingOption }))
  const input = await screen.findByLabelText(en.management.pairingCode)
  await userEvent.type(input, "ABCDEFGHJK")
  await userEvent.click(screen.getByRole("button", { name: en.management.pair }))
  await waitFor(() =>
    expect(pairInstance).toHaveBeenCalledWith(
      personalInstance.id,
      "ABCDEFGHJK",
      "agentpack-personal-desktop"
    )
  )
})

it("supports direct username and password login without persisting password state", async () => {
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
  ;(loginPersonalInstance as jest.Mock).mockResolvedValue({
    tokenId: 9,
    expiresAt: 1_800_000_000,
    credentialPersistent: true,
  })
  renderSection("my-account")
  await userEvent.type(await screen.findByLabelText(en.personal.usernameOrEmail), "atlas-sandbox")
  await userEvent.type(screen.getByLabelText(en.management.password), "DemoPassword123")
  await userEvent.click(screen.getByRole("button", { name: en.personal.signIn }))
  await waitFor(() =>
    expect(loginPersonalInstance).toHaveBeenCalledWith(
      personalInstance.id,
      "atlas-sandbox",
      "DemoPassword123",
      null,
      "agentpack-personal-desktop",
      "AgentPack Desktop"
    )
  )
})
