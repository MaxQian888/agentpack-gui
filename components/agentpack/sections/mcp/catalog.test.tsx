const mockRun = jest.fn()
jest.mock("../../run/runner-context", () => ({
  useRunnerCtx: () => ({ run: mockRun, onAfterRun: () => () => {} }),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({ readTextFile: jest.fn(async () => "{}") }))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
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
      <CatalogTab scan={scan()} refresh={() => {}} />
    </I18nProvider>
  )
}

it("adding a not-installed target runs the add step and syncs the plan", async () => {
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  await userEvent.click(screen.getByTitle("Add to Codex"))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-codex-context7")).toBe(true)
  expect(useAppStore.getState().plan.mcps.find((m) => m.id === "context7")?.targets).toContain(
    "codex"
  )
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
  await userEvent.click(screen.getByRole("button", { name: /Needs key/i }))
  // context7 needs a key and stays; memory (no key) is filtered out.
  expect(screen.getByText("Context7")).toBeInTheDocument()
  expect(screen.queryByText(/knowledge graph/i)).not.toBeInTheDocument()
})

it("filters the catalog by target context, transport, and authentication", async () => {
  renderCatalog()
  expect(screen.getByRole("combobox", { name: "Target" })).toBeDisabled()

  await userEvent.click(screen.getByRole("button", { name: /^Installed$/i }))
  expect(screen.getByRole("combobox", { name: "Target" })).toBeEnabled()
  await userEvent.click(screen.getByRole("combobox", { name: "Target" }))
  await userEvent.click(screen.getByRole("option", { name: "Claude Code" }))
  expect(screen.getByText("Context7")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: /^All$/i }))
  await userEvent.click(screen.getByRole("combobox", { name: "Transport" }))
  await userEvent.click(screen.getByRole("option", { name: "Remote (HTTP)" }))
  expect(screen.queryByText("Context7")).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("combobox", { name: "Transport" }))
  await userEvent.click(screen.getByRole("option", { name: "Any transport" }))
  await userEvent.click(screen.getByRole("combobox", { name: "Authentication" }))
  await userEvent.click(screen.getByRole("option", { name: "No key required" }))
  expect(screen.queryByText("Context7")).not.toBeInTheDocument()
  expect(screen.getByText(/knowledge graph/i)).toBeInTheDocument()
})

it("confirming removal runs the remove step and syncs the plan", async () => {
  useAppStore.getState().setMcp("context7", ["claude"])
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "context7")
  await userEvent.click(screen.getByTitle("Remove from Claude Code"))
  await userEvent.click(await screen.findByRole("button", { name: /^Remove$/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-remove-claude-context7")).toBe(true)
  const entry = useAppStore.getState().plan.mcps.find((x) => x.id === "context7")
  expect(entry?.targets ?? []).not.toContain("claude")
})

it("shows the no-results state when the search matches nothing", async () => {
  renderCatalog()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "zzznotathing")
  expect(screen.getByText(/No MCP servers match your search/i)).toBeInTheDocument()
})
