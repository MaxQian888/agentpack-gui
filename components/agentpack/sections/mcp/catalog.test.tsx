const mockRun = jest.fn()
jest.mock("../../run/runner-context", () => ({
  useRunnerCtx: () => ({ run: mockRun, onAfterRun: () => () => {} }),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(async () => "{}"),
  registryFetch: jest.fn(),
}))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))

import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { en } from "@/lib/i18n/en"
import { registryFetch } from "@/lib/tauri/commands"
import { CatalogTab } from "./catalog"
import type { DashboardScan } from "../dashboard"

const scan = (over: Partial<DashboardScan> = {}): DashboardScan =>
  ({
    claudeMcps: { known: ["context7"], custom: [] },
    codexMcps: { known: [], custom: [] },
    opencodeMcps: { known: [], custom: [] },
    claudeSkills: { known: [], custom: [] },
    codexSkills: { known: [], custom: [] },
    relay: { hasToken: false },
    hasCodexRelay: false,
    providers: [],
    claudeSettings: { status: "missing", hasBackup: false },
    codexConfig: { status: "missing", hasBackup: false },
    ...over,
  }) as DashboardScan

const paths = {
  home: "/h",
  claudeConfig: "/h/.claude.json",
  codexConfig: "/h/.codex/config.toml",
  opencodeConfig: "/h/.config/opencode/opencode.json",
} as never

beforeEach(() => {
  mockRun.mockClear()
  useAppStore.getState().resetPlan()
  useAppStore.setState({
    paths,
    detections: { "claude-code": { installed: true, version: "1" } } as never,
  })
})

function renderCatalog() {
  return render(
    <I18nProvider>
      <CatalogTab scan={scan()} refresh={() => {}} route="cli" />
    </I18nProvider>
  )
}

it("adding a not-installed target runs the add step and leaves the install plan alone", async () => {
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  await userEvent.click(screen.getByTitle("Add to Codex"))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-codex-context7")).toBe(true)
  // The add is applied through the review panel; writing it into the plan too
  // brought the change tray up for a change that had already happened.
  expect(useAppStore.getState().plan.mcps.find((m) => m.id === "context7")).toBeUndefined()
})

it("clicking an installed target asks to confirm removal", async () => {
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  await userEvent.click(screen.getByTitle("Remove from Claude Code"))
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
  expect(mockRun).not.toHaveBeenCalled()
})

it("the needs-key filter narrows to keyed servers", async () => {
  renderCatalog()
  await userEvent.click(screen.getByRole("button", { name: /^Needs key \d+$/i }))
  // context7 needs a key and stays; memory (no key) is filtered out.
  expect(screen.getByText("Context7")).toBeInTheDocument()
  expect(screen.queryByText(/knowledge graph/i)).not.toBeInTheDocument()
})

/** Open the refinement popover if it isn't already showing its controls. */
async function openFilters() {
  if (!screen.queryByRole("combobox", { name: "Transport" })) {
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }))
  }
}

async function pick(control: string, option: string) {
  await openFilters()
  await userEvent.click(await screen.findByRole("combobox", { name: control }))
  await userEvent.click(await screen.findByRole("option", { name: option }))
}

it("filters the catalog by target context, transport, and authentication", async () => {
  renderCatalog()
  await openFilters()
  expect(screen.getByRole("combobox", { name: "Target" })).toBeDisabled()
  await userEvent.keyboard("{Escape}")

  await userEvent.click(screen.getByRole("button", { name: /^Installed 1$/i }))
  await openFilters()
  expect(screen.getByRole("combobox", { name: "Target" })).toBeEnabled()
  await pick("Target", "Claude Code")
  expect(screen.getByText("Context7")).toBeInTheDocument()

  await userEvent.keyboard("{Escape}")
  await userEvent.click(screen.getByRole("button", { name: /^All \d+$/i }))
  await pick("Transport", "Remote (HTTP)")
  expect(screen.queryByText("Context7")).not.toBeInTheDocument()

  await pick("Transport", "Any transport")
  await pick("Authentication", "No key required")
  expect(screen.queryByText("Context7")).not.toBeInTheDocument()
  expect(screen.getByText(/knowledge graph/i)).toBeInTheDocument()
})

it("counts the folded filters on their button, so none can hide rows silently", async () => {
  renderCatalog()
  expect(screen.getByRole("button", { name: /^Filters$/ })).toBeInTheDocument()
  await pick("Transport", "Remote (HTTP)")
  expect(screen.getByRole("button", { name: /^Filters 1$/ })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /Clear filters/ }))
  expect(screen.getByRole("button", { name: /^Filters$/ })).toBeInTheDocument()
  expect(screen.getByText("Context7")).toBeInTheDocument()
})

it("carries a faceted count on every scope chip", () => {
  renderCatalog()
  // context7 is installed on Claude in the fixture scan; the rest are not.
  expect(screen.getByRole("button", { name: /^Installed 1$/ })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /^Not installed \d+$/ })).toBeInTheDocument()
})

it("confirming removal runs the remove step without touching the install plan", async () => {
  useAppStore.getState().setMcp("context7", ["claude"])
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  await userEvent.click(screen.getByTitle("Remove from Claude Code"))
  await userEvent.click(await screen.findByRole("button", { name: /^Remove$/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-remove-claude-context7")).toBe(true)
  // Whatever the user staged in the plan is theirs; a catalog remove doesn't edit it.
  const entry = useAppStore.getState().plan.mcps.find((x) => x.id === "context7")
  expect(entry?.targets).toEqual(["claude"])
})

it("offers no Claude chip on a machine with no route to Claude's config", async () => {
  render(
    <I18nProvider>
      <CatalogTab scan={scan()} refresh={() => {}} route="none" />
    </I18nProvider>
  )
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  const chip = screen.getByTitle(en.mcp.claudeMissing)
  expect(chip).toBeDisabled()
})

it("says why the Target filter is disabled", async () => {
  renderCatalog()
  await openFilters()
  expect(screen.getByRole("combobox", { name: "Target" })).toBeDisabled()
  expect(screen.getByText(en.mcp.filterTargetHint)).toBeInTheDocument()
})

describe("online registry search", () => {
  const page = (names: string[], nextCursor?: string) =>
    JSON.stringify({
      servers: names.map((name) => ({
        server: {
          name: `io.test/${name}`,
          title: name,
          packages: [{ registryType: "npm", identifier: `${name}-mcp` }],
        },
      })),
      metadata: nextCursor ? { nextCursor } : {},
    })

  function deferred() {
    let resolve!: (v: string) => void
    const promise = new Promise<string>((r) => (resolve = r))
    return { promise, resolve }
  }

  it("ignores a reply to a query the user has typed past", async () => {
    const slow = deferred()
    ;(registryFetch as jest.Mock)
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => page(["Fresh"]))
    renderCatalog()
    const search = screen.getByLabelText(/Search MCP servers/i)
    await userEvent.type(search, "zz")
    await waitFor(() => expect(registryFetch).toHaveBeenCalledWith("zz", undefined))
    await userEvent.type(search, "q")
    await waitFor(() => expect(registryFetch).toHaveBeenCalledWith("zzq", undefined))
    expect(await screen.findByText("Fresh")).toBeInTheDocument()
    // The first query's reply lands last; it answers nothing on screen now.
    await act(async () => slow.resolve(page(["Stale"])))
    expect(screen.queryByText("Stale")).not.toBeInTheDocument()
    expect(screen.getByText("Fresh")).toBeInTheDocument()
  })

  it("keeps what loaded when the next page fails, and retries that page", async () => {
    ;(registryFetch as jest.Mock)
      .mockImplementationOnce(async () => page(["Alpha"], "c1"))
      .mockImplementationOnce(async () => {
        throw new Error("offline")
      })
      .mockImplementationOnce(async () => page(["Beta"]))
    renderCatalog()
    await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "zz")
    expect(await screen.findByText("Alpha")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: en.mcp.registryLoadMore }))
    expect(await screen.findByText(en.mcp.registryMoreError)).toBeInTheDocument()
    // The failed page hid nothing, and the retry asks for the same query + cursor.
    expect(screen.getByText("Alpha")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: en.mcp.registryRetry }))
    await waitFor(() => expect(registryFetch).toHaveBeenLastCalledWith("zz", "c1"))
    expect(await screen.findByText("Beta")).toBeInTheDocument()
    expect(screen.getByText("Alpha")).toBeInTheDocument()
  })
})

it("hides the API key field behind a disclosure until it is wanted", async () => {
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  // A password field on every keyed row reads as a form to fill in before you
  // may browse; the row offers the env var by name instead.
  expect(screen.queryByLabelText(/context7 /)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /Add API key/ }))
  const field = await screen.findByLabelText(/^context7 /)
  await userEvent.type(field, "sk-test")
  expect(useAppStore.getState().plan.mcpKeys["context7"]).toBe("sk-test")
})

it("writes a key into a server that is already installed, through the review panel", async () => {
  // The completion screen's to-do sends people here for exactly this: context7
  // is on Claude already, without its key. A key that only reached the next
  // add would leave the installed server as broken as before.
  useAppStore.getState().setMcpKey("context7", "") // resetPlan keeps keys; start without one
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  await userEvent.click(screen.getByRole("button", { name: /Add API key/ }))
  const apply = screen.getByRole("button", { name: en.mcp.keyApply(1) })
  expect(apply).toBeDisabled()
  await userEvent.type(await screen.findByLabelText(/^context7 /), "sk-test")
  await userEvent.click(apply)
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string; command?: { args: string[] } }[]
  // Claude via its CLI: remove, then add again with the key in the env.
  expect(steps.map((st) => st.id)).toEqual([
    "mcp-edit-remove-claude-context7",
    "mcp-edit-add-claude-context7",
  ])
  expect(JSON.stringify(steps[1].command)).toContain("sk-test")
})

it("opens on the servers that need a key when asked to", () => {
  render(
    <I18nProvider>
      <CatalogTab scan={scan()} refresh={() => {}} route="cli" initialFilter="needsKey" />
    </I18nProvider>
  )
  expect(screen.getByRole("button", { name: new RegExp(en.mcp.filterNeedsKey) })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
})

it("shows the no-results state when the search matches nothing", async () => {
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "zzznotathing")
  expect(screen.getByText(/No MCP servers match your search/i)).toBeInTheDocument()
})
