import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import {
  credentialState,
  cancelPersonalOAuth,
  downloadCsv,
  listInstances,
  loginPersonalInstance,
  managementRequest,
  pairInstance,
  startPersonalOAuth,
} from "@/lib/more-token/client"
import type { ManagementOperation, MoreTokenInstance, PersonalView } from "@/lib/more-token/types"
import { PersonalMoreTokenSection } from "./personal"

jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))
jest.mock("@/lib/more-token/client", () => ({
  ...jest.requireActual("@/lib/more-token/client"),
  credentialState: jest.fn(),
  downloadCsv: jest.fn(),
  forgetCredential: jest.fn(),
  listInstances: jest.fn(),
  loginPersonalInstance: jest.fn(),
  managementRequest: jest.fn(),
  pairInstance: jest.fn(),
  startPersonalOAuth: jest.fn(),
  pollPersonalOAuth: jest.fn(),
  cancelPersonalOAuth: jest.fn(),
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
          group: "default",
          last_login_at: 1_700_000_000,
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
        security: {
          two_factor_enabled: false,
          active_desktop_sessions: 1,
          auth_methods: ["password", "github"],
        },
        access: {
          group: "default",
          active_api_keys: 2,
          available_models: 12,
          last_login_at: 1_700_000_000,
        },
      })
    case "personalBalance":
      return response({
        available: 2400,
        used: 600,
        total: 3000,
        request_count: 18,
        quota_display: {
          quota_per_unit: 500_000,
          display_currency: "CNY",
          conversion_numerator: 1,
          conversion_denominator: 1,
          rate_valid_until: 2_000_000_000,
        },
      })
    case "personalLedger":
      return response({ items: [], page: 1, page_size: 50, total: 0 })
    case "personalModels":
      return response({
        items: [
          {
            model_name: "gpt-5.2",
            description: "Reasoning model",
            vendor_id: 1,
            quota_type: 0,
            model_ratio: 1,
            model_price: 0,
            owner_by: "OpenAI",
            completion_ratio: 4,
            cache_ratio: 0.5,
            create_cache_ratio: 1.25,
            image_ratio: 2,
            audio_ratio: 1.5,
            audio_completion_ratio: 2.5,
            billing_mode: "tiered-ratio",
            enable_groups: ["default"],
            supported_endpoint_types: ["openai"],
          },
          {
            model_name: "dall-e-3",
            description: "Image generation model",
            vendor_id: 1,
            quota_type: 1,
            model_ratio: 0,
            model_price: 0.04,
            completion_ratio: 0,
            enable_groups: ["default"],
            supported_endpoint_types: ["image-generation"],
          },
        ],
        vendors: [{ id: 1, name: "OpenAI" }],
        group_ratio: { default: 1 },
        usable_group: { default: "Default" },
        supported_endpoint: {},
        auto_groups: [],
        pricing_version: "test",
        generated_at: 1_700_000_000,
      })
    case "personalUsage":
      return response({
        definition: "Persisted billing logs for the paired user only",
        start: 1_699_000_000,
        end: 1_700_000_000,
        bucket_seconds: 86400,
        generated_at: 1_700_000_000,
        metrics: { requests: 2, prompt_tokens: 180, completion_tokens: 60, quota: 1600 },
        series: [
          {
            bucket: 1_699_920_000,
            requests: 2,
            prompt_tokens: 180,
            completion_tokens: 60,
            quota: 1600,
          },
        ],
        model_breakdown: [
          {
            model_name: "gpt-5.2",
            requests: 1,
            prompt_tokens: 100,
            completion_tokens: 40,
            quota: 1200,
          },
          {
            model_name: "dall-e-3",
            requests: 1,
            prompt_tokens: 80,
            completion_tokens: 20,
            quota: 400,
          },
        ],
        records: [
          {
            request_id: "req-personal-1",
            status: "success",
            created_at: 1_699_999_900,
            model_name: "gpt-5.2",
            token_name: "Desktop Key",
            group: "default",
            prompt_tokens: 100,
            completion_tokens: 40,
            quota: 1200,
            use_time: 850,
            is_stream: true,
          },
        ],
        filter_options: { groups: ["default"], token_names: ["Desktop Key"] },
        page: 1,
        page_size: 25,
        total: 1,
        quota_display: {
          quota_per_unit: 500_000,
          display_currency: "CNY",
          conversion_numerator: 1,
          conversion_denominator: 1,
          rate_valid_until: 2_000_000_000,
        },
      })
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
  ;(cancelPersonalOAuth as jest.Mock).mockResolvedValue(undefined)
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
  expect(screen.getByText("Raw quota: 2,400")).toBeInTheDocument()
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
  await userEvent.click(await screen.findByRole("button", { name: en.personal.passwordOption }))
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

it("starts browser authorization without exposing a device secret to the UI", async () => {
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
  ;(startPersonalOAuth as jest.Mock).mockResolvedValue({
    handle: "safe-rust-handle",
    authorizationUrl: "http://127.0.0.1:3001/profile?desktop_authorization=ABCDE-FGHIJ",
    expiresAt: 1_800_000_000,
    intervalSeconds: 60,
  })
  const view = renderSection("my-account")
  const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
  await userEvent.click(buttons.at(-1)!)
  await waitFor(() =>
    expect(startPersonalOAuth).toHaveBeenCalledWith(
      personalInstance.id,
      "agentpack-personal-desktop",
      "AgentPack Desktop"
    )
  )
  expect(screen.queryByText(/device_code/i)).not.toBeInTheDocument()
  view.unmount()
})

it("renders the personal model marketplace from the isolated models operation", async () => {
  renderSection("my-models")
  expect(await screen.findByText("gpt-5.2")).toBeInTheDocument()
  expect(screen.getAllByText("OpenAI").length).toBeGreaterThan(0)
  expect(managementRequest).toHaveBeenCalledWith(personalInstance.id, { kind: "personalModels" })
})

it("filters personal usage and exports the visible billing records", async () => {
  renderSection("my-usage")
  expect(await screen.findByText("req-personal-1")).toBeInTheDocument()
  expect(screen.getAllByText("gpt-5.2").length).toBeGreaterThan(0)

  await userEvent.selectOptions(screen.getByLabelText("Usage model"), "gpt-5.2")
  await userEvent.selectOptions(screen.getByLabelText("Usage group"), "default")
  await userEvent.selectOptions(screen.getByLabelText("Usage API key"), "Desktop Key")
  await userEvent.selectOptions(screen.getByLabelText("Usage status"), "success")
  await waitFor(() =>
    expect(managementRequest).toHaveBeenCalledWith(
      personalInstance.id,
      expect.objectContaining({
        kind: "personalUsage",
        model: "gpt-5.2",
        group: "default",
        tokenName: "Desktop Key",
        status: "success",
        page: 1,
        pageSize: 25,
      })
    )
  )

  await userEvent.click(screen.getByRole("button", { name: "Export CSV" }))
  await waitFor(() => expect(downloadCsv).toHaveBeenCalled())
})

it("filters the model marketplace and opens complete model details", async () => {
  renderSection("my-models")
  await screen.findByText("gpt-5.2")

  await userEvent.selectOptions(screen.getByLabelText("Model vendor"), "1")
  await userEvent.selectOptions(screen.getByLabelText("Billing type"), "fixed")
  expect(screen.getByText("dall-e-3")).toBeInTheDocument()
  expect(screen.queryByText("gpt-5.2")).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: "dall-e-3" }))
  expect(await screen.findByRole("dialog")).toHaveTextContent("Image generation model")
  expect(screen.getByRole("dialog")).toHaveTextContent("image-generation")
})

it("shows extended ratio and ownership metadata in model details", async () => {
  renderSection("my-models")
  await userEvent.click(await screen.findByRole("button", { name: "gpt-5.2" }))
  const dialog = await screen.findByRole("dialog")
  expect(dialog).toHaveTextContent("Model owner: OpenAI")
  expect(dialog).toHaveTextContent("Billing mode: tiered-ratio")
  expect(dialog).toHaveTextContent("Cache write ratio: 1.25×")
  expect(dialog).toHaveTextContent("Audio output ratio: 2.5×")
})
