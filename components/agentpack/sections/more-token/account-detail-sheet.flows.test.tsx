import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { managementRequest } from "@/lib/more-token/client"
import { authorizeManagementPreview, StepUpError } from "@/lib/more-token/step-up"
import type {
  Account,
  AccountDetail,
  ManagementCapabilities,
  ManagementOperation,
  MoreTokenInstance,
} from "@/lib/more-token/types"
import { AccountDetailSheet } from "./account-detail-sheet"

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock("@/lib/more-token/client", () => ({
  ...jest.requireActual("@/lib/more-token/client"),
  managementRequest: jest.fn(),
}))
jest.mock("@/lib/more-token/step-up", () => ({
  ...jest.requireActual("@/lib/more-token/step-up"),
  authorizeManagementPreview: jest.fn(),
}))

function child(overrides: Partial<Account>): Account {
  return {
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
    ...overrides,
  }
}

function detail(overrides: Partial<AccountDetail> = {}): AccountDetail {
  return {
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
    children_count: 2,
    created_at: 1_700_000_000,
    last_login_at: 1_700_000_500,
    group: "default",
    email: "master@example.com",
    must_change_password: false,
    active_billing_sessions: 0,
    parent: null,
    children: [
      child({}),
      child({ id: 3, username: "child-b", display_name: "", lifecycle_state: "archived" }),
    ],
    children_truncated: false,
    active_sessions: [],
    active_sessions_truncated: false,
    ...overrides,
  }
}

const capabilities: ManagementCapabilities = {
  management_api_version: 2,
  minimum_desktop_version: "0.16.0",
  role: "root",
  scopes: ["accounts:read", "accounts:write"],
  features: {
    management_api_enabled: true,
    personal_api_enabled: true,
    quota_transfer_enabled: true,
    quota_policy_automation_enabled: true,
    distribution_detail_enabled: true,
    step_up_required: true,
    account_invites_enabled: true,
    remote_revoke_enabled: true,
  },
  quota_display: {
    quota_per_unit: 500_000,
    display_currency: "",
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
  displayCurrency: null,
  package: "management",
}

function renderSheet(props: Partial<React.ComponentProps<typeof AccountDetailSheet>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const onDone = jest.fn()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AccountDetailSheet
          account={detail()}
          quotaDisplay={capabilities.quota_display}
          instance={instance}
          capabilities={capabilities}
          onDone={onDone}
          onOpenChange={jest.fn()}
          {...props}
        />
      </I18nProvider>
    </QueryClientProvider>
  )
  return { ...result, onDone, sheet: () => screen.getByRole("dialog") }
}

/** The value cell that follows a label in the detail list. */
function fact(label: string) {
  return within(screen.getByRole("dialog")).getByText(label).nextElementSibling
}

function requests(kind: ManagementOperation["kind"]) {
  return (managementRequest as jest.Mock).mock.calls
    .map((call) => call[1] as ManagementOperation)
    .filter((operation) => operation.kind === kind)
}

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.setItem("agentpack.lang", "en")
  ;(managementRequest as jest.Mock).mockImplementation(
    async (_id: string, operation: ManagementOperation) => ({
      success: true,
      data: operation.kind === "actionPreview" ? { preview_token: "preview-1" } : {},
      request_id: "r",
      server_time: 1,
    })
  )
  ;(authorizeManagementPreview as jest.Mock).mockResolvedValue(undefined)
})

describe("facts", () => {
  it("describes a master account with its children and no sessions", () => {
    renderSheet()
    expect(fact(en.management.role)).toHaveTextContent(en.management.master)
    expect(fact(en.management.relationship)).toHaveTextContent(en.management.childrenCount(2))
    expect(fact(en.management.accessStatus)).toHaveTextContent(en.management.enabled)
    expect(fact(en.management.credentialState)).toHaveTextContent(en.management.ready)
    expect(screen.getByText(`#3 · ${en.management.archived}`)).toBeInTheDocument()
    expect(screen.getByText(en.management.noActiveSessions)).toBeInTheDocument()
    expect(screen.queryByText(en.management.directParent)).not.toBeInTheDocument()
    expect(screen.queryByText(en.management.childrenTruncated)).not.toBeInTheDocument()
  })

  it("describes a child account, its parent and its live billing sessions", () => {
    renderSheet({
      account: detail({
        is_master: false,
        master_id: 7,
        role: 10,
        status: 2,
        lifecycle_state: "closing",
        group: "",
        email: "",
        last_login_at: 0,
        must_change_password: true,
        parent: child({ id: 7, username: "parent-p", display_name: "", quota: 5_000 }),
        children: [],
        children_truncated: true,
        active_billing_sessions: 1,
        active_sessions: [
          {
            id: 1,
            status: "reserved",
            funding_source: "parent-pool",
            reserved_quota: 250,
            lease_expires_at: 1_700_100_000,
            started_at: 1_700_000_000,
          },
        ],
        active_sessions_truncated: true,
      }),
    })
    expect(fact(en.management.role)).toHaveTextContent(en.management.admin)
    expect(fact(en.management.relationship)).toHaveTextContent(en.management.childOf(7))
    expect(fact(en.management.accessStatus)).toHaveTextContent(en.management.disabled)
    expect(fact(en.management.lifecycle)).toHaveTextContent(en.management.closing)
    expect(fact(en.management.group)).toHaveTextContent("—")
    expect(fact(en.management.email)).toHaveTextContent("—")
    expect(fact(en.management.lastLogin)).toHaveTextContent("—")
    expect(fact(en.management.credentialState)).toHaveTextContent(
      en.management.passwordChangeRequired
    )

    const parent = screen.getByText(en.management.directParent).closest("section")!
    expect(within(parent).getByText("parent-p")).toBeInTheDocument()
    expect(within(parent).getByText("#7")).toBeInTheDocument()

    expect(screen.getByText(en.management.noChildren)).toBeInTheDocument()
    expect(screen.getByText(en.management.childrenTruncated)).toBeInTheDocument()
    expect(screen.getByText("parent-pool")).toBeInTheDocument()
    expect(screen.getByText("reserved")).toBeInTheDocument()
    expect(screen.getByText(en.management.activeSessionsTruncated)).toBeInTheDocument()
  })

  it.each([
    [100, false, 0, en.management.root, en.management.independent],
    [1, false, 0, en.management.user, en.management.independent],
  ])("labels role %i as its rank", (role, isMaster, masterId, roleLabel, relation) => {
    renderSheet({
      account: detail({ role, is_master: isMaster, master_id: masterId, children: [] }),
    })
    expect(fact(en.management.role)).toHaveTextContent(roleLabel)
    expect(fact(en.management.relationship)).toHaveTextContent(relation)
  })

  it("names a parent by display name when it has one", () => {
    renderSheet({
      account: detail({
        master_id: 7,
        parent: child({ id: 7, username: "parent-p", display_name: "Parent Team" }),
      }),
    })
    expect(screen.getByText("Parent Team")).toBeInTheDocument()
  })

  it("falls back to the child list's length when the count is missing", () => {
    renderSheet({ account: detail({ children_count: undefined as unknown as number }) })
    expect(fact(en.management.relationship)).toHaveTextContent(en.management.childrenCount(2))
  })
})

describe("actions menu", () => {
  it("offers child navigation above the lifecycle actions and routes both", async () => {
    const onAction = jest.fn()
    const onViewChildren = jest.fn()
    const account = detail()
    renderSheet({ account, onAction, onViewChildren })

    await userEvent.click(
      screen.getByRole("button", { name: `${en.management.actions}: master-a` })
    )
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent)
    expect(items[0]).toBe(en.management.viewChildren)
    expect(items).toEqual(
      expect.arrayContaining([
        en.management.disable,
        en.management.archive,
        en.management.changePassword,
        en.management.close,
      ])
    )
    await userEvent.click(screen.getByRole("menuitem", { name: en.management.viewChildren }))
    expect(onViewChildren).toHaveBeenCalledWith(account)

    await userEvent.click(
      screen.getByRole("button", { name: `${en.management.actions}: master-a` })
    )
    await userEvent.click(screen.getByRole("menuitem", { name: en.management.changePassword }))
    expect(onAction).toHaveBeenCalledWith(account, "password")
  })

  it("draws no menu when a read-only account has nothing to offer", () => {
    renderSheet({ onAction: jest.fn(), readOnly: true, account: detail({ children: [] }) })
    expect(
      screen.queryByRole("button", { name: `${en.management.actions}: master-a` })
    ).not.toBeInTheDocument()
  })

  it("keeps child navigation available on a read-only connection", async () => {
    const onViewChildren = jest.fn()
    renderSheet({ onAction: jest.fn(), readOnly: true, onViewChildren })
    await userEvent.click(
      screen.getByRole("button", { name: `${en.management.actions}: master-a` })
    )
    expect(screen.getAllByRole("menuitem")).toHaveLength(1)
    await userEvent.click(screen.getByRole("menuitem", { name: en.management.viewChildren }))
    expect(onViewChildren).toHaveBeenCalled()
  })
})

describe("invitations", () => {
  const invited = () => detail({ invitation_status: "pending" })

  it("only offers invitation controls when invites are enabled and writable", () => {
    renderSheet({
      account: invited(),
      capabilities: { ...capabilities, scopes: ["accounts:read"] },
    })
    expect(
      screen.queryByRole("button", { name: en.management.resendInvitation })
    ).not.toBeInTheDocument()
    expect(fact(en.management.credentialState)).toHaveTextContent("pending")
  })

  it("needs a reason before either invitation action can run", async () => {
    renderSheet({ account: invited() })
    const resend = screen.getByRole("button", { name: en.management.resendInvitation })
    const revoke = screen.getByRole("button", { name: en.management.revokeInvitation })
    expect(resend).toBeDisabled()
    expect(revoke).toBeDisabled()
    await userEvent.type(screen.getByLabelText(en.management.reason), "   ")
    expect(resend).toBeDisabled()
    await userEvent.type(screen.getByLabelText(en.management.reason), "lost email")
    expect(resend).toBeEnabled()
    expect(revoke).toBeEnabled()
  })

  it("disables invitation writes on a read-only instance", async () => {
    renderSheet({ account: invited(), instance: { ...instance, readOnly: true } })
    await userEvent.type(screen.getByLabelText(en.management.reason), "lost email")
    expect(screen.getByRole("button", { name: en.management.resendInvitation })).toBeDisabled()
  })

  it("previews, approves in the browser, then resends with the preview token", async () => {
    const { onDone } = renderSheet({ account: invited() })
    await userEvent.type(screen.getByLabelText(en.management.reason), "  lost email  ")
    await userEvent.click(screen.getByRole("button", { name: en.management.resendInvitation }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [preview] = requests("actionPreview") as unknown as Array<{
      body: {
        action: string
        payload: { account_id: number; reason: string; operation_id: string }
      }
    }>
    expect(preview.body.action).toBe("invitation_resend")
    expect(preview.body.payload).toMatchObject({ account_id: 1, reason: "lost email" })
    expect(authorizeManagementPreview).toHaveBeenCalledWith(
      instance.id,
      "preview-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(requests("resendAccountInvitation")).toEqual([
      {
        kind: "resendAccountInvitation",
        id: 1,
        body: {
          operation_id: preview.body.payload.operation_id,
          reason: "lost email",
          preview_token: "preview-1",
        },
      },
    ])
    expect(screen.getByLabelText(en.management.reason)).toHaveValue("")
  })

  it("revokes through the same approval", async () => {
    const { onDone } = renderSheet({ account: invited() })
    await userEvent.type(screen.getByLabelText(en.management.reason), "left the team")
    await userEvent.click(screen.getByRole("button", { name: en.management.revokeInvitation }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(requests("actionPreview")[0]).toMatchObject({
      body: { action: "invitation_revoke" },
    })
    expect(requests("revokeAccountInvitation")).toHaveLength(1)
    expect(requests("resendAccountInvitation")).toHaveLength(0)
  })

  it("relabels the running action while the browser approval is pending and cancels quietly", async () => {
    ;(authorizeManagementPreview as jest.Mock).mockImplementation(
      (_id: string, _token: string, options: { signal: AbortSignal; onWaiting: () => void }) =>
        new Promise((_resolve, reject) => {
          options.onWaiting()
          options.signal.addEventListener("abort", () => reject(new StepUpError("cancelled")))
        })
    )
    const { onDone } = renderSheet({ account: invited() })
    await userEvent.type(screen.getByLabelText(en.management.reason), "lost email")
    await userEvent.click(screen.getByRole("button", { name: en.management.revokeInvitation }))

    expect(
      await screen.findByRole("button", { name: en.management.waitingForBrowser })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.management.resendInvitation })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: en.management.cancelApproval }))

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: en.management.cancelApproval })
      ).not.toBeInTheDocument()
    )
    expect(screen.getByRole("button", { name: en.management.revokeInvitation })).toBeEnabled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(requests("revokeAccountInvitation")).toHaveLength(0)
  })

  it("stops waiting for the approval when the sheet goes away", async () => {
    let signal: AbortSignal | undefined
    ;(authorizeManagementPreview as jest.Mock).mockImplementation(
      (_id: string, _token: string, options: { signal: AbortSignal; onWaiting: () => void }) =>
        new Promise((_resolve, reject) => {
          signal = options.signal
          options.onWaiting()
          options.signal.addEventListener("abort", () => reject(new StepUpError("cancelled")))
        })
    )
    const view = renderSheet({ account: invited() })
    await userEvent.type(screen.getByLabelText(en.management.reason), "lost email")
    await userEvent.click(screen.getByRole("button", { name: en.management.resendInvitation }))
    await screen.findByRole("button", { name: en.management.cancelApproval })
    expect(signal?.aborted).toBe(false)

    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("says the approval expired in words rather than as a code", async () => {
    ;(authorizeManagementPreview as jest.Mock).mockRejectedValue(new StepUpError("expired"))
    renderSheet({ account: invited() })
    await userEvent.type(screen.getByLabelText(en.management.reason), "lost email")
    await userEvent.click(screen.getByRole("button", { name: en.management.resendInvitation }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.management.stepUpExpired))
    expect(requests("resendAccountInvitation")).toHaveLength(0)
  })

  it("reports a refused preview and keeps the reason for another try", async () => {
    ;(managementRequest as jest.Mock).mockRejectedValue(new Error("INVITATION_ALREADY_ACCEPTED"))
    const { onDone } = renderSheet({ account: invited() })
    await userEvent.type(screen.getByLabelText(en.management.reason), "lost email")
    await userEvent.click(screen.getByRole("button", { name: en.management.resendInvitation }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("INVITATION_ALREADY_ACCEPTED"))
    expect(authorizeManagementPreview).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByLabelText(en.management.reason)).toHaveValue("lost email")
  })
})

describe("empty body", () => {
  it("shows a failure without a retry button when no retry is given", () => {
    renderSheet({ account: null, open: true, error: "plain failure" })
    expect(screen.getByText("plain failure")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: en.management.retry })).not.toBeInTheDocument()
  })

  it("stays closed with no account and no explicit open", () => {
    renderSheet({ account: null })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
