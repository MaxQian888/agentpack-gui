import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import { credentialState, downloadCsv, listInstances } from "@/lib/more-token/client"
import type { UsageSeriesResult } from "@/lib/history/types"
import type { AlertEvent, AlertRule, AuditEvent } from "@/lib/more-token/types"
import {
  accountDetail,
  calls,
  capabilities,
  child,
  instance,
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

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(listInstances as jest.Mock).mockResolvedValue([instance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  serve()
})

/** The analytics filters are labelled by a sibling caption, not a `for`. */
function filterField(label: string) {
  return screen
    .getByText(label, { selector: "label" })
    .parentElement!.querySelector("input, select") as HTMLInputElement
}

describe("usage analytics", () => {
  it("sends the model, group, key, status and end filters to the server", async () => {
    renderSection("analytics")
    await screen.findByText("billing logs")

    await userEvent.type(filterField(m.model), "claude")
    await userEvent.type(filterField(m.group), "vip")
    await userEvent.type(filterField(m.apiKey), "ci")
    await userEvent.selectOptions(filterField(m.status), "all")
    fireEvent.change(filterField(m.to), { target: { value: "2026-09-02T18:00" } })

    const end = Math.floor(new Date(2026, 8, 2, 18, 0).getTime() / 1000)
    await waitFor(() =>
      expect(calls("analytics").at(-1)).toMatchObject({
        model: "claude",
        group: "vip",
        apiKey: "ci",
        status: "all",
        end,
      })
    )
    // A cleared end field is not a request for NaN.
    fireEvent.change(filterField(m.to), { target: { value: "" } })
    expect(calls("analytics").every((operation) => Number.isFinite(operation.end))).toBe(true)
  })

  it("exports the server series with its definition and timezone", async () => {
    ;(downloadCsv as jest.Mock).mockResolvedValue(null)
    renderSection("analytics")
    await screen.findByText("billing logs")
    await userEvent.click(screen.getByRole("button", { name: m.exportCsv }))

    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1))
    const [filename, rows] = (downloadCsv as jest.Mock).mock.calls[0]
    expect(filename).toBe("more-token-usage-primary-1700000100.csv")
    expect(rows).toEqual(
      expect.arrayContaining([
        [m.analyticsDefinition],
        [m.instance, "Primary"],
        [m.timezone, "Asia/Shanghai"],
        ["bucket", "rpm", "tpm", "quota"],
        [1_700_000_000, 4, 80, 150],
      ])
    )
    // A cancelled save dialog is not a saved file.
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows a failed analytics read with retry and nothing to export", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "analytics" && failures-- > 0
        ? Promise.reject(new Error("analytics offline"))
        : undefined
    )
    renderSection("analytics")

    const alert = (await screen.findByText("analytics offline")).closest(
      '[role="alert"]'
    ) as HTMLElement
    expect(screen.getByRole("button", { name: m.exportCsv })).toBeDisabled()
    expect(screen.getByText(m.analyticsDefinition)).toBeInTheDocument()
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))

    expect(await screen.findByText("billing logs")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.exportCsv })).toBeEnabled()
  })

  it("asks for the local estimate on demand and shows it while loading", async () => {
    const request = jest.fn()
    const { unmount } = renderSection("analytics", { data: null, loading: false, request })
    await screen.findByText("billing logs")
    const ask = screen.getAllByRole("button", { name: m.localEstimate })
    await userEvent.click(ask.at(-1)!)
    expect(request).toHaveBeenCalledTimes(1)
    unmount()

    renderSection("analytics", { data: null, loading: true, request })
    expect(await screen.findByRole("button", { name: m.loading })).toBeDisabled()
  })

  it("sums local tokens only inside the selected window", async () => {
    const now = Date.now()
    const usage = {
      sessions: [
        {
          id: "s1",
          source: "claude",
          projectName: "p",
          gitBranch: null,
          parentId: null,
          models: ["m"],
          tools: [],
          events: [
            [now - 1_000, 0, 100, 20, 3, 2, 0, null],
            // Sixty days ago is outside the default thirty-day window.
            [now - 60 * 86_400_000, 0, 9_999, 0, 0, 0, 0, null],
          ],
        },
      ],
      errors: [],
    } as unknown as UsageSeriesResult
    renderSection("analytics", { data: usage, loading: false, request: jest.fn() })

    const label = await screen.findByText(m.localTokens)
    expect(label.parentElement).toHaveTextContent("125")
  })
})

const auditEvent: AuditEvent = {
  id: 9,
  actor_id: 1,
  action: "account.disable",
  resource_type: "user",
  resource_id: "2",
  before: "",
  after: '{"status":2}',
  reason: "",
  request_id: "request-9",
  error_code: "FORBIDDEN",
  created_at: 1_700_000_300,
} as AuditEvent

const rule: AlertRule = {
  id: 1,
  owner_id: 1,
  name: "Low child balance",
  kind: "balance_below",
  threshold: 100,
  enabled: true,
  cooldown_sec: 3600,
  version: 4,
}

const openEvent: AlertEvent = {
  id: 8,
  rule_id: 1,
  owner_id: 1,
  account_id: 2,
  kind: "balance_below",
  message: "Child A is nearly depleted",
  observed_value: 80,
  acknowledged_at: 0,
  created_at: 1_700_000_200,
}

describe("audit timeline", () => {
  it("filters by action and shows a failed write's code and its change", async () => {
    serve((operation) =>
      operation.kind === "auditEvents" ? response(page([auditEvent])) : undefined
    )
    renderSection("audit")
    expect(await screen.findByText("account.disable")).toBeInTheDocument()
    expect(screen.getByText("FORBIDDEN")).toBeInTheDocument()
    expect(screen.getByText(`${m.before} / ${m.after}`)).toBeInTheDocument()
    expect(screen.getByText(/→/).textContent).toBe('—\n→\n{"status":2}')

    await userEvent.type(screen.getByPlaceholderText(m.auditActionFilter), "quota")
    await waitFor(() =>
      expect(calls("auditEvents").at(-1)).toMatchObject({ action: "quota", page: 1 })
    )
  })

  it("says there is nothing to show for an empty timeline", async () => {
    renderSection("audit")
    await screen.findByText(m.auditTimeline)
    // Timeline, rules and events are each empty and each say so.
    expect(await screen.findAllByText(m.noData)).toHaveLength(3)
  })

  it("retries the timeline, the rules and the events each from its own error", async () => {
    const failing = new Set(["auditEvents", "alertRules", "alertEvents"])
    serve((operation) =>
      failing.delete(operation.kind)
        ? Promise.reject(new Error(`${operation.kind} offline`))
        : undefined
    )
    renderSection("audit")

    for (const kind of ["auditEvents", "alertRules", "alertEvents"]) {
      const alert = (await screen.findByText(`${kind} offline`)).closest(
        '[role="alert"]'
      ) as HTMLElement
      await userEvent.click(within(alert).getByRole("button", { name: m.retry }))
      await waitFor(() => expect(screen.queryByText(`${kind} offline`)).not.toBeInTheDocument())
    }
  })
})

describe("alert rules", () => {
  beforeEach(() => {
    serve((operation) => (operation.kind === "alertRules" ? response(page([rule], 1)) : undefined))
  })

  it("searches rules on the server", async () => {
    renderSection("audit")
    await screen.findByText("Low child balance")
    await userEvent.type(screen.getByPlaceholderText(m.searchAlertRules), "low")
    await waitFor(() =>
      expect(calls("alertRules").at(-1)).toMatchObject({ search: "low", page: 1 })
    )
  })

  it("creates a rule enabled, with the default cooldown", async () => {
    renderSection("audit")
    await screen.findByText("Low child balance")
    await userEvent.click(screen.getByRole("button", { name: m.createRule }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: m.createRule })).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText(m.ruleName), "Budget watch")
    await userEvent.selectOptions(within(dialog).getByRole("combobox"), "monthly_budget")
    await userEvent.type(within(dialog).getByLabelText(m.threshold), "5000")
    await userEvent.click(within(dialog).getByRole("button", { name: m.save }))

    await waitFor(() => expect(calls("createAlertRule")).toHaveLength(1))
    expect(calls("createAlertRule")[0].body).toEqual({
      name: "Budget watch",
      kind: "monthly_budget",
      threshold: 5000,
      cooldown_sec: 3600,
      enabled: true,
      version: undefined,
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("keeps the rule dialog open on a refused save, and Cancel closes it", async () => {
    serve((operation) =>
      operation.kind === "alertRules"
        ? response(page([rule], 1))
        : operation.kind === "createAlertRule"
          ? Promise.reject(new Error("RULE_LIMIT"))
          : undefined
    )
    renderSection("audit")
    await screen.findByText("Low child balance")
    await userEvent.click(screen.getByRole("button", { name: m.createRule }))
    const dialog = await screen.findByRole("dialog")
    await userEvent.type(within(dialog).getByLabelText(m.ruleName), "Budget watch")
    await userEvent.type(within(dialog).getByLabelText(m.threshold), "1")
    await userEvent.click(within(dialog).getByRole("button", { name: m.save }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("RULE_LIMIT"))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("button", { name: m.cancel }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("switches a rule off from its row, and reports a refused switch", async () => {
    let refuse = false
    serve((operation) =>
      operation.kind === "alertRules"
        ? response(page([rule], 1))
        : operation.kind === "updateAlertRule" && refuse
          ? Promise.reject(new Error("RULE_LOCKED"))
          : undefined
    )
    renderSection("audit")
    const toggle = await screen.findByRole("switch", { name: `Low child balance: ${m.active}` })
    await userEvent.click(toggle)

    await waitFor(() => expect(calls("updateAlertRule")).toHaveLength(1))
    expect(calls("updateAlertRule")[0]).toMatchObject({
      id: 1,
      body: { enabled: false, version: 4, threshold: 100 },
    })

    refuse = true
    await waitFor(() => expect(toggle).toBeEnabled())
    await userEvent.click(toggle)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("RULE_LOCKED"))
  })

  it("reports a refused delete", async () => {
    serve((operation) =>
      operation.kind === "alertRules"
        ? response(page([rule], 1))
        : operation.kind === "deleteAlertRule"
          ? Promise.reject(new Error("RULE_IN_USE"))
          : undefined
    )
    renderSection("audit")
    await userEvent.click(
      await screen.findByRole("button", { name: `${m.delete}: Low child balance` })
    )
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: m.delete })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("RULE_IN_USE"))
  })

  it("keeps rule writes off on a read-only instance", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([{ ...instance, readOnly: true }])
    renderSection("audit")
    await screen.findByText("Low child balance")
    expect(screen.getByRole("button", { name: m.createRule })).toBeDisabled()
    expect(screen.getByRole("switch", { name: `Low child balance: ${m.active}` })).toBeDisabled()
    expect(screen.getByRole("button", { name: `${m.delete}: Low child balance` })).toBeDisabled()
  })
})

describe("alert events", () => {
  it("acknowledges an open event and re-reads the event list", async () => {
    serve((operation) =>
      operation.kind === "alertEvents"
        ? response(
            page([
              openEvent,
              {
                ...openEvent,
                id: 9,
                account_id: 0,
                acknowledged_at: 1_700_000_900,
                message: "Old",
              },
            ])
          )
        : undefined
    )
    renderSection("audit")
    await screen.findByText("Child A is nearly depleted")
    expect(screen.getByText(m.acknowledged)).toBeInTheDocument()
    // Only the event tied to an account offers to open one.
    expect(screen.getAllByRole("button", { name: /View account/ })).toHaveLength(1)
    const before = calls("alertEvents").length

    await userEvent.click(screen.getByRole("button", { name: m.acknowledge }))
    await waitFor(() =>
      expect(calls("acknowledgeAlert")).toEqual([{ kind: "acknowledgeAlert", id: 8 }])
    )
    await waitFor(() => expect(calls("alertEvents").length).toBeGreaterThan(before))
  })

  it("opens the event's account, retries a failed read and closes on Escape", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "alertEvents"
        ? response(page([openEvent]))
        : operation.kind === "account" && failures-- > 0
          ? Promise.reject(new Error("detail offline"))
          : undefined
    )
    renderSection("audit")
    await userEvent.click(await screen.findByRole("button", { name: m.viewAccount(2) }))
    const sheet = await screen.findByRole("dialog")

    await userEvent.click(
      within(await within(sheet).findByRole("alert")).getByRole("button", { name: m.retry })
    )
    expect(await within(sheet).findByText("child-a@example.com")).toBeInTheDocument()

    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("resends a pending invitation from the account sheet", async () => {
    serve(
      (operation) =>
        operation.kind === "alertEvents"
          ? response(page([openEvent]))
          : operation.kind === "account"
            ? response(accountDetail(child, { invitation_status: "pending" }))
            : undefined,
      { ...capabilities, features: { ...capabilities.features, account_invites_enabled: true } }
    )
    renderSection("audit")
    await userEvent.click(await screen.findByRole("button", { name: m.viewAccount(2) }))
    const sheet = await screen.findByRole("dialog")
    await userEvent.type(await within(sheet).findByLabelText(m.reason), "lost the email")
    const accountReads = calls("account").length

    await userEvent.click(within(sheet).getByRole("button", { name: m.resendInvitation }))

    await waitFor(() => expect(calls("resendAccountInvitation")).toHaveLength(1))
    expect(calls("resendAccountInvitation")[0]).toMatchObject({
      id: 2,
      body: { reason: "lost the email", preview_token: "preview-1" },
    })
    // Done re-reads the instance, the open account included.
    await waitFor(() => expect(calls("account").length).toBeGreaterThan(accountReads))
  })
})
