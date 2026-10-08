import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import {
  cancelPersonalOAuth,
  credentialState,
  downloadCsv,
  forgetCredential,
  listInstances,
  loginPersonalInstance,
  ManagementApiError,
  managementRequest,
  pairInstance,
  pollPersonalOAuth,
  removeInstance,
  saveInstance,
  startPersonalOAuth,
} from "@/lib/more-token/client"
import { openUrl } from "@/lib/tauri/system"
import type {
  ManagementOperation,
  MoreTokenInstance,
  PersonalCapabilities,
  PersonalLedgerEntry,
  PersonalModelCatalog,
  PersonalOverview,
  PersonalSession,
  PersonalUsage,
  PersonalView,
} from "@/lib/more-token/types"
import { PersonalMoreTokenSection } from "./personal"

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
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

const secondInstance: MoreTokenInstance = {
  ...personalInstance,
  id: "personal-second",
  name: "Second account",
  baseUrl: "http://127.0.0.1:4002",
}

const quotaDisplay = {
  quota_per_unit: 500_000,
  display_currency: "CNY",
  conversion_numerator: 1,
  conversion_denominator: 1,
  rate_valid_until: 2_000_000_000,
  version: 1,
}

function capabilities(overrides: Partial<PersonalCapabilities> = {}): PersonalCapabilities {
  return {
    personal_api_version: "1.0",
    current_session_id: 9,
    role: "user",
    scopes: ["personal:account:read"],
    features: {
      profile_edit_enabled: true,
      password_change_enabled: true,
      account_close_enabled: true,
      billing_portal_enabled: true,
    },
    billing_portal_path: "/console/topup",
    ...overrides,
  } as PersonalCapabilities
}

function overview(overrides: Partial<PersonalOverview> = {}): PersonalOverview {
  return {
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
    quota_display: quotaDisplay,
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
    ...overrides,
  }
}

function session(overrides: Partial<PersonalSession>): PersonalSession {
  return {
    id: 9,
    public_id: "session-current",
    user_id: 2,
    client_id: "agentpack-personal-desktop",
    client_label: "This desktop",
    scopes: "",
    expires_at: 2_000_000_000,
    last_used_at: 1_700_000_900,
    revoked_at: 0,
    created_at: 1_700_000_000,
    ...overrides,
  }
}

function ledgerEntry(overrides: Partial<PersonalLedgerEntry>): PersonalLedgerEntry {
  return {
    id: 1,
    operation_id: "op-1",
    type: "topup",
    amount: 500,
    delta: 500,
    balance_before: 0,
    balance_after: 500,
    counterparty: "",
    reason: "",
    status: "done",
    created_at: 1_700_000_000,
    ...overrides,
  }
}

function catalog(overrides: Partial<PersonalModelCatalog> = {}): PersonalModelCatalog {
  return {
    items: [
      {
        model_name: "gpt-5.2",
        description: "Reasoning model",
        vendor_id: 1,
        quota_type: 0,
        model_ratio: 1,
        model_price: 0,
        completion_ratio: 4,
        enable_groups: ["default", "vip"],
        supported_endpoint_types: ["openai"],
      },
      {
        model_name: "embed-small",
        tags: "embedding, cheap",
        quota_type: 0,
        model_ratio: 0.1,
        model_price: 0,
        completion_ratio: 1,
        enable_groups: ["default"],
        supported_endpoint_types: ["embeddings"],
      },
    ],
    vendors: [{ id: 1, name: "OpenAI" }],
    group_ratio: { default: 1 },
    usable_group: { default: "Default" },
    supported_endpoint: { openai: { method: "POST", path: "/v1/chat/completions" } },
    auto_groups: [],
    pricing_version: "test",
    generated_at: 1_700_000_000,
    ...overrides,
  }
}

function usage(overrides: Partial<PersonalUsage> = {}): PersonalUsage {
  return {
    definition: "Persisted billing logs for the paired user only",
    start: 1_699_000_000,
    end: 1_700_000_000,
    bucket_seconds: 86400,
    generated_at: 1_700_000_000,
    metrics: { requests: 3, prompt_tokens: 180, completion_tokens: 60, quota: 1600 },
    series: [
      {
        bucket: 1_699_920_000,
        requests: 2,
        prompt_tokens: 180,
        completion_tokens: 60,
        quota: 1600,
      },
      { bucket: 1_699_930_000, requests: 1, prompt_tokens: 0, completion_tokens: 0, quota: -200 },
    ],
    model_breakdown: [
      { model_name: "", requests: 1, prompt_tokens: 100, completion_tokens: 40, quota: 1200 },
    ],
    records: [
      {
        request_id: "req-refund",
        status: "refund",
        created_at: 1_699_999_800,
        model_name: "gpt-5.2",
        token_name: "",
        group: "",
        prompt_tokens: 0,
        completion_tokens: 0,
        quota: -200,
        use_time: 10,
        is_stream: false,
      },
      {
        request_id: "req-error",
        status: "error",
        created_at: 1_699_999_850,
        model_name: "",
        token_name: "Desktop Key",
        group: "default",
        prompt_tokens: 5,
        completion_tokens: 0,
        quota: 0,
        use_time: 20,
        is_stream: false,
      },
      {
        request_id: "",
        status: "queued",
        created_at: 1_699_999_900,
        model_name: "gpt-5.2",
        token_name: "Desktop Key",
        group: "default",
        prompt_tokens: 1,
        completion_tokens: 1,
        quota: 1,
        use_time: 30,
        is_stream: true,
      },
    ],
    filter_options: { groups: ["default"], token_names: ["Desktop Key"] },
    page: 1,
    page_size: 25,
    total: 3,
    quota_display: quotaDisplay,
    ...overrides,
  } as PersonalUsage
}

type Handler = (operation: ManagementOperation) => unknown
let handlers: Partial<Record<ManagementOperation["kind"], Handler>> = {}

function ok<T>(data: T) {
  return { success: true as const, data, request_id: "request-1", server_time: 1 }
}

const defaults: Partial<Record<ManagementOperation["kind"], Handler>> = {
  personalCapabilities: () => capabilities(),
  personalOverview: () => overview(),
  personalSessions: () => [
    session({}),
    session({ id: 10, public_id: "session-other", client_label: "Other desktop" }),
  ],
  personalBalance: () => ({
    available: 2400,
    used: 600,
    total: 3000,
    request_count: 18,
    quota_display: quotaDisplay,
  }),
  personalLedger: () => ({ items: [], page: 1, page_size: 25, total: 0 }),
  personalModels: () => catalog(),
  personalUsage: () => usage(),
}

function operations(kind: ManagementOperation["kind"]) {
  return (managementRequest as jest.Mock).mock.calls
    .map((call) => call[1] as ManagementOperation)
    .filter((operation) => operation.kind === kind)
}

/** A promise the test settles by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function renderSection(view: PersonalView, props: { onOpenSecurity?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <PersonalMoreTokenSection view={view} {...props} />
      </I18nProvider>
    </QueryClientProvider>
  )
  return { ...result, client }
}

beforeEach(() => {
  jest.clearAllMocks()
  handlers = {}
  ;(listInstances as jest.Mock).mockResolvedValue([personalInstance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  ;(cancelPersonalOAuth as jest.Mock).mockResolvedValue(undefined)
  ;(managementRequest as jest.Mock).mockImplementation(
    async (_instanceId: string, operation: ManagementOperation) => {
      const handler = handlers[operation.kind] ?? defaults[operation.kind]
      return ok(handler ? await handler(operation) : {})
    }
  )
})

describe("section frame", () => {
  it("reports a failed instance list in the body and the metric, and retries it", async () => {
    ;(listInstances as jest.Mock).mockRejectedValueOnce(new Error("instances store locked"))
    renderSection("my-account")

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("instances store locked")).toBeInTheDocument()
    const summary = screen.getByRole("region", { name: "Personal account status" })
    expect(within(summary).getByText("instances store locked")).toBeInTheDocument()

    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByDisplayValue("Atlas User")).toBeInTheDocument()
    expect(listInstances).toHaveBeenCalledTimes(2)
  })

  it("shows a capabilities failure with a retry that asks again", async () => {
    handlers.personalCapabilities = () => {
      throw new ManagementApiError("PERSONAL_DISABLED", "personal API is off")
    }
    renderSection("my-account")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("PERSONAL_DISABLED: personal API is off")

    handlers.personalCapabilities = () => capabilities()
    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByDisplayValue("Atlas User")).toBeInTheDocument()
    expect(operations("personalCapabilities")).toHaveLength(2)
  })

  it("offers Add instance from the empty state and opens the add dialog", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([])
    renderSection("my-account")
    await screen.findByText(en.management.noInstances)
    // The header has no copy of the button while there is nothing to manage.
    const [add] = screen.getAllByRole("button", { name: en.management.addInstance })
    await userEvent.click(add)
    const dialog = await screen.findByRole("dialog")
    // A new connection gets a fresh personal id rather than the edited one's.
    expect(
      (within(dialog).getByLabelText(en.management.instanceId) as HTMLInputElement).value
    ).toMatch(/^personal-/)
    expect(
      within(dialog).queryByRole("button", { name: en.management.removeInstance })
    ).not.toBeInTheDocument()
  })

  it("names a memory-only credential and switches instances from the picker", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([personalInstance, secondInstance])
    ;(credentialState as jest.Mock).mockImplementation(async (id: string) =>
      id === secondInstance.id
        ? { connected: true, persistent: false }
        : { connected: true, persistent: true }
    )
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    expect(screen.getByText(en.management.persistentCredential)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText(en.management.instance), secondInstance.id)
    expect(await screen.findByText(en.management.memoryCredential)).toBeInTheDocument()
    expect(screen.getByText(secondInstance.baseUrl)).toBeInTheDocument()
    expect(credentialState).toHaveBeenCalledWith(secondInstance.id)
  })

  it("refreshes every cached reading for the active instance", async () => {
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    expect(operations("personalOverview")).toHaveLength(1)
    await userEvent.click(screen.getByRole("button", { name: en.management.retry }))
    await waitFor(() => expect(operations("personalOverview")).toHaveLength(2))
    expect(credentialState).toHaveBeenCalledTimes(2)
  })

  it("keeps the credential when the user declines the local-only delete", async () => {
    ;(forgetCredential as jest.Mock).mockRejectedValueOnce(new Error("server unreachable"))
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    await userEvent.click(screen.getByRole("button", { name: en.management.disconnect }))
    const confirm = await screen.findByRole("alertdialog")
    expect(confirm).toHaveTextContent(en.management.localOnlyCredentialWarning)
    await userEvent.click(within(confirm).getByRole("button", { name: en.management.cancel }))

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(forgetCredential).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(credentialState).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: en.management.disconnect })).toBeInTheDocument()
  })

  it("toasts when even the local-only delete fails during disconnect", async () => {
    ;(forgetCredential as jest.Mock)
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockRejectedValueOnce(new Error("keychain write denied"))
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")

    await userEvent.click(screen.getByRole("button", { name: en.management.disconnect }))
    const confirm = await screen.findByRole("alertdialog")
    expect(confirm).toHaveTextContent("server unreachable")
    await userEvent.click(
      within(confirm).getByRole("button", { name: en.management.deleteLocalCopy })
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("keychain write denied"))
    expect(forgetCredential).toHaveBeenLastCalledWith(personalInstance.id, true)
    // Nothing was forgotten, so the account stays on screen.
    expect(screen.getByDisplayValue("Atlas User")).toBeInTheDocument()
  })

  it("opens the add dialog from the header once there is an instance", async () => {
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    await userEvent.click(screen.getByRole("button", { name: en.management.addInstance }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: en.management.addInstance })).toBeVisible()
    expect(within(dialog).getByLabelText(en.management.instanceId)).not.toHaveAttribute("readonly")
  })

  it("retries a credential reading that failed", async () => {
    ;(credentialState as jest.Mock).mockRejectedValueOnce(new Error("vault busy"))
    renderSection("my-account")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("vault busy")
    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByDisplayValue("Atlas User")).toBeInTheDocument()
    expect(credentialState).toHaveBeenCalledTimes(2)
  })

  it("removes a connection after revoking it and falls back to the next one", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([personalInstance, secondInstance])
    ;(forgetCredential as jest.Mock).mockResolvedValue({
      remoteRevoked: true,
      localDeleted: true,
      remoteError: null,
    })
    ;(removeInstance as jest.Mock).mockImplementation(async () => {
      ;(listInstances as jest.Mock).mockResolvedValue([secondInstance])
    })
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    await userEvent.click(screen.getByRole("button", { name: en.management.editInstance }))
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: en.management.removeInstance })
    )
    const confirm = await screen.findByRole("alertdialog")
    expect(confirm).toHaveTextContent(en.management.removeInstanceTitle(personalInstance.name))
    await userEvent.click(
      within(confirm).getByRole("button", { name: en.management.removeInstance })
    )

    await waitFor(() => expect(removeInstance).toHaveBeenCalledWith(personalInstance.id))
    expect(forgetCredential).toHaveBeenCalledWith(personalInstance.id)
    await waitFor(() =>
      expect(screen.getByLabelText(en.management.instance)).toHaveValue(secondInstance.id)
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByText(secondInstance.baseUrl)).toBeInTheDocument()
  })

  it("offers to drop a custom CA and re-reads the credential the change invalidated", async () => {
    const pinned = { ...personalInstance, caFingerprint: "ab12cd34ef56ab12cd34ef56" }
    ;(listInstances as jest.Mock).mockResolvedValue([pinned])
    ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
    ;(forgetCredential as jest.Mock).mockResolvedValue({
      remoteRevoked: true,
      localDeleted: true,
      remoteError: null,
    })
    ;(saveInstance as jest.Mock).mockImplementation(async () => ({
      ...pinned,
      caFingerprint: null,
    }))
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    await userEvent.click(screen.getByRole("button", { name: en.management.editInstance }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("ab12cd34ef56ab12…")).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("checkbox"))
    await userEvent.click(within(dialog).getByRole("button", { name: en.management.save }))

    await waitFor(() => expect(saveInstance).toHaveBeenCalledTimes(1))
    expect((saveInstance as jest.Mock).mock.calls[0][0]).toMatchObject({
      id: pinned.id,
      clearCustomCa: true,
      package: "personal",
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    // The old binding's credential is revoked on the server before the CA moves.
    expect(forgetCredential).toHaveBeenCalledWith(pinned.id)
    // One reading at open, one check before saving, then a re-read after each
    // cache reset (the revoke and the save).
    expect(credentialState).toHaveBeenCalledTimes(4)
  })

  it("does not repeat the Security link on the Security tab itself", async () => {
    handlers.personalCapabilities = () => capabilities({ must_change_password: true })
    renderSection("my-security", { onOpenSecurity: jest.fn() })
    expect(await screen.findByText(en.personal.mustChangePassword)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: en.personal.openSecurity })).not.toBeInTheDocument()
  })
})

describe("sign-in panel", () => {
  beforeEach(() => {
    ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
  })

  it("asks for a second factor when the server requires one and sends it on retry", async () => {
    ;(loginPersonalInstance as jest.Mock)
      .mockRejectedValueOnce(new ManagementApiError("TWO_FACTOR_REQUIRED", "code needed"))
      .mockResolvedValueOnce({ tokenId: 1, expiresAt: 1, credentialPersistent: false })
    renderSection("my-account")
    await userEvent.click(await screen.findByRole("button", { name: en.personal.passwordOption }))
    expect(screen.queryByLabelText(en.personal.twoFactorCode)).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(en.personal.usernameOrEmail), "atlas")
    await userEvent.type(screen.getByLabelText(en.management.password), "secret-pass")
    await userEvent.click(screen.getByRole("button", { name: en.personal.signIn }))

    const code = await screen.findByLabelText(en.personal.twoFactorCode)
    expect(toast.error).toHaveBeenCalledWith("TWO_FACTOR_REQUIRED: code needed")
    expect(screen.getByText(en.personal.twoFactorHint)).toBeInTheDocument()

    await userEvent.type(code, "123456")
    await userEvent.click(screen.getByRole("button", { name: en.personal.signIn }))
    await waitFor(() =>
      expect(loginPersonalInstance).toHaveBeenLastCalledWith(
        personalInstance.id,
        "atlas",
        "secret-pass",
        "123456",
        "agentpack-personal-desktop",
        "AgentPack Desktop"
      )
    )
    expect(toast.success).toHaveBeenCalledWith(en.management.memoryCredential)
  })

  it("keeps the code field hidden for an ordinary login failure", async () => {
    ;(loginPersonalInstance as jest.Mock).mockRejectedValue(new Error("INVALID_CREDENTIALS"))
    renderSection("my-account")
    await userEvent.click(await screen.findByRole("button", { name: en.personal.passwordOption }))
    await userEvent.type(screen.getByLabelText(en.personal.usernameOrEmail), "atlas")
    await userEvent.type(screen.getByLabelText(en.management.password), "wrong")
    await userEvent.click(screen.getByRole("button", { name: en.personal.signIn }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("INVALID_CREDENTIALS"))
    expect(screen.queryByLabelText(en.personal.twoFactorCode)).not.toBeInTheDocument()
  })

  it("labels the sign-in and pair buttons while their requests are in flight", async () => {
    const login = deferred<unknown>()
    const pair = deferred<unknown>()
    ;(loginPersonalInstance as jest.Mock).mockReturnValue(login.promise)
    ;(pairInstance as jest.Mock).mockReturnValue(pair.promise)
    renderSection("my-account")
    await userEvent.click(await screen.findByRole("button", { name: en.personal.passwordOption }))
    await userEvent.type(screen.getByLabelText(en.personal.usernameOrEmail), "atlas")
    await userEvent.type(screen.getByLabelText(en.management.password), "pw")
    await userEvent.click(screen.getByRole("button", { name: en.personal.signIn }))
    expect(await screen.findByRole("button", { name: en.personal.signingIn })).toBeDisabled()

    await userEvent.click(screen.getByRole("button", { name: en.personal.pairingOption }))
    await userEvent.click(screen.getByRole("button", { name: en.management.pair }))
    expect(await screen.findByRole("button", { name: en.management.pairing })).toBeDisabled()
    // An empty field is sent as an empty code, not as a missing one.
    expect(pairInstance).toHaveBeenCalledWith(personalInstance.id, "", "agentpack-personal-desktop")

    await act(async () => {
      pair.resolve({ tokenId: 1, expiresAt: 1, credentialPersistent: false })
      login.resolve({ tokenId: 1, expiresAt: 1, credentialPersistent: true })
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en.management.memoryCredential))
  })

  it("reports a rejected pairing code", async () => {
    ;(pairInstance as jest.Mock).mockRejectedValue(new Error("PAIRING_CODE_EXPIRED"))
    renderSection("my-account")
    await userEvent.click(await screen.findByRole("button", { name: en.personal.pairingOption }))
    await userEvent.type(screen.getByLabelText(en.management.pairingCode), "ABCDE")
    await userEvent.click(screen.getByRole("button", { name: en.management.pair }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("PAIRING_CODE_EXPIRED"))
  })

  it("reports a browser sign-in that could not start", async () => {
    ;(startPersonalOAuth as jest.Mock).mockRejectedValue(new Error("OAUTH_DISABLED"))
    renderSection("my-account")
    const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
    await userEvent.click(buttons.at(-1)!)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("OAUTH_DISABLED"))
    expect(openUrl).not.toHaveBeenCalled()
  })

  it("polls until the browser approves, then reads the new credential", async () => {
    ;(startPersonalOAuth as jest.Mock).mockResolvedValue({
      handle: "handle-1",
      authorizationUrl: "http://127.0.0.1:3001/authorize",
      expiresAt: 1_800_000_000,
      intervalSeconds: 0,
    })
    ;(pollPersonalOAuth as jest.Mock)
      .mockResolvedValueOnce({ status: "pending" })
      .mockImplementationOnce(async () => {
        ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
        return {
          status: "authorized",
          credential: { tokenId: 3, expiresAt: 1, credentialPersistent: true },
        }
      })
    renderSection("my-account")
    const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
    await userEvent.click(buttons.at(-1)!)

    expect(await screen.findByDisplayValue("Atlas User")).toBeInTheDocument()
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:3001/authorize")
    expect(pollPersonalOAuth).toHaveBeenCalledTimes(2)
    expect(pollPersonalOAuth).toHaveBeenCalledWith(personalInstance.id, "handle-1")
    expect(toast.success).toHaveBeenCalledWith(en.management.persistentCredential)
    // An authorized handle is finished; there is nothing left to cancel.
    expect(cancelPersonalOAuth).not.toHaveBeenCalled()
  })

  it("says so when an approved browser sign-in only got a memory credential", async () => {
    ;(startPersonalOAuth as jest.Mock).mockResolvedValue({
      handle: "handle-mem",
      authorizationUrl: "http://127.0.0.1:3001/authorize",
      expiresAt: 1_800_000_000,
      intervalSeconds: 0,
    })
    ;(pollPersonalOAuth as jest.Mock).mockResolvedValue({
      status: "authorized",
      credential: { tokenId: 3, expiresAt: 1, credentialPersistent: false },
    })
    renderSection("my-account")
    const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
    await userEvent.click(buttons.at(-1)!)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en.management.memoryCredential))
  })

  it("stops waiting and says why when polling fails", async () => {
    ;(startPersonalOAuth as jest.Mock).mockResolvedValue({
      handle: "handle-2",
      authorizationUrl: "http://127.0.0.1:3001/authorize",
      expiresAt: 1_800_000_000,
      intervalSeconds: 0,
    })
    ;(pollPersonalOAuth as jest.Mock).mockRejectedValue(new Error("AUTHORIZATION_DENIED"))
    renderSection("my-account")
    const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
    await userEvent.click(buttons.at(-1)!)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("AUTHORIZATION_DENIED"))
    expect(
      screen.queryByRole("button", { name: en.personal.restartBrowserSignIn })
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: en.personal.browserSignIn }).at(-1)).toBeEnabled()
    // A failed handle is finished too.
    expect(cancelPersonalOAuth).not.toHaveBeenCalled()
  })

  it("backs off for six seconds when the server says slow down", async () => {
    jest.useFakeTimers()
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
      ;(startPersonalOAuth as jest.Mock).mockResolvedValue({
        handle: "handle-slow",
        authorizationUrl: "http://127.0.0.1:3001/authorize",
        expiresAt: 1_800_000_000,
        intervalSeconds: 1,
      })
      ;(pollPersonalOAuth as jest.Mock).mockResolvedValue({ status: "slow_down" })
      const view = renderSection("my-account")
      const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
      await user.click(buttons.at(-1)!)
      await screen.findByRole("button", { name: en.personal.restartBrowserSignIn })

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(pollPersonalOAuth).toHaveBeenCalledTimes(1)
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })
      expect(pollPersonalOAuth).toHaveBeenCalledTimes(1)
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000)
      })
      expect(pollPersonalOAuth).toHaveBeenCalledTimes(2)
      view.unmount()
      expect(cancelPersonalOAuth).toHaveBeenCalledWith(personalInstance.id, "handle-slow")
    } finally {
      jest.useRealTimers()
    }
  })

  it("ignores a poll reply that lands after the panel has gone", async () => {
    const reply = deferred<unknown>()
    ;(startPersonalOAuth as jest.Mock).mockResolvedValue({
      handle: "handle-late",
      authorizationUrl: "http://127.0.0.1:3001/authorize",
      expiresAt: 1_800_000_000,
      intervalSeconds: 0,
    })
    ;(pollPersonalOAuth as jest.Mock).mockReturnValue(reply.promise)
    const view = renderSection("my-account")
    const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
    await userEvent.click(buttons.at(-1)!)
    await waitFor(() => expect(pollPersonalOAuth).toHaveBeenCalled())

    view.unmount()
    expect(cancelPersonalOAuth).toHaveBeenCalledWith(personalInstance.id, "handle-late")
    await act(async () =>
      reply.resolve({
        status: "authorized",
        credential: { tokenId: 1, expiresAt: 1, credentialPersistent: true },
      })
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(credentialState).toHaveBeenCalledTimes(1)
  })

  it("restarts browser sign-in with a fresh handle and cancels the old one", async () => {
    ;(startPersonalOAuth as jest.Mock)
      .mockResolvedValueOnce({
        handle: "handle-old",
        authorizationUrl: "http://127.0.0.1:3001/old",
        expiresAt: 1_800_000_000,
        intervalSeconds: 60,
      })
      .mockResolvedValueOnce({
        handle: "handle-new",
        authorizationUrl: "http://127.0.0.1:3001/new",
        expiresAt: 1_800_000_000,
        intervalSeconds: 60,
      })
    const view = renderSection("my-account")
    const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
    await userEvent.click(buttons.at(-1)!)
    await userEvent.click(
      await screen.findByRole("button", { name: en.personal.restartBrowserSignIn })
    )

    await waitFor(() => expect(openUrl).toHaveBeenLastCalledWith("http://127.0.0.1:3001/new"))
    expect(cancelPersonalOAuth).toHaveBeenCalledWith(personalInstance.id, "handle-old")
    expect(startPersonalOAuth).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it("stops waiting on the browser when another sign-in method is picked", async () => {
    ;(startPersonalOAuth as jest.Mock).mockResolvedValue({
      handle: "handle-switch",
      authorizationUrl: "http://127.0.0.1:3001/authorize",
      expiresAt: 1_800_000_000,
      intervalSeconds: 60,
    })
    renderSection("my-account")
    const buttons = await screen.findAllByRole("button", { name: en.personal.browserSignIn })
    await userEvent.click(buttons.at(-1)!)
    await screen.findByRole("button", { name: en.personal.restartBrowserSignIn })

    await userEvent.click(screen.getByRole("button", { name: en.personal.passwordOption }))
    expect(cancelPersonalOAuth).toHaveBeenCalledWith(personalInstance.id, "handle-switch")
    expect(screen.getByRole("heading", { name: en.personal.signInTitle })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: en.personal.browserOption }))
    expect(screen.getByText(en.personal.otherLoginHint)).toBeInTheDocument()
  })
})

describe("account tab", () => {
  it("saves the display name with the account's email", async () => {
    renderSection("my-account")
    const input = await screen.findByDisplayValue("Atlas User")
    await userEvent.clear(input)
    await userEvent.type(input, "Atlas Prime")
    await userEvent.click(screen.getByRole("button", { name: en.personal.saveProfile }))

    await waitFor(() =>
      expect(operations("updatePersonalProfile")).toEqual([
        {
          kind: "updatePersonalProfile",
          body: { display_name: "Atlas Prime", email: "atlas@example.com" },
        },
      ])
    )
    expect(toast.success).toHaveBeenCalledWith(en.personal.saveProfile)
    await waitFor(() => expect(operations("personalOverview")).toHaveLength(2))
  })

  it("reports a rejected profile update", async () => {
    handlers.updatePersonalProfile = () => {
      throw new Error("DISPLAY_NAME_TAKEN")
    }
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    await userEvent.click(screen.getByRole("button", { name: en.personal.saveProfile }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("DISPLAY_NAME_TAKEN"))
  })

  it("shows an overview failure with a retry", async () => {
    let fail = true
    handlers.personalOverview = () => {
      if (fail) throw new Error("overview timed out")
      return overview()
    }
    renderSection("my-account")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("overview timed out")
    fail = false
    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByDisplayValue("Atlas User")).toBeInTheDocument()
  })

  it("opens the billing portal on the server's own origin", async () => {
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    await userEvent.click(screen.getByRole("button", { name: en.personal.openBillingPortal }))
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:3001/console/topup")
  })

  it("refuses a billing portal path that leaves the server", async () => {
    handlers.personalCapabilities = () =>
      capabilities({ billing_portal_path: "//evil.example/steal" })
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    await userEvent.click(screen.getByRole("button", { name: en.personal.openBillingPortal }))
    expect(openUrl).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("SERVER_URL_NOT_ALLOWED")
  })

  it("fills in what an older server leaves out and locks the profile when it is not editable", async () => {
    handlers.personalCapabilities = () =>
      capabilities({
        features: {
          profile_edit_enabled: false,
          password_change_enabled: true,
          account_close_enabled: true,
          billing_portal_enabled: false,
        },
      })
    handlers.personalOverview = () => {
      const base = overview()
      return {
        ...base,
        account: {
          ...base.account,
          display_name: "",
          email: "",
          status: 2,
          lifecycle_state: "",
          group: "",
          last_login_at: 0,
        },
        balance: { available: 0, used: 0, total: 0 },
        parent: null,
        access: undefined,
        security: undefined,
      }
    }
    renderSection("my-account")
    expect(await screen.findByRole("heading", { name: "atlas-user" })).toBeInTheDocument()
    expect(screen.getByText(en.management.disabled)).toBeInTheDocument()
    expect(screen.getByText(en.personal.independent)).toBeInTheDocument()
    expect(screen.getByText(en.personal.usedShare("0%"))).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()
    expect(screen.queryByText("github")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: en.personal.openBillingPortal })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText(en.personal.displayName)).toBeDisabled()
    expect(screen.getByRole("button", { name: en.personal.saveProfile })).toBeDisabled()
    expect(screen.getByText(en.personal.profileEditDisabled)).toBeInTheDocument()
  })

  it.each([
    ["archived", en.management.archived],
    ["closing", en.management.closing],
  ] as const)("labels a %s account by its lifecycle", async (state, label) => {
    handlers.personalOverview = () => {
      const base = overview()
      return { ...base, account: { ...base.account, lifecycle_state: state } }
    }
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText(en.management.enabled)).not.toBeInTheDocument()
  })

  it("shows raw quota alone when the exchange rate has lapsed and names a parent by username", async () => {
    handlers.personalOverview = () => {
      const base = overview()
      return {
        ...base,
        quota_display: { ...quotaDisplay, rate_valid_until: 1_000 },
        parent: { id: 1, username: "atlas-master", display_name: "" },
        access: { ...base.access!, group: "" },
      }
    }
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    const balance = screen.getByRole("region", { name: en.personal.balanceSummary })
    // The primary figure is already the raw quota, so no second raw line.
    expect(within(balance).getByText("2,400 quota")).toBeInTheDocument()
    expect(within(balance).queryByText(/Raw quota/)).not.toBeInTheDocument()
    expect(screen.getByText("atlas-master")).toBeInTheDocument()
    expect(screen.getByText(en.personal.accountGroup).nextElementSibling).toHaveTextContent("—")
  })

  it("explains a read-only connection where the profile would be edited", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([{ ...personalInstance, readOnly: true }])
    renderSection("my-account")
    await screen.findByDisplayValue("Atlas User")
    expect(screen.getByText(en.management.readonlyBanner)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.personal.saveProfile })).toBeDisabled()
  })
})

describe("balance tab", () => {
  it("renders the balance figures and the signed ledger", async () => {
    handlers.personalLedger = () => ({
      items: [
        ledgerEntry({ id: 1, type: "topup", delta: 500, counterparty: "atlas-master" }),
        ledgerEntry({ id: 2, type: "spend", delta: -125, balance_after: 375 }),
      ],
      page: 1,
      page_size: 25,
      total: 2,
    })
    renderSection("my-balance")
    const table = await screen.findByRole("table")
    expect(await within(table).findByText("topup")).toBeInTheDocument()
    expect(within(table).getByText("atlas-master")).toBeInTheDocument()
    const spend = within(table).getByText("spend").closest("tr")!
    expect(spend).toHaveTextContent("-")
    expect(within(spend).getByText("—")).toBeInTheDocument()
    expect(screen.getByText("Raw quota: 3,000")).toBeInTheDocument()
    expect(screen.getByText("18")).toBeInTheDocument()
    expect(screen.getByText(en.personal.pageSummary(1, 1))).toBeInTheDocument()
    expect(screen.queryByText(en.management.exchangeRateExpired)).not.toBeInTheDocument()
  })

  it("says the ledger is empty and warns about an expired exchange rate", async () => {
    handlers.personalBalance = () => ({
      available: 10,
      used: 0,
      total: 10,
      request_count: 0,
      quota_display: { ...quotaDisplay, rate_valid_until: 1_000 },
    })
    renderSection("my-balance")
    expect(await screen.findByText(en.personal.noTransactions)).toBeInTheDocument()
    expect(await screen.findByText(en.management.exchangeRateExpired)).toBeInTheDocument()
  })

  it("shows ledger amounts as raw quota until the balance (and its rate) arrives", async () => {
    handlers.personalBalance = () => new Promise(() => undefined)
    handlers.personalLedger = () => ({
      items: [ledgerEntry({ id: 1, type: "spend", delta: -1250, balance_after: 3750 })],
      page: 1,
      page_size: 25,
      total: 1,
    })
    renderSection("my-balance")
    const row = (await screen.findByText("spend")).closest("tr")!
    expect(row).toHaveTextContent("-1,250")
    expect(row).toHaveTextContent("3,750")
    expect(row).not.toHaveTextContent("quota")
  })

  it("pages through the ledger", async () => {
    handlers.personalLedger = (operation) => {
      const page = (operation as { page: number }).page
      return {
        items: [ledgerEntry({ id: page, type: `entry-page-${page}` })],
        page,
        page_size: 25,
        total: 30,
      }
    }
    renderSection("my-balance")
    expect(await screen.findByText("entry-page-1")).toBeInTheDocument()
    const previous = screen.getByRole("button", { name: en.personal.previousPage })
    const next = screen.getByRole("button", { name: en.personal.nextPage })
    expect(previous).toBeDisabled()

    await userEvent.click(next)
    expect(await screen.findByText("entry-page-2")).toBeInTheDocument()
    expect(screen.getByText(en.personal.pageSummary(2, 2))).toBeInTheDocument()
    expect(next).toBeDisabled()

    await userEvent.click(previous)
    expect(await screen.findByText("entry-page-1")).toBeInTheDocument()
  })

  it("shows a ledger failure and retries both readings", async () => {
    let fail = true
    handlers.personalLedger = () => {
      if (fail) throw new Error("ledger offline")
      return { items: [], page: 1, page_size: 25, total: 0 }
    }
    renderSection("my-balance")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("ledger offline")
    fail = false
    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByText(en.personal.noTransactions)).toBeInTheDocument()
    expect(operations("personalBalance").length).toBeGreaterThanOrEqual(2)
    expect(operations("personalLedger")).toHaveLength(2)
  })
})

describe("usage tab", () => {
  it("labels each record's status and fills blanks with a dash", async () => {
    renderSection("my-usage")
    const refundRow = (await screen.findByText("req-refund")).closest("tr")!
    expect(within(refundRow).getByText(en.personal.statusRefund)).toBeInTheDocument()
    expect(within(refundRow).getAllByText("—")).toHaveLength(2)
    const errorRow = screen.getByText("req-error").closest("tr")!
    expect(within(errorRow).getByText(en.personal.statusError)).toBeInTheDocument()
    expect(within(errorRow).getByText("—")).toBeInTheDocument()
    // An unknown status is shown as the server named it.
    expect(screen.getByText("queued")).toBeInTheDocument()
    expect(screen.getByText(en.personal.durationMs("30"))).toBeInTheDocument()
  })

  it("says nothing matched and disables export when there are no records", async () => {
    handlers.personalUsage = () => usage({ records: [], total: 0, series: [], model_breakdown: [] })
    renderSection("my-usage")
    expect(await screen.findByText(en.personal.noUsageRecords)).toBeInTheDocument()
    const exportButton = screen.getByRole("button", { name: en.personal.exportCsv })
    expect(exportButton).toBeDisabled()
    expect(exportButton).toHaveAttribute("title", en.management.nothingToExport)
  })

  it("changes the range and resets to the first page", async () => {
    handlers.personalUsage = (operation) => {
      const page = (operation as { page: number }).page
      return usage({ page, total: 60 })
    }
    renderSection("my-usage")
    await screen.findByText("req-refund")
    await userEvent.click(screen.getByRole("button", { name: en.personal.nextPage }))
    await waitFor(() =>
      expect(operations("personalUsage").at(-1)).toMatchObject({ page: 2, pageSize: 25 })
    )
    expect(await screen.findByText(en.personal.pageSummary(2, 3))).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: en.personal.previousPage }))
    expect(await screen.findByText(en.personal.pageSummary(1, 3))).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: en.personal.nextPage }))
    await screen.findByText(en.personal.pageSummary(2, 3))
    await userEvent.selectOptions(screen.getByLabelText(en.personal.usageRange), "7")
    await waitFor(() => {
      const last = operations("personalUsage").at(-1) as {
        start: number
        end: number
        page: number
      }
      expect(last.page).toBe(1)
      expect(last.end - last.start).toBe(7 * 86400)
    })
  })

  it("exports every page of records and confirms where the file went", async () => {
    handlers.personalUsage = (operation) => {
      const { page, pageSize } = operation as { page: number; pageSize: number }
      if (pageSize !== 200) return usage()
      return usage({
        total: 450,
        page,
        page_size: 200,
        records: [{ ...usage().records![0], request_id: `export-${page}` }],
      })
    }
    ;(downloadCsv as jest.Mock).mockResolvedValue({ kind: "saved", path: "/tmp/usage.csv" })
    renderSection("my-usage")
    await screen.findByText("req-refund")
    await userEvent.click(screen.getByRole("button", { name: en.personal.exportCsv }))

    await waitFor(() => expect(downloadCsv).toHaveBeenCalled())
    const exportPages = operations("personalUsage")
      .filter((operation) => (operation as { pageSize: number }).pageSize === 200)
      .map((operation) => (operation as { page: number }).page)
    expect(exportPages).toEqual([1, 2, 3])
    const [filename, rows] = (downloadCsv as jest.Mock).mock.calls[0]
    expect(filename).toMatch(/^more-token-usage-\d{4}-\d{2}-\d{2}\.csv$/)
    const requestIds = (rows as Array<Array<string | number>>).map((row) => row.at(-1))
    expect(requestIds).toEqual(expect.arrayContaining(["export-1", "export-2", "export-3"]))
    expect(rows[0]).toEqual([en.personal.usageDefinition, usage().definition])
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(en.management.csvSaved("/tmp/usage.csv"))
    )
  })

  it("stays quiet when the save dialog is cancelled", async () => {
    ;(downloadCsv as jest.Mock).mockResolvedValue({ kind: "cancelled" })
    renderSection("my-usage")
    await screen.findByText("req-refund")
    await userEvent.click(screen.getByRole("button", { name: en.personal.exportCsv }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("says why the file could not be written", async () => {
    ;(downloadCsv as jest.Mock).mockRejectedValue(new Error("disk full"))
    renderSection("my-usage")
    await screen.findByText("req-refund")
    await userEvent.click(screen.getByRole("button", { name: en.personal.exportCsv }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(en.management.csvSaveFailed("disk full"))
    )
  })

  it("reports an export whose records could not be fetched", async () => {
    renderSection("my-usage")
    await screen.findByText("req-refund")
    handlers.personalUsage = (operation) => {
      if ((operation as { pageSize: number }).pageSize === 200) throw new Error("export refused")
      return usage()
    }
    await userEvent.click(screen.getByRole("button", { name: en.personal.exportCsv }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("export refused"))
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  it("shows a usage failure under the filters and retries it", async () => {
    let fail = true
    handlers.personalUsage = () => {
      if (fail) throw new Error("usage backend down")
      return usage()
    }
    renderSection("my-usage")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("usage backend down")
    expect(screen.getByLabelText("Usage status")).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    fail = false
    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByText("req-refund")).toBeInTheDocument()
  })

  it("labels the export button while it is fetching records", async () => {
    const page = deferred<unknown>()
    renderSection("my-usage")
    await screen.findByText("req-refund")
    handlers.personalUsage = (operation) =>
      (operation as { pageSize: number }).pageSize === 200 ? page.promise : usage()
    await userEvent.click(screen.getByRole("button", { name: en.personal.exportCsv }))
    expect(await screen.findByRole("button", { name: en.personal.exportingCsv })).toBeDisabled()
    await act(async () => page.resolve({ ...usage(), records: undefined, total: undefined }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalled())
    // No records came back, so only the header block is written.
    const rows = (downloadCsv as jest.Mock).mock.calls[0][1] as unknown[][]
    expect(rows.at(-1)).toContain(en.personal.requestId)
  })

  it("keeps a selected filter visible even when the reply no longer lists it", async () => {
    renderSection("my-usage")
    await screen.findByText("req-refund")
    await userEvent.selectOptions(screen.getByLabelText("Usage group"), "default")
    handlers.personalUsage = () => usage({ filter_options: { groups: [], token_names: [] } })
    await userEvent.selectOptions(screen.getByLabelText("Usage API key"), "Desktop Key")
    await waitFor(() =>
      expect(operations("personalUsage").at(-1)).toMatchObject({
        group: "default",
        tokenName: "Desktop Key",
      })
    )
    expect(screen.getByLabelText("Usage group")).toHaveValue("default")
    expect(screen.getByLabelText("Usage API key")).toHaveValue("Desktop Key")
  })
})

describe("models tab", () => {
  it("searches by name, tag and vendor, and says when nothing matches", async () => {
    renderSection("my-models")
    await screen.findByText("gpt-5.2")
    const search = screen.getByPlaceholderText(en.personal.searchModels)

    await userEvent.type(search, "cheap")
    expect(screen.getByText("embed-small")).toBeInTheDocument()
    expect(screen.queryByText("gpt-5.2")).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, "openai")
    expect(screen.getByText("gpt-5.2")).toBeInTheDocument()
    expect(screen.queryByText("embed-small")).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, "no-such-model")
    expect(screen.getByText(en.personal.noModels)).toBeInTheDocument()
  })

  it("filters to ratio billing and shows the model's ratios in the row", async () => {
    renderSection("my-models")
    await screen.findByText("gpt-5.2")
    await userEvent.selectOptions(screen.getByLabelText("Billing type"), "ratio")
    expect(screen.getByText(`${en.personal.ratioBilling} · 1× / 4×`)).toBeInTheDocument()
    expect(screen.getByText("embed-small")).toBeInTheDocument()
  })

  it("shows endpoint routes, group names and tags in the detail dialog and closes it", async () => {
    renderSection("my-models")
    await userEvent.click(await screen.findByRole("button", { name: "gpt-5.2" }))
    let dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent("POST /v1/chat/completions")
    expect(within(dialog).getByText("Default")).toBeInTheDocument()
    expect(within(dialog).getByText("vip")).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(en.personal.modelOwner)

    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole("button", { name: "embed-small" }))
    dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("embedding")).toBeInTheDocument()
    expect(within(dialog).getByText("cheap")).toBeInTheDocument()
    // No vendor and no route for this endpoint.
    expect(within(dialog).getAllByText("—").length).toBeGreaterThan(0)
    expect(dialog).not.toHaveTextContent("POST")
  })

  it("handles sparse model entries: no vendor, no description, no endpoints, partial billing facts", async () => {
    handlers.personalModels = () =>
      catalog({
        items: [
          {
            model_name: "bare-model",
            quota_type: 0,
            model_ratio: 2,
            model_price: 0,
            completion_ratio: 3,
            enable_groups: [],
            // Older servers omit the list; the row copes with that.
            supported_endpoint_types: undefined as unknown as string[],
          },
          {
            model_name: "owner-only",
            quota_type: 0,
            model_ratio: 1,
            model_price: 0,
            completion_ratio: 1,
            owner_by: "Acme",
            enable_groups: [],
            supported_endpoint_types: [],
          },
          {
            model_name: "mode-only",
            vendor_id: 1,
            quota_type: 0,
            model_ratio: 1,
            model_price: 0,
            completion_ratio: 1,
            billing_mode: "flat",
            enable_groups: [],
            supported_endpoint_types: [],
          },
        ],
        usable_group: {},
      })
    renderSection("my-models")
    const row = (await screen.findByRole("button", { name: "bare-model" })).closest("tr")!
    expect(within(row).getAllByText("—")).toHaveLength(2)
    expect(within(row).queryByText("openai")).not.toBeInTheDocument()
    expect(screen.getByText(en.personal.accountGroup).nextElementSibling).toHaveTextContent("—")

    // A model with no vendor reads as vendor 0, which no real vendor matches.
    await userEvent.selectOptions(screen.getByLabelText("Model vendor"), "1")
    expect(screen.queryByText("bare-model")).not.toBeInTheDocument()
    expect(screen.queryByText("owner-only")).not.toBeInTheDocument()
    expect(screen.getByText("mode-only")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "mode-only" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(`${en.personal.billingMode}: flat`)
    expect(dialog).not.toHaveTextContent(en.personal.modelOwner)
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText("Model vendor"), "all")
    await userEvent.click(screen.getByRole("button", { name: "owner-only" }))
    const owner = await screen.findByRole("dialog")
    expect(owner).toHaveTextContent(`${en.personal.modelOwner}: Acme`)
    expect(owner).not.toHaveTextContent(en.personal.billingMode)
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    // The detail dialog copes with the missing list as well as the row does.
    await userEvent.click(screen.getByRole("button", { name: "bare-model" }))
    const bare = await screen.findByRole("dialog")
    expect(bare).toHaveTextContent("bare-model")
    expect(bare).toHaveTextContent(en.personal.endpointDetails)
  })

  it("shows a catalog failure with a retry", async () => {
    let fail = true
    handlers.personalModels = () => {
      if (fail) throw new Error("catalog unavailable")
      return catalog()
    }
    renderSection("my-models")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("catalog unavailable")
    fail = false
    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByText("gpt-5.2")).toBeInTheDocument()
  })
})

describe("security tab", () => {
  it("revokes another desktop session and re-reads the list", async () => {
    renderSection("my-security")
    await screen.findByText("Other desktop")
    const [, other] = screen.getAllByRole("button", { name: en.personal.revokeSession })
    await userEvent.click(other)

    await waitFor(() =>
      expect(operations("revokePersonalSession")).toEqual([
        { kind: "revokePersonalSession", id: 10 },
      ])
    )
    expect(toast.success).toHaveBeenCalledWith(en.personal.revoked)
    await waitFor(() => expect(operations("personalSessions")).toHaveLength(2))
  })

  it("reports a failed revoke", async () => {
    handlers.revokePersonalSession = () => {
      throw new Error("SESSION_NOT_FOUND")
    }
    renderSection("my-security")
    await screen.findByText("Other desktop")
    const [, other] = screen.getAllByRole("button", { name: en.personal.revokeSession })
    await userEvent.click(other)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("SESSION_NOT_FOUND"))
  })

  it("marks already-revoked sessions and falls back to the client id", async () => {
    handlers.personalSessions = () => [
      session({}),
      session({ id: 11, client_label: "", client_id: "cli-legacy", revoked_at: 1_700_000_500 }),
    ]
    renderSection("my-security")
    expect(await screen.findByText("cli-legacy")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.personal.revoked })).toBeDisabled()
  })

  it("dates a never-used session by when it was created", async () => {
    handlers.personalSessions = () => [
      session({ id: 12, client_label: "Fresh desktop", last_used_at: 0, created_at: 0 }),
    ]
    renderSection("my-security")
    const label = await screen.findByText("Fresh desktop")
    // Neither timestamp is known, so both read as a dash rather than 1970.
    expect(label.nextElementSibling).toHaveTextContent(/^— ·/)
  })

  it("says when there are no sessions", async () => {
    handlers.personalSessions = () => []
    renderSection("my-security")
    expect(await screen.findByText(en.personal.noSessions)).toBeInTheDocument()
  })

  it("shows a sessions failure with a retry", async () => {
    let fail = true
    handlers.personalSessions = () => {
      if (fail) throw new Error("sessions unavailable")
      return [session({})]
    }
    renderSection("my-security")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("sessions unavailable")
    fail = false
    await userEvent.click(within(alert).getByRole("button", { name: en.management.retry }))
    expect(await screen.findByText("This desktop")).toBeInTheDocument()
  })

  it("changes the password and then signs this desktop out locally", async () => {
    ;(forgetCredential as jest.Mock).mockResolvedValue({
      remoteRevoked: false,
      localDeleted: true,
      remoteError: null,
    })
    renderSection("my-security")
    await screen.findByText("Other desktop")
    await userEvent.type(
      screen.getByLabelText(en.personal.currentPassword, { selector: "#current-password" }),
      "old-pass"
    )
    await userEvent.type(screen.getByLabelText(en.personal.newPassword), "new-pass-123")
    ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
    await userEvent.click(screen.getByRole("button", { name: en.personal.changePassword }))

    await waitFor(() =>
      expect(operations("changePersonalPassword")).toEqual([
        {
          kind: "changePersonalPassword",
          body: { current_password: "old-pass", new_password: "new-pass-123" },
        },
      ])
    )
    await waitFor(() => expect(forgetCredential).toHaveBeenCalledWith(personalInstance.id, true))
    expect(toast.success).toHaveBeenCalledWith(en.personal.changePassword)
    expect(
      await screen.findByRole("button", { name: en.personal.browserOption })
    ).toBeInTheDocument()
    expect(screen.queryByText("Other desktop")).not.toBeInTheDocument()
  })

  it("still clears the cache when the local sign-out after a password change fails", async () => {
    ;(forgetCredential as jest.Mock).mockRejectedValue(new Error("keychain locked"))
    renderSection("my-security")
    await screen.findByText("Other desktop")
    await userEvent.click(screen.getByRole("button", { name: en.personal.changePassword }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("keychain locked"))
    // The cached readings were dropped and the credential re-read either way.
    await waitFor(() => expect(credentialState).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(operations("personalSessions")).toHaveLength(2))
  })

  it("reports a rejected password change without signing out", async () => {
    handlers.changePersonalPassword = () => {
      throw new Error("WRONG_PASSWORD")
    }
    renderSection("my-security")
    await screen.findByText("Other desktop")
    await userEvent.click(screen.getByRole("button", { name: en.personal.changePassword }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("WRONG_PASSWORD"))
    expect(forgetCredential).not.toHaveBeenCalled()
  })

  it("closes the account with a fresh operation id and signs out", async () => {
    ;(forgetCredential as jest.Mock).mockResolvedValue({
      remoteRevoked: false,
      localDeleted: true,
      remoteError: null,
    })
    renderSection("my-security")
    await screen.findByText("Other desktop")
    expect(screen.getByLabelText(en.personal.confirmUsername)).toHaveAttribute(
      "placeholder",
      "atlas-user"
    )
    await userEvent.type(
      screen.getByLabelText(en.personal.currentPassword, { selector: "#close-password" }),
      "pass-1"
    )
    await userEvent.type(screen.getByLabelText(en.personal.confirmUsername), "atlas-user")
    await userEvent.type(screen.getByLabelText(en.personal.closeReason), "moving on")
    await userEvent.click(screen.getByRole("button", { name: en.personal.closeAccount }))

    await waitFor(() => expect(operations("closePersonalAccount")).toHaveLength(1))
    const [call] = operations("closePersonalAccount") as unknown as Array<{
      body: Record<string, string>
    }>
    expect(call.body).toMatchObject({
      current_password: "pass-1",
      confirm_username: "atlas-user",
      reason: "moving on",
    })
    expect(call.body.operation_id).toEqual(expect.any(String))
    expect(call.body.operation_id).not.toBe("")
    await waitFor(() => expect(forgetCredential).toHaveBeenCalledWith(personalInstance.id, true))
    expect(toast.success).toHaveBeenCalledWith(en.personal.closeAccount)
  })

  it("reports a refused account closure", async () => {
    handlers.closePersonalAccount = () => {
      throw new Error("ACCOUNT_HAS_BALANCE")
    }
    renderSection("my-security")
    await screen.findByText("Other desktop")
    await userEvent.click(screen.getByRole("button", { name: en.personal.closeAccount }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("ACCOUNT_HAS_BALANCE"))
    expect(forgetCredential).not.toHaveBeenCalled()
  })

  it("explains disabled password and close actions and a balance that blocks closing", async () => {
    handlers.personalCapabilities = () =>
      capabilities({
        features: {
          profile_edit_enabled: true,
          password_change_enabled: false,
          account_close_enabled: false,
          billing_portal_enabled: true,
        },
      })
    handlers.personalOverview = () => {
      const base = overview()
      return { ...base, account: { ...base.account, master_id: 0 } }
    }
    renderSection("my-security")
    expect(await screen.findByText(en.personal.closeBlockedBalance)).toBeInTheDocument()
    expect(screen.getByText(en.personal.passwordChangeDisabled)).toBeInTheDocument()
    expect(screen.getByText(en.personal.accountCloseDisabled)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.personal.changePassword })).toBeDisabled()
    expect(screen.getByRole("button", { name: en.personal.closeAccount })).toBeDisabled()
  })

  it("locks every security write on a read-only connection", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([{ ...personalInstance, readOnly: true }])
    renderSection("my-security")
    await screen.findByText("Other desktop")
    expect(screen.getAllByText(en.management.readonlyBanner).length).toBeGreaterThanOrEqual(3)
    for (const button of screen.getAllByRole("button", { name: en.personal.revokeSession })) {
      expect(button).toBeDisabled()
    }
    expect(screen.getByRole("button", { name: en.personal.changePassword })).toBeDisabled()
    expect(screen.getByRole("button", { name: en.personal.closeAccount })).toBeDisabled()
  })
})
