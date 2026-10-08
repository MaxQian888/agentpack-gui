import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import { credentialState, listInstances, ManagementApiError } from "@/lib/more-token/client"
import { authorizeManagementPreview, StepUpError } from "@/lib/more-token/step-up"
import type { QuotaTransaction } from "@/lib/more-token/types"
import {
  calls,
  capabilities,
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

function approvalThatWaits() {
  ;(authorizeManagementPreview as jest.Mock).mockImplementation(
    (_id: string, _token: string, options: { signal: AbortSignal; onWaiting?: () => void }) =>
      new Promise((_resolve, reject) => {
        options.onWaiting?.()
        options.signal.addEventListener("abort", () => reject(new StepUpError("cancelled")))
      })
  )
}

const transfer: QuotaTransaction = {
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
  reason: "rebalance",
  request_id: "request-7",
  created_at: 1_700_000_000,
}
const reversal: QuotaTransaction = { ...transfer, id: 8, type: "reversal", source_id: 0 }

const reverseScopes = { ...capabilities, scopes: [...capabilities.scopes, "quota:reverse"] }
const policyScopes = { ...capabilities, scopes: [...capabilities.scopes, "policy:write"] }

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(listInstances as jest.Mock).mockResolvedValue([instance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  ;(authorizeManagementPreview as jest.Mock).mockImplementation(() => Promise.resolve())
  serve()
})

async function openQuota() {
  renderSection("quota")
  await screen.findByText(m.ledger)
}

async function policySection() {
  const heading = await screen.findByRole("heading", { name: m.policies })
  return heading.closest("section") as HTMLElement
}

describe("quota center reads", () => {
  it("retries the summary, the ledger and the policy each from its own error", async () => {
    const failing = new Set(["quotaSummary", "quotaTransactions", "quotaPolicy"])
    serve((operation) =>
      failing.delete(operation.kind)
        ? Promise.reject(new Error(`${operation.kind} offline`))
        : undefined
    )
    await openQuota()

    for (const kind of ["quotaSummary", "quotaTransactions", "quotaPolicy"]) {
      const alert = (await screen.findByText(`${kind} offline`)).closest(
        '[role="alert"]'
      ) as HTMLElement
      await userEvent.click(within(alert).getByRole("button", { name: m.retry }))
      await waitFor(() => expect(screen.queryByText(`${kind} offline`)).not.toBeInTheDocument())
    }
    expect(screen.getByText(m.quotaTotal)).toBeInTheDocument()
    expect(within(await policySection()).getByLabelText(m.minimumReserve)).toHaveValue(100)
  })

  it("names the missing transfer scope, which no banner otherwise states", async () => {
    serve(undefined, { ...capabilities, scopes: ["quota:read"] })
    await openQuota()
    expect(screen.getByText(m.transferScopeDenied)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.transfer })).toBeDisabled()
    expect(screen.getByRole("button", { name: m.batchTransfer })).toBeDisabled()
  })

  it("warns when the display exchange rate has expired", async () => {
    serve(undefined, {
      ...capabilities,
      quota_display: { ...capabilities.quota_display, rate_valid_until: 1 },
    })
    await openQuota()
    expect(screen.getByText(m.exchangeRateExpired)).toBeInTheDocument()
    expect(screen.getByText(m.exchangeRateExpiredHint)).toBeInTheDocument()
  })

  it("filters the ledger by type and pages through it", async () => {
    serve((operation) =>
      operation.kind === "quotaTransactions" ? response(page([transfer], 60)) : undefined
    )
    await openQuota()
    await screen.findByText("rebalance")
    expect(screen.getByText("60 · 1/3")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: m.nextPage }))
    await waitFor(() => expect(calls("quotaTransactions").at(-1)).toMatchObject({ page: 2 }))
    expect(await screen.findByText("60 · 2/3")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: m.previousPage }))
    await waitFor(() => expect(calls("quotaTransactions").at(-1)).toMatchObject({ page: 1 }))

    await userEvent.click(screen.getByRole("button", { name: m.nextPage }))
    await userEvent.selectOptions(screen.getByLabelText(m.transactionType), "reversal")
    await waitFor(() =>
      expect(calls("quotaTransactions").at(-1)).toMatchObject({
        page: 1,
        transactionType: "reversal",
      })
    )
  })

  it("shows an empty ledger as no data with nothing to export", async () => {
    await openQuota()
    expect(await screen.findByText(m.noData)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.exportLedgerPage })).toBeDisabled()
  })
})

describe("ledger reversal", () => {
  beforeEach(() => {
    serve(
      (operation) =>
        operation.kind === "quotaTransactions" ? response(page([transfer, reversal])) : undefined,
      reverseScopes
    )
  })

  it("says which accounts a reversal moves quota between before asking the browser", async () => {
    await openQuota()
    // A reversal can't itself be reversed.
    const [reverse] = await screen.findAllByRole("button", { name: m.reverse })
    expect(screen.getAllByRole("button", { name: m.reverse })).toHaveLength(1)

    await userEvent.click(reverse)
    let confirm = await screen.findByRole("alertdialog")
    expect(confirm).toHaveTextContent(m.reverseTitle(7))
    expect(confirm).toHaveTextContent("from #2 back to #1")
    await userEvent.click(within(confirm).getByRole("button", { name: m.cancel }))
    expect(calls("actionPreview")).toHaveLength(0)

    await userEvent.click(screen.getByRole("button", { name: m.reverse }))
    confirm = await screen.findByRole("alertdialog")
    await userEvent.click(within(confirm).getByRole("button", { name: m.reverse }))

    await waitFor(() => expect(calls("reverseQuota")).toHaveLength(1))
    expect(calls("actionPreview")[0]).toMatchObject({
      body: { action: "quota_reverse", payload: { source_id: 2, target_id: 1, transaction_id: 7 } },
    })
    expect(calls("reverseQuota")[0]).toMatchObject({
      id: 7,
      body: { reason: m.reverseReason(7), preview_token: "preview-1" },
    })
  })

  it("reports a refused reversal", async () => {
    serve(
      (operation) =>
        operation.kind === "quotaTransactions"
          ? response(page([transfer]))
          : operation.kind === "reverseQuota"
            ? Promise.reject(new ManagementApiError("ALREADY_REVERSED", "done"))
            : undefined,
      reverseScopes
    )
    await openQuota()
    await userEvent.click(await screen.findByRole("button", { name: m.reverse }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: m.reverse })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("ALREADY_REVERSED: done"))
  })

  it("lets the row cancel a waiting approval without reporting a failure", async () => {
    approvalThatWaits()
    await openQuota()
    await userEvent.click(await screen.findByRole("button", { name: m.reverse }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: m.reverse })
    )

    expect(await screen.findByRole("button", { name: m.waitingForBrowser })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: m.cancelApproval }))

    expect(await screen.findByRole("button", { name: m.reverse })).toBeEnabled()
    expect(calls("reverseQuota")).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("disables reversal on a read-only instance", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([{ ...instance, readOnly: true }])
    await openQuota()
    expect(await screen.findByRole("button", { name: m.reverse })).toBeDisabled()
  })
})

async function openTransfer() {
  await userEvent.click(screen.getByRole("button", { name: m.transfer }))
  const dialog = await screen.findByRole("dialog")
  await userEvent.type(within(dialog).getByLabelText(m.sourceId), "1")
  await userEvent.type(within(dialog).getByLabelText(m.targetId), "2")
  await userEvent.type(within(dialog).getByLabelText(m.amount), "10")
  await userEvent.type(within(dialog).getByLabelText(m.reason), "rebalance")
  return dialog
}

describe("transfer dialog", () => {
  it("tells an admin whether adjustment is granted", async () => {
    serve(undefined, { ...capabilities, scopes: [...capabilities.scopes, "quota:adjust"] })
    await openQuota()
    await userEvent.click(screen.getByRole("button", { name: m.transfer }))
    expect(await screen.findByRole("dialog")).toHaveTextContent(`${m.adjustment}: ${m.active}`)
  })

  it("says nothing about adjustment to a master", async () => {
    serve(undefined, { ...capabilities, role: "master" })
    await openQuota()
    await userEvent.click(screen.getByRole("button", { name: m.transfer }))
    expect(await screen.findByRole("dialog")).not.toHaveTextContent(m.adjustment)
  })

  it("reports a refused preview and a refused commit", async () => {
    let previewFails = true
    serve((operation) =>
      operation.kind === "actionPreview" && previewFails
        ? Promise.reject(new Error("LIMIT_EXCEEDED"))
        : operation.kind === "quotaTransfer"
          ? Promise.reject(new Error("INSUFFICIENT_QUOTA"))
          : undefined
    )
    await openQuota()
    const dialog = await openTransfer()
    expect(dialog).toHaveTextContent(`${m.adjustment}: ${m.noScopes}`)
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("LIMIT_EXCEEDED"))

    previewFails = false
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.confirm }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("INSUFFICIENT_QUOTA"))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("shows the browser wait and abandons it on Escape", async () => {
    approvalThatWaits()
    await openQuota()
    const dialog = await openTransfer()
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.confirm }))
    expect(await within(dialog).findByRole("button", { name: m.waitingForBrowser })).toBeDisabled()

    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(calls("quotaTransfer")).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe("batch transfer", () => {
  async function openBatch() {
    await userEvent.click(screen.getByRole("button", { name: m.batchTransfer }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "1,2,100,team, alpha\n\n1,3,50,trial" },
    })
    return dialog
  }

  it("previews, starts and then follows a batch until Done", async () => {
    serve((operation) =>
      operation.kind === "createQuotaBatch"
        ? response({ id: 5, status: "RUNNING" })
        : operation.kind === "quotaBatch"
          ? response({
              batch: { id: 5, status: "COMPLETED" },
              items: [
                { item_key: "1", status: "SUCCEEDED" },
                { item_key: "2", status: "FAILED", error_code: "LIMIT" },
              ],
            })
          : undefined
    )
    await openQuota()
    const dialog = await openBatch()
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: m.batchTransfer }),
      "best_effort"
    )
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    expect(await within(dialog).findByText(m.batchItemCount(2))).toBeInTheDocument()

    // Edit drops the preview; the next preview is what gets submitted.
    await userEvent.click(within(dialog).getByRole("button", { name: m.edit }))
    expect(within(dialog).queryByText(m.batchItemCount(2))).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.submitBatch }))

    expect(await within(dialog).findByText(`${m.batchProgress}: COMPLETED`)).toBeInTheDocument()
    expect(within(dialog).getByText(m.batchPartialFailure)).toBeInTheDocument()
    expect(within(dialog).getByText("FAILED · LIMIT")).toBeInTheDocument()
    expect(calls("createQuotaBatch")[0]).toMatchObject({
      body: {
        mode: "best_effort",
        preview_token: "preview-1",
        items: [
          { item_key: "1", source_id: 1, target_id: 2, amount: 100, reason: "team, alpha" },
          { item_key: "2", source_id: 1, target_id: 3, amount: 50, reason: "trial" },
        ],
      },
    })
    expect(calls("quotaBatch")[0]).toMatchObject({ id: 5 })

    await userEvent.click(within(dialog).getByRole("button", { name: m.done }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("shows a failed progress read with retry", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "createQuotaBatch"
        ? response({ id: 5, status: "RUNNING" })
        : operation.kind === "quotaBatch"
          ? failures-- > 0
            ? Promise.reject(new Error("batch offline"))
            : response({ batch: { id: 5, status: "RUNNING" }, items: [] })
          : undefined
    )
    await openQuota()
    const dialog = await openBatch()
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.submitBatch }))

    const alert = (await within(dialog).findByText("batch offline")).closest(
      '[role="alert"]'
    ) as HTMLElement
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))
    expect(await within(dialog).findByText(`${m.batchProgress}: RUNNING`)).toBeInTheDocument()
    expect(within(dialog).queryByText(m.batchPartialFailure)).not.toBeInTheDocument()
  })

  it("reports a refused preview and a refused start", async () => {
    let previewFails = true
    serve((operation) =>
      operation.kind === "actionPreview" && previewFails
        ? Promise.reject(new Error("BATCH_TOO_LARGE"))
        : operation.kind === "createQuotaBatch"
          ? Promise.reject(new Error("BATCH_REJECTED"))
          : undefined
    )
    await openQuota()
    const dialog = await openBatch()
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("BATCH_TOO_LARGE"))

    previewFails = false
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.submitBatch }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("BATCH_REJECTED"))
    expect(calls("actionPreview").at(-1)).toMatchObject({
      body: { action: "quota_batch", payload: { mode: "atomic" } },
    })
  })

  it("shows the browser wait and abandons it on Escape", async () => {
    approvalThatWaits()
    await openQuota()
    const dialog = await openBatch()
    await userEvent.click(within(dialog).getByRole("button", { name: m.preview }))
    await userEvent.click(await within(dialog).findByRole("button", { name: m.submitBatch }))
    expect(await within(dialog).findByRole("button", { name: m.waitingForBrowser })).toBeDisabled()

    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(calls("createQuotaBatch")).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe("automation policy", () => {
  it("saves the edited policy through a preview", async () => {
    serve(undefined, policyScopes)
    await openQuota()
    const section = await policySection()
    const reserve = within(section).getByLabelText(m.minimumReserve)
    await userEvent.clear(reserve)
    await userEvent.type(reserve, "250")
    await userEvent.type(within(section).getByLabelText(m.reason), "tighten")
    await userEvent.click(within(section).getByRole("switch", { name: m.disableOnExhaustion }))
    await userEvent.click(within(section).getByRole("button", { name: m.savePolicy }))

    await waitFor(() => expect(calls("updateQuotaPolicy")).toHaveLength(1))
    expect(calls("actionPreview")[0]).toMatchObject({
      body: { action: "quota_policy_update", payload: { account_id: 1, minimum_reserve: 250 } },
    })
    expect(calls("updateQuotaPolicy")[0]).toMatchObject({
      body: {
        minimum_reserve: 250,
        auto_refill_enabled: true,
        disable_on_exhaustion: true,
        reason: "tighten",
        preview_token: "preview-1",
        version: 1,
      },
    })
  })

  it("reports a refused save", async () => {
    serve(
      (operation) =>
        operation.kind === "updateQuotaPolicy"
          ? Promise.reject(new ManagementApiError("VERSION_CONFLICT", "stale policy"))
          : undefined,
      policyScopes
    )
    await openQuota()
    const section = await policySection()
    await userEvent.type(within(section).getByLabelText(m.reason), "tighten")
    await userEvent.click(within(section).getByRole("button", { name: m.savePolicy }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("VERSION_CONFLICT: stale policy"))
  })

  it("can cancel a waiting approval from the policy form", async () => {
    approvalThatWaits()
    serve(undefined, policyScopes)
    await openQuota()
    const section = await policySection()
    await userEvent.type(within(section).getByLabelText(m.reason), "tighten")
    await userEvent.click(within(section).getByRole("button", { name: m.savePolicy }))

    expect(await within(section).findByRole("button", { name: m.waitingForBrowser })).toBeDisabled()
    await userEvent.click(within(section).getByRole("button", { name: m.cancelApproval }))
    expect(await within(section).findByRole("button", { name: m.savePolicy })).toBeEnabled()
    expect(calls("updateQuotaPolicy")).toHaveLength(0)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("explains a missing policy scope and server-off automation", async () => {
    serve(undefined, {
      ...capabilities,
      features: { ...capabilities.features, quota_policy_automation_enabled: false },
    })
    await openQuota()
    const section = await policySection()
    expect(within(section).getByText(m.automationOff)).toBeInTheDocument()
    expect(within(section).getByText(m.policyWriteDenied)).toBeInTheDocument()
    expect(within(section).getByRole("button", { name: m.savePolicy })).toBeDisabled()
  })

  it("names read-only as the reason on a read-only instance", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([{ ...instance, readOnly: true }])
    serve(undefined, policyScopes)
    await openQuota()
    expect(within(await policySection()).getByText(m.readonlyBanner)).toBeInTheDocument()
    expect(within(await policySection()).getByRole("button", { name: m.savePolicy })).toBeDisabled()
  })
})
