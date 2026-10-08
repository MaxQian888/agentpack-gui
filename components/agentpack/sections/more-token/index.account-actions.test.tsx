import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import { credentialState, listInstances, ManagementApiError } from "@/lib/more-token/client"
import { authorizeManagementPreview, StepUpError } from "@/lib/more-token/step-up"
import {
  accountDetail,
  calls,
  capabilities,
  child,
  instance,
  master,
  page,
  renderSection,
  response,
  serve,
} from "./__testing__/fixtures"

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}))
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
jest.mock("@/lib/more-token/step-up", () => ({
  ...jest.requireActual("@/lib/more-token/step-up"),
  authorizeManagementPreview: jest.fn(() => Promise.resolve()),
}))

const m = en.management

/** A browser approval that stays open until the app stops waiting for it. */
function approvalThatWaits() {
  ;(authorizeManagementPreview as jest.Mock).mockImplementation(
    (_id: string, _token: string, options: { signal: AbortSignal; onWaiting?: () => void }) =>
      new Promise((_resolve, reject) => {
        options.onWaiting?.()
        options.signal.addEventListener("abort", () => reject(new StepUpError("cancelled")))
      })
  )
}

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(listInstances as jest.Mock).mockResolvedValue([instance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  ;(authorizeManagementPreview as jest.Mock).mockImplementation(() => Promise.resolve())
  serve()
})

async function openAccounts() {
  renderSection("accounts")
  return screen.findByRole("table")
}

async function selectChild(table: HTMLElement) {
  await userEvent.click(within(table).getByRole("checkbox", { name: "child-a" }))
}

describe("bulk actions", () => {
  it("toasts an all-succeeded batch as success and clears the selection", async () => {
    serve((operation) =>
      operation.kind === "createAccountBatch" ? response({ succeeded: 1, failed: 0 }) : undefined
    )
    const table = await openAccounts()
    await selectChild(table)
    await userEvent.click(screen.getByRole("button", { name: m.batchEnable }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.bulkResult(1, 0)))
    expect(calls("createAccountBatch")[0]).toMatchObject({
      body: { action: "enable", account_ids: [2], preview_token: "preview-1" },
    })
    // Enabling is reversible and takes nothing out of the list: no confirm.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(await screen.findByText(m.accountsTotal(2))).toBeInTheDocument()
  })

  it("toasts a partly failed batch as a warning", async () => {
    serve((operation) =>
      operation.kind === "createAccountBatch" ? response({ succeeded: 1, failed: 1 }) : undefined
    )
    const table = await openAccounts()
    await userEvent.click(within(table).getByRole("checkbox", { name: m.all }))
    await userEvent.click(screen.getByRole("button", { name: m.batchDisable }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(m.bulkResult(1, 1)))
    expect(calls("createAccountBatch")[0]).toMatchObject({
      body: { action: "disable", account_ids: [1, 2] },
    })
  })

  it("reports a rejected batch, and clears a selection by hand", async () => {
    serve((operation) =>
      operation.kind === "createAccountBatch"
        ? Promise.reject(new ManagementApiError("FORBIDDEN", "not your account"))
        : undefined
    )
    const table = await openAccounts()
    await selectChild(table)
    await userEvent.click(screen.getByRole("button", { name: m.batchEnable }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("FORBIDDEN: not your account"))

    await userEvent.click(screen.getByRole("button", { name: m.clearSelection }))
    expect(screen.getByText(m.accountsTotal(2))).toBeInTheDocument()
  })

  it("relabels the batch while the browser approval is open and cancels it quietly", async () => {
    approvalThatWaits()
    const table = await openAccounts()
    await selectChild(table)
    await userEvent.click(screen.getByRole("button", { name: m.batchDisable }))

    expect(await screen.findByRole("button", { name: m.waitingForBrowser })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: m.cancelApproval }))

    expect(await screen.findByRole("button", { name: m.batchDisable })).toBeEnabled()
    expect(calls("createAccountBatch")).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

async function openAction(table: HTMLElement, username: string, action: string) {
  await userEvent.click(within(table).getByRole("button", { name: `${m.actions}: ${username}` }))
  await userEvent.click(await screen.findByRole("menuitem", { name: action }))
  return screen.findByRole("dialog")
}

describe("account lifecycle dialog", () => {
  it("previews an action against the server and commits the previewed payload", async () => {
    const table = await openAccounts()
    const dialog = await openAction(table, "child-a", m.disable)
    expect(within(dialog).getByRole("heading", { name: m.disable })).toBeInTheDocument()
    expect(dialog).toHaveTextContent("child-a · #2")

    await userEvent.type(within(dialog).getByLabelText(m.reason), "offboarding")
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    expect(await within(dialog).findByText(m.previewImpact)).toBeInTheDocument()
    expect(dialog).toHaveTextContent(`#2 · ${m.balance} 90 · v3`)
    expect(within(dialog).getByLabelText(m.reason)).toBeDisabled()
    expect(calls("actionPreview")[0]).toMatchObject({
      body: { action: "disable", payload: { account_id: 2, reason: "offboarding" } },
    })

    await userEvent.click(within(dialog).getByRole("button", { name: m.confirm }))
    await waitFor(() => expect(calls("accountAction")).toHaveLength(1))
    expect(calls("accountAction")[0]).toMatchObject({
      id: 2,
      action: "disable",
      body: { preview_token: "preview-1", reason: "offboarding" },
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("closes an account through its own endpoint, with the root-only write-off", async () => {
    serve(undefined, { ...capabilities, role: "root" })
    const table = await openAccounts()
    const dialog = await openAction(table, "child-a", m.close)

    await userEvent.type(within(dialog).getByLabelText(m.reason), "left the team")
    await userEvent.type(within(dialog).getByLabelText(m.balanceTarget), "1")
    await userEvent.click(within(dialog).getByRole("checkbox", { name: m.writeOff }))
    await userEvent.type(within(dialog).getByLabelText(m.confirmAccount), "child-a")
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.confirm }))

    await waitFor(() => expect(calls("closeAccount")).toHaveLength(1))
    expect(calls("closeAccount")[0]).toMatchObject({
      id: 2,
      body: { balance_target_id: 1, write_off: true, reason: "left the team" },
    })
    expect(calls("accountAction")).toHaveLength(0)
  })

  it("offers no write-off to an admin closing an account", async () => {
    const table = await openAccounts()
    const dialog = await openAction(table, "child-a", m.close)
    expect(within(dialog).getByLabelText(m.balanceTarget)).toBeInTheDocument()
    expect(within(dialog).queryByRole("checkbox", { name: m.writeOff })).not.toBeInTheDocument()
  })

  it("asks for a new password and for a master id where the action needs one", async () => {
    const solo = { ...master, id: 3, username: "solo-master", children_count: 0 }
    serve((operation) =>
      operation.kind === "accounts" ? response(page([master, child, solo])) : undefined
    )
    const table = await openAccounts()

    let dialog = await openAction(table, "child-a", m.changePassword)
    expect(within(dialog).getByLabelText(m.password)).toHaveAttribute("type", "password")
    await userEvent.click(within(dialog).getByRole("button", { name: m.cancel }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    dialog = await openAction(table, "solo-master", m.attach)
    await userEvent.type(within(dialog).getByLabelText(m.reason), "join team")
    await userEvent.type(within(dialog).getByLabelText(m.masterId), "1")
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await waitFor(() => expect(calls("actionPreview")).toHaveLength(1))
    expect(calls("actionPreview")[0]).toMatchObject({
      body: { action: "attach", payload: { account_id: 3, master_id: 1 } },
    })
  })

  it("goes back to the form when the account changed after the preview", async () => {
    serve((operation) =>
      operation.kind === "accountAction"
        ? Promise.reject(new ManagementApiError("VERSION_CONFLICT", "stale"))
        : undefined
    )
    const table = await openAccounts()
    const dialog = await openAction(table, "child-a", m.disable)
    await userEvent.type(within(dialog).getByLabelText(m.reason), "offboarding")
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.confirm }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.versionConflict))
    expect(within(dialog).queryByText(m.previewImpact)).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText(m.reason)).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: m.preview })).toBeInTheDocument()
  })

  it("keeps the preview after any other refusal, and says nothing for a cancelled approval", async () => {
    let refusal: Error = new ManagementApiError("FORBIDDEN", "denied")
    serve((operation) => (operation.kind === "accountAction" ? Promise.reject(refusal) : undefined))
    const table = await openAccounts()
    const dialog = await openAction(table, "child-a", m.disable)
    await userEvent.type(within(dialog).getByLabelText(m.reason), "offboarding")
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.confirm }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("FORBIDDEN: denied"))
    expect(within(dialog).getByText(m.previewImpact)).toBeInTheDocument()

    refusal = new StepUpError("cancelled")
    ;(toast.error as jest.Mock).mockClear()
    ;(authorizeManagementPreview as jest.Mock).mockRejectedValueOnce(refusal)
    await userEvent.click(within(dialog).getByRole("button", { name: m.confirm }))
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: m.confirm })).toBeEnabled()
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("reports a refused preview and lets a preview be edited", async () => {
    let refuse = true
    serve((operation) =>
      operation.kind === "actionPreview" && refuse
        ? Promise.reject(new Error("PREVIEW_DENIED"))
        : undefined
    )
    const table = await openAccounts()
    const dialog = await openAction(table, "child-a", m.archive)
    await userEvent.type(within(dialog).getByLabelText(m.reason), "tidy")
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("PREVIEW_DENIED"))

    refuse = false
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.edit }))
    expect(within(dialog).getByLabelText(m.reason)).toBeEnabled()
    expect(within(dialog).getByLabelText(m.reason)).toHaveValue("tidy")
  })

  it("shows the browser wait on Confirm and drops everything on Escape", async () => {
    approvalThatWaits()
    const table = await openAccounts()
    const dialog = await openAction(table, "child-a", m.disable)
    await userEvent.type(within(dialog).getByLabelText(m.reason), "offboarding")
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.confirm }))

    expect(await within(dialog).findByRole("button", { name: m.waitingForBrowser })).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(calls("accountAction")).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()

    // The next opening starts clean.
    const next = await openAction(table, "child-a", m.disable)
    expect(within(next).queryByText(m.previewImpact)).not.toBeInTheDocument()
  })
})

describe("account detail sheet", () => {
  it("opens the lifecycle dialog from the sheet's own menu", async () => {
    const table = await openAccounts()
    await userEvent.click(within(table).getByRole("button", { name: /^child-a/ }))
    const sheet = await screen.findByRole("dialog")
    await within(sheet).findByText("child-a@example.com")

    await userEvent.click(within(sheet).getByRole("button", { name: `${m.actions}: child-a` }))
    await userEvent.click(await screen.findByRole("menuitem", { name: m.disable }))

    expect(await screen.findByRole("heading", { name: m.disable })).toBeInTheDocument()
  })

  it("walks into a master's children from the sheet and closes it", async () => {
    serve((operation) =>
      operation.kind === "account"
        ? response(accountDetail(master, { children: [child] }))
        : undefined
    )
    const table = await openAccounts()
    await userEvent.click(within(table).getByRole("button", { name: /^master-a/ }))
    const sheet = await screen.findByRole("dialog")
    await within(sheet).findByText("master-a@example.com")

    await userEvent.click(within(sheet).getByRole("button", { name: `${m.actions}: master-a` }))
    await userEvent.click(await screen.findByRole("menuitem", { name: m.viewChildren }))

    await waitFor(() => expect(screen.queryByText(m.accountDetail)).not.toBeInTheDocument())
    await waitFor(() => expect(calls("accounts").at(-1)).toMatchObject({ masterId: 1 }))
    expect(
      screen.getByRole("button", { name: m.removeFilter(m.childrenOf("master-a")) })
    ).toBeInTheDocument()
  })

  it("shows a failed detail read with retry, and closes on Escape", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "account" && failures-- > 0
        ? Promise.reject(new Error("detail offline"))
        : undefined
    )
    const table = await openAccounts()
    await userEvent.click(within(table).getByRole("button", { name: /^child-a/ }))
    const sheet = await screen.findByRole("dialog")

    expect(await within(sheet).findByText("detail offline")).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole("button", { name: m.retry }))
    expect(await within(sheet).findByText("child-a@example.com")).toBeInTheDocument()

    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})

describe("create account", () => {
  async function fillCreate() {
    await userEvent.click(screen.getByRole("button", { name: m.createAccount }))
    const dialog = await screen.findByRole("dialog")
    await userEvent.type(within(dialog).getByLabelText(m.username), "new-child")
    await userEvent.type(within(dialog).getByLabelText(m.masterId), "1")
    await userEvent.type(within(dialog).getByLabelText(m.initialQuota), "50")
    await userEvent.type(within(dialog).getByLabelText(m.reason), "provisioning")
    return dialog
  }

  it("closes at once when the server sends an invitation instead of a password", async () => {
    serve((operation) =>
      operation.kind === "createAccount" ? response({ credential_mode: "invitation" }) : undefined
    )
    await openAccounts()
    const dialog = await fillCreate()
    // Invitations are off on this server, and the checkbox says why.
    expect(within(dialog).getByText(m.invitesDisabled)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("button", { name: m.createAccount }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(calls("createAccount")[0]).toMatchObject({
      body: {
        username: "new-child",
        master_id: 1,
        initial_quota: 50,
        invite_by_email: false,
        preview_token: "preview-1",
      },
    })
  })

  it("reports a refused create and keeps the form open", async () => {
    serve((operation) =>
      operation.kind === "createAccount"
        ? Promise.reject(new ManagementApiError("USERNAME_TAKEN", "exists"))
        : undefined
    )
    await openAccounts()
    const dialog = await fillCreate()
    await userEvent.click(within(dialog).getByRole("button", { name: m.createAccount }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("USERNAME_TAKEN: exists"))
    expect(within(dialog).getByLabelText(m.username)).toHaveValue("new-child")
  })

  it("relabels Create while the approval waits and cancels it on Cancel", async () => {
    approvalThatWaits()
    serve(undefined, {
      ...capabilities,
      features: { ...capabilities.features, account_invites_enabled: true },
    })
    await openAccounts()
    const dialog = await fillCreate()
    expect(within(dialog).queryByText(m.invitesDisabled)).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("checkbox", { name: m.sendInvitationEmail }))
    await userEvent.click(within(dialog).getByRole("button", { name: m.createAccount }))

    expect(await within(dialog).findByRole("button", { name: m.waitingForBrowser })).toBeDisabled()
    expect(calls("actionPreview")[0]).toMatchObject({
      body: { action: "create_account", payload: { invite_by_email: true } },
    })
    await userEvent.click(within(dialog).getByRole("button", { name: m.cancel }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(calls("createAccount")).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("closes on Escape", async () => {
    await openAccounts()
    await userEvent.click(screen.getByRole("button", { name: m.createAccount }))
    await screen.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})
