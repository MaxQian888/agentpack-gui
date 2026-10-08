import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import { notify } from "@/lib/tauri/system"
import {
  credentialState,
  forgetCredential,
  listInstances,
  managementRequest,
  pairInstance,
} from "@/lib/more-token/client"
import type { ManagementOperation } from "@/lib/more-token/types"
import {
  calls,
  defaultOperation,
  instance,
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
const second = { ...instance, id: "second", name: "Second", baseUrl: "https://second.example" }

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(listInstances as jest.Mock).mockResolvedValue([instance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  serve()
})

describe("connection states", () => {
  it("retries a failed instance discovery from its error panel", async () => {
    ;(listInstances as jest.Mock)
      .mockRejectedValueOnce(new Error("instance store offline"))
      .mockResolvedValue([instance])
    renderSection("management-overview")

    const alert = await screen.findByRole("alert")
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))

    expect(await screen.findByText(instance.baseUrl)).toBeInTheDocument()
    expect(listInstances).toHaveBeenCalledTimes(2)
  })

  it("opens a blank Add instance dialog from the empty state", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([])
    renderSection("management-overview")

    // The empty state's button is the only way in; the header copy is withheld.
    const buttons = await screen.findAllByRole("button", { name: m.addInstance })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: m.addInstance })).toBeInTheDocument()
  })

  it("shows a credential read failure and recovers on retry", async () => {
    ;(credentialState as jest.Mock)
      .mockRejectedValueOnce(new Error("vault locked"))
      .mockResolvedValue({ connected: true, persistent: true })
    renderSection("management-overview")

    const alert = (await screen.findAllByText("vault locked"))
      .map((node) => node.closest('[role="alert"]'))
      .find(Boolean) as HTMLElement
    // The health metric and the connection badge both stop claiming anything.
    expect(screen.getAllByText(m.unavailable).length).toBeGreaterThan(0)
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))

    expect(await screen.findByText(m.persistentCredential)).toBeInTheDocument()
    expect(credentialState).toHaveBeenCalledTimes(2)
  })

  it("shows a capabilities failure and re-reads capabilities on retry", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "capabilities" && failures-- > 0
        ? Promise.reject(new Error("capabilities offline"))
        : undefined
    )
    renderSection("management-overview")

    const alert = (await screen.findByText("capabilities offline")).closest(
      '[role="alert"]'
    ) as HTMLElement
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))

    expect(await screen.findByText(m.topology)).toBeInTheDocument()
    expect(calls("capabilities")).toHaveLength(2)
  })

  it("says a credential lives only in memory when the vault is unavailable", async () => {
    ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: false })
    renderSection("management-overview")
    expect(await screen.findByText(m.memoryCredential)).toBeInTheDocument()
  })

  it("reports a refused pairing code instead of pairing", async () => {
    ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })
    ;(pairInstance as jest.Mock).mockRejectedValue(new Error("PAIRING_CODE_EXPIRED"))
    renderSection("management-overview")

    await userEvent.type(await screen.findByPlaceholderText("ABCDE-FGHIJ"), "ABCDEFGHJK")
    await userEvent.click(screen.getByRole("button", { name: m.pair }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("PAIRING_CODE_EXPIRED"))
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText("ABCDE-FGHIJ")).toBeInTheDocument()
  })
})

describe("header and connection tile", () => {
  it("re-reads the active instance from the header refresh button", async () => {
    renderSection("management-overview")
    await screen.findByText(m.topology)
    await waitFor(() => expect(calls("capabilities")).toHaveLength(1))

    // The icon button carries the Retry label; the panels on screen have none.
    await userEvent.click(screen.getByRole("button", { name: m.retry }))

    await waitFor(() => expect(calls("capabilities")).toHaveLength(2))
  })

  it("switches the connection to the instance picked in the selector", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([instance, second])
    renderSection("management-overview")
    await screen.findByText(instance.baseUrl)

    await userEvent.selectOptions(screen.getByLabelText(m.instance), "second")

    expect(await screen.findByText(second.baseUrl)).toBeInTheDocument()
    expect(credentialState).toHaveBeenCalledWith("second")
  })

  it("forgets the credential and falls back to pairing", async () => {
    ;(forgetCredential as jest.Mock).mockResolvedValue({
      remoteRevoked: true,
      localDeleted: true,
      remoteError: null,
    })
    renderSection("management-overview")
    await screen.findByText(m.persistentCredential)
    ;(credentialState as jest.Mock).mockResolvedValue({ connected: false, persistent: false })

    await userEvent.click(screen.getByRole("button", { name: m.disconnect }))

    expect(await screen.findByPlaceholderText("ABCDE-FGHIJ")).toBeInTheDocument()
    expect(forgetCredential).toHaveBeenCalledWith(instance.id)
  })

  it("toasts a local delete that also fails, and stays connected", async () => {
    ;(forgetCredential as jest.Mock)
      .mockRejectedValueOnce(new Error("REMOTE_REVOKE_FAILED"))
      .mockRejectedValueOnce(new Error("vault write failed"))
    renderSection("management-overview")
    await screen.findByText(m.persistentCredential)

    await userEvent.click(screen.getByRole("button", { name: m.disconnect }))
    const confirm = await screen.findByRole("alertdialog")
    await userEvent.click(within(confirm).getByRole("button", { name: m.deleteLocalCopy }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("vault write failed"))
    expect(forgetCredential).toHaveBeenLastCalledWith(instance.id, true)
    expect(screen.getByText(m.persistentCredential)).toBeInTheDocument()
  })
})

describe("desktop notifications", () => {
  it("delivers each outbox item once, with its message or the generic title", async () => {
    serve((operation) =>
      operation.kind === "notifications"
        ? response([
            { id: 5, payload: JSON.stringify({ message: "Child A is nearly depleted" }) },
            { id: 6, payload: "not json" },
            { id: 7, payload: "{}" },
          ])
        : undefined
    )
    renderSection("management-overview")

    await waitFor(() => expect(notify).toHaveBeenCalledTimes(3))
    expect(notify).toHaveBeenNthCalledWith(1, m.title, "Child A is nearly depleted")
    expect(notify).toHaveBeenNthCalledWith(2, m.title, m.pendingAlerts)
    expect(notify).toHaveBeenNthCalledWith(3, m.title, m.pendingAlerts)
    expect(calls("acknowledgeNotification").map((operation) => operation.id)).toEqual([5, 6, 7])
  })

  it("keeps delivered ids per instance, since each server numbers its own outbox", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([instance, second])
    ;(managementRequest as jest.Mock).mockImplementation(
      (id: string, operation: ManagementOperation) =>
        operation.kind === "notifications"
          ? response([{ id: 1, payload: JSON.stringify({ message: `alert from ${id}` }) }])
          : defaultOperation(operation)
    )
    renderSection("management-overview")
    await waitFor(() => expect(notify).toHaveBeenCalledWith(m.title, `alert from ${instance.id}`))

    await userEvent.selectOptions(screen.getByLabelText(m.instance), "second")

    await waitFor(() => expect(notify).toHaveBeenCalledWith(m.title, "alert from second"))
    const acks = (managementRequest as jest.Mock).mock.calls
      .filter(([, operation]) => operation.kind === "acknowledgeNotification")
      .map(([id, operation]) => `${id}:${operation.id}`)
    expect(acks).toEqual([`${instance.id}:1`, "second:1"])
  })
})

describe("operations overview", () => {
  it("keeps a failed instance apart instead of combining its totals", async () => {
    ;(listInstances as jest.Mock).mockResolvedValue([instance, second])
    ;(managementRequest as jest.Mock).mockImplementation(
      (id: string, operation: ManagementOperation) =>
        id === "second" && operation.kind === "overview"
          ? Promise.reject(new Error("second offline"))
          : defaultOperation(operation)
    )
    renderSection("management-overview")

    expect(await screen.findByText(m.partial)).toBeInTheDocument()
    expect(screen.getByText(`1 / 2 ${m.unavailable.toLowerCase()}`)).toBeInTheDocument()
    expect(screen.getByText("second offline")).toBeInTheDocument()
    // The healthy instance still shows its own figures.
    expect(screen.getByText("1,080")).toBeInTheDocument()
  })

  it("shows a failed topology read as an error with retry", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "accounts" && failures-- > 0
        ? Promise.reject(new Error("accounts offline"))
        : undefined
    )
    renderSection("management-overview")

    const alert = (await screen.findByText("accounts offline")).closest(
      '[role="alert"]'
    ) as HTMLElement
    // The risk panel can't be computed from nothing either.
    expect(screen.getAllByText(m.unavailable).length).toBeGreaterThan(0)
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))

    expect(await screen.findByText("master-a")).toBeInTheDocument()
    expect(screen.queryByText("accounts offline")).not.toBeInTheDocument()
  })

  it("shows a failed alert read as an error with retry, and no alerts as no data", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "alertEvents" && failures-- > 0
        ? Promise.reject(new Error("alerts offline"))
        : undefined
    )
    renderSection("management-overview")

    const alert = (await screen.findByText("alerts offline")).closest(
      '[role="alert"]'
    ) as HTMLElement
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))

    await waitFor(() => expect(screen.queryByText("alerts offline")).not.toBeInTheDocument())
    expect(screen.getByText(m.noData)).toBeInTheDocument()
  })

  it("says so when no account is a master", async () => {
    serve((operation) =>
      operation.kind === "accounts"
        ? response({ items: [], page: 1, page_size: 200, total: 0 })
        : undefined
    )
    renderSection("management-overview")
    await screen.findByText(m.topology)
    expect(await screen.findAllByText(m.noData)).toHaveLength(2)
  })
})
