import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { en } from "@/lib/i18n/en"
import { isTauri } from "@/lib/tauri"
import { credentialState, downloadCsv, listInstances } from "@/lib/more-token/client"
import type { Account } from "@/lib/more-token/types"
import {
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

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(listInstances as jest.Mock).mockResolvedValue([instance])
  ;(credentialState as jest.Mock).mockResolvedValue({ connected: true, persistent: true })
  serve()
})

function lastAccountsCall() {
  return calls("accounts").at(-1)!
}

async function openAccounts() {
  renderSection("accounts")
  return screen.findByRole("table")
}

function chip(name: string) {
  return screen.getByRole("button", { name: m.removeFilter(name) })
}

describe("account filters", () => {
  it("debounces the search into a request and clears it from its chip", async () => {
    await openAccounts()
    await userEvent.type(screen.getByRole("textbox", { name: m.searchAccounts }), "  child ")

    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ search: "child", page: 1 }))
    await userEvent.click(chip(`${m.search}: child`))

    expect(screen.getByRole("textbox", { name: m.searchAccounts })).toHaveValue("")
    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ search: null }))
    expect(screen.queryByRole("button", { name: m.clearFilters })).not.toBeInTheDocument()
  })

  it("narrows by lifecycle and drops the narrowing from its chip", async () => {
    await openAccounts()
    await userEvent.selectOptions(screen.getByLabelText(m.lifecycle), "archived")

    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ lifecycleState: "archived" }))
    await userEvent.click(chip(`${m.lifecycle}: ${m.archived}`))

    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ lifecycleState: null }))
    expect(screen.getByLabelText(m.lifecycle)).toHaveValue("")
  })

  it("counts the popover's narrowing filters and clears each one from its own chip", async () => {
    await openAccounts()
    await userEvent.click(screen.getByRole("button", { name: m.filters }))
    await userEvent.selectOptions(await screen.findByLabelText(m.accessStatus), "disabled")
    await userEvent.selectOptions(screen.getByLabelText(m.relationship), "child")
    await userEvent.selectOptions(screen.getByLabelText(m.role), "admin")

    await waitFor(() =>
      expect(lastAccountsCall()).toMatchObject({
        accessStatus: "disabled",
        relation: "child",
        role: "admin",
      })
    )
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("button", { name: `${m.filters} 3` })).toBeInTheDocument()

    await userEvent.click(chip(`${m.accessStatus}: ${m.disabled}`))
    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ accessStatus: null }))
    await userEvent.click(chip(`${m.relationship}: ${m.child}`))
    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ relation: null }))
    await userEvent.click(chip(`${m.role}: ${m.admin}`))
    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ role: null }))
    expect(screen.getByRole("button", { name: m.filters })).toBeInTheDocument()
  })

  it("sorts from the popover's sort field and order", async () => {
    await openAccounts()
    await userEvent.click(screen.getByRole("button", { name: m.filters }))
    await userEvent.selectOptions(await screen.findByLabelText(m.sortAccounts), "last_login_at")
    await userEvent.selectOptions(screen.getByLabelText(m.sortOrder), "asc")

    await waitFor(() =>
      expect(lastAccountsCall()).toMatchObject({ sortBy: "last_login_at", sortOrder: "asc" })
    )
    // Sorting reorders the page; it narrows nothing, so it earns no chip.
    expect(screen.queryByRole("button", { name: m.clearFilters })).not.toBeInTheDocument()
  })

  it("offers Clear filters on an empty filtered page and resets every filter", async () => {
    serve((operation) =>
      operation.kind === "accounts" && operation.lifecycleState
        ? response(page<Account>([]))
        : undefined
    )
    await openAccounts()
    await userEvent.type(screen.getByRole("textbox", { name: m.searchAccounts }), "nobody")
    await userEvent.selectOptions(screen.getByLabelText(m.lifecycle), "closing")

    expect(await screen.findByText(m.noData)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: m.clearFilters })).toHaveLength(2)
    )
    await userEvent.click(screen.getAllByRole("button", { name: m.clearFilters })[1])

    expect(await screen.findByRole("table")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: m.searchAccounts })).toHaveValue("")
    expect(screen.getByLabelText(m.lifecycle)).toHaveValue("")
    await waitFor(() =>
      expect(lastAccountsCall()).toMatchObject({ search: null, lifecycleState: null })
    )
  })
})

describe("sorting, paging and scoping", () => {
  it("sorts by a column header and flips the order on a second click", async () => {
    const table = await openAccounts()
    const username = within(table).getByRole("button", { name: m.username })
    await userEvent.click(username)

    await waitFor(() =>
      expect(lastAccountsCall()).toMatchObject({ sortBy: "username", sortOrder: "asc" })
    )
    expect(username.closest("th")).toHaveAttribute("aria-sort", "ascending")

    await userEvent.click(username)
    await waitFor(() =>
      expect(lastAccountsCall()).toMatchObject({ sortBy: "username", sortOrder: "desc" })
    )
    expect(username.closest("th")).toHaveAttribute("aria-sort", "descending")

    // A balance sort starts with the largest balance.
    await userEvent.click(within(table).getByRole("button", { name: m.balance }))
    await waitFor(() =>
      expect(lastAccountsCall()).toMatchObject({ sortBy: "quota", sortOrder: "desc" })
    )
  })

  it("pages forward and back through the server's total", async () => {
    serve((operation) =>
      operation.kind === "accounts" ? response(page([master, child], 60)) : undefined
    )
    await openAccounts()
    expect(screen.getByText(m.pageSummary(1, 3))).toBeInTheDocument()
    const previous = screen.getAllByRole("button", { name: m.previousPage })
    expect(previous.at(-1)).toBeDisabled()

    await userEvent.click(screen.getAllByRole("button", { name: m.nextPage }).at(-1)!)
    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ page: 2 }))
    expect(screen.getByText(m.pageSummary(2, 3))).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole("button", { name: m.previousPage }).at(-1)!)
    await waitFor(() => expect(screen.getByText(m.pageSummary(1, 3))).toBeInTheDocument())
  })

  it("walks into a master's children from its relationship count", async () => {
    const table = await openAccounts()
    await userEvent.click(within(table).getByRole("button", { name: m.childrenCount(1) }))

    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ masterId: 1, page: 1 }))
    // The scope names the master, not a field.
    await userEvent.click(chip(m.childrenOf("master-a")))
    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ masterId: null }))
  })

  it("draws the tree from this page and opens an account from a node", async () => {
    await openAccounts()
    await userEvent.click(screen.getByRole("button", { name: m.treeView }))

    expect(await screen.findByText(m.treeScope)).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /child-a/ }))

    expect(await screen.findByText(m.accountDetail)).toBeInTheDocument()
    await waitFor(() => expect(calls("account").at(-1)).toMatchObject({ id: 2 }))

    await userEvent.keyboard("{Escape}")
    await userEvent.click(screen.getByRole("button", { name: m.tableView }))
    expect(await screen.findByRole("table")).toBeInTheDocument()
  })

  it("caps a master's drawn children and leaves the tree for the rest", async () => {
    const many = Array.from({ length: 13 }, (_, index) => ({
      ...child,
      id: 100 + index,
      username: `kid-${index}`,
    }))
    serve((operation) =>
      operation.kind === "accounts"
        ? response(page([{ ...master, children_count: 13 }, ...many]))
        : undefined
    )
    await openAccounts()
    await userEvent.click(screen.getByRole("button", { name: m.treeView }))

    expect(await screen.findByRole("button", { name: /kid-11/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /kid-12/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: m.moreChildren(1) }))

    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ masterId: 1 }))
    // Scoping to one master returns to the table, where the scope is a chip.
    expect(await screen.findByRole("table")).toBeInTheDocument()
    expect(chip(m.childrenOf("master-a"))).toBeInTheDocument()
  })
})

describe("account rows", () => {
  it("retries a failed account page from its error panel", async () => {
    let failures = 1
    serve((operation) =>
      operation.kind === "accounts" && failures-- > 0
        ? Promise.reject(new Error("accounts offline"))
        : undefined
    )
    renderSection("accounts")
    const alert = (await screen.findByText("accounts offline")).closest(
      '[role="alert"]'
    ) as HTMLElement
    await userEvent.click(within(alert).getByRole("button", { name: m.retry }))

    expect(await screen.findByRole("table")).toBeInTheDocument()
    expect(screen.queryByText("accounts offline")).not.toBeInTheDocument()
  })

  it("reads lifecycle, access and role as single words", async () => {
    const rows: Account[] = [
      { ...master, id: 10, username: "root-user", role: 100, display_name: "" },
      { ...master, id: 11, username: "admin-user", role: 10 },
      { ...child, id: 12, username: "archived-user", lifecycle_state: "archived" },
      { ...child, id: 13, username: "closing-user", lifecycle_state: "closing" },
      { ...child, id: 14, username: "disabled-user", status: 2, lifecycle_state: "" },
      { ...child, id: 15, username: "solo-user", master_id: 0 },
    ]
    serve((operation) => (operation.kind === "accounts" ? response(page(rows)) : undefined))
    const table = await openAccounts()

    const row = (name: string) =>
      within(table)
        .getByRole("button", { name: new RegExp(`^${name}`) })
        .closest("tr") as HTMLElement
    expect(within(row("root-user")).getByText(m.root)).toBeInTheDocument()
    expect(within(row("root-user")).getByText("#10")).toBeInTheDocument()
    expect(within(row("admin-user")).getByText(m.admin)).toBeInTheDocument()
    expect(within(row("archived-user")).getByText(m.archived)).toBeInTheDocument()
    expect(within(row("closing-user")).getByText(m.closing)).toBeInTheDocument()
    expect(within(row("disabled-user")).getByText(m.disabled)).toBeInTheDocument()
    expect(within(row("solo-user")).getByText(m.independent)).toBeInTheDocument()
    expect(within(row("solo-user")).getByText(m.user)).toBeInTheDocument()
  })

  it("explains a connection without the account write scope", async () => {
    serve(undefined, { ...capabilities, scopes: ["accounts:read"] })
    await openAccounts()
    expect(screen.getByText(m.writeDenied)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.createAccount })).toBeDisabled()
    expect(screen.getByRole("button", { name: m.createAccount })).toHaveAttribute(
      "title",
      m.writeDenied
    )
  })

  it("exports the page and says where the file went, or why it didn't save", async () => {
    ;(downloadCsv as jest.Mock)
      .mockResolvedValueOnce({ kind: "saved", path: "/tmp/accounts.csv" })
      .mockRejectedValueOnce(new Error("disk full"))
    await openAccounts()
    const exportButton = screen.getByRole("button", { name: m.exportAccounts })

    await userEvent.click(exportButton)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.csvSaved("/tmp/accounts.csv")))
    expect(downloadCsv).toHaveBeenCalledWith(
      "more-token-accounts-primary-1.csv",
      expect.arrayContaining([expect.arrayContaining(["master-a"])])
    )

    await userEvent.click(exportButton)
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.csvSaveFailed("disk full")))
  })

  it("opens details and the children scope from the narrow-screen list", async () => {
    await openAccounts()
    const [masterCard] = screen.getAllByRole("article")
    await userEvent.click(within(masterCard).getByRole("button", { name: /^master-a/ }))
    expect(await screen.findByText(m.accountDetail)).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByText(m.accountDetail)).not.toBeInTheDocument())

    await userEvent.click(
      within(masterCard).getByRole("button", { name: `${m.actions}: master-a` })
    )
    await userEvent.click(await screen.findByRole("menuitem", { name: m.viewChildren }))
    await waitFor(() => expect(lastAccountsCall()).toMatchObject({ masterId: 1 }))
  })

  it("selects from the narrow-screen list and from the table's select-all", async () => {
    const table = await openAccounts()
    const [, childCard] = screen.getAllByRole("article")
    await userEvent.click(within(childCard).getByRole("checkbox", { name: "child-a" }))
    expect(screen.getByText(m.selected(1))).toBeInTheDocument()

    await userEvent.click(within(table).getByRole("checkbox", { name: m.all }))
    expect(screen.getByText(m.selected(2))).toBeInTheDocument()
    await userEvent.click(within(table).getByRole("checkbox", { name: m.all }))
    expect(screen.getByText(m.accountsTotal(2))).toBeInTheDocument()

    await userEvent.click(within(childCard).getByRole("checkbox", { name: "child-a" }))
    await userEvent.click(within(childCard).getByRole("checkbox", { name: "child-a" }))
    expect(screen.getByText(m.accountsTotal(2))).toBeInTheDocument()
  })
})
