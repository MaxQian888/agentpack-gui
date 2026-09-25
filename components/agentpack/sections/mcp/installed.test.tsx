const mockRun = jest.fn()
jest.mock("../../run/runner-context", () => ({
  useRunnerCtx: () => ({ run: mockRun, onAfterRun: () => () => {} }),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(async () => "{}"),
  commandOnPath: jest.fn(async () => true),
  probeHost: jest.fn(async () => ({ reachable: true, latencyMs: 5 })),
}))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { en } from "@/lib/i18n/en"
import { readTextFile } from "@/lib/tauri/commands"
import type { ClaudeMcpRoute } from "@/lib/agentpack/plan"
import { InstalledTab } from "./installed"
import type { DashboardScan } from "../dashboard"

const scan = (over: Partial<DashboardScan> = {}): DashboardScan =>
  ({
    claudeMcps: { known: ["context7"], custom: [] },
    codexMcps: { known: [], custom: ["mine"] },
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

/** What `run()` resolves with once the user applied and every step landed. */
const applied = (steps: { id: string; label: string }[]) =>
  steps.map((s) => ({ id: s.id, label: s.label, status: "done", output: [] }))

beforeEach(() => {
  mockRun.mockReset()
  mockRun.mockImplementation(async (steps) => applied(steps))
  ;(toast.success as jest.Mock).mockClear()
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths })
})

afterEach(() => {
  ;(readTextFile as jest.Mock).mockImplementation(async () => "{}")
})

function renderInstalled(
  s: DashboardScan | null = scan(),
  onBrowseCatalog?: () => void,
  route: ClaudeMcpRoute = "cli"
) {
  return render(
    <I18nProvider>
      <InstalledTab scan={s} refresh={() => {}} route={route} onBrowseCatalog={onBrowseCatalog} />
    </I18nProvider>
  )
}

it("lists catalog and custom servers with their id shown for customs", () => {
  renderInstalled()
  expect(screen.getByText("Context7")).toBeInTheDocument()
  expect(screen.getByText("mine")).toBeInTheDocument()
  // Source filter chips carry per-target counts.
  expect(screen.getByRole("button", { name: /Codex\s*1/i })).toBeInTheDocument()
})

it("names each row's targets in words, not colour alone", () => {
  renderInstalled()
  // One dot group per row replaces the row of per-target badges; the group
  // carries the names so the colours are decoration, not the only signal.
  expect(screen.getByLabelText("Configured on: Claude Code")).toBeInTheDocument()
  expect(screen.getByLabelText("Configured on: Codex")).toBeInTheDocument()
})

it("shows the empty state, with the catalog as its next step", async () => {
  const browse = jest.fn()
  renderInstalled(
    scan({ claudeMcps: { known: [], custom: [] }, codexMcps: { known: [], custom: [] } }),
    browse
  )
  expect(screen.getByText(/No MCP servers configured yet/i)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /Browse the catalog/i }))
  expect(browse).toHaveBeenCalled()
})

it("removing a target confirms then runs the remove step", async () => {
  renderInstalled()
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[0])
  await userEvent.click(await screen.findByRole("menuitem", { name: /Remove from Claude Code/i }))
  await userEvent.click(await screen.findByRole("button", { name: /^Remove$/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-remove-claude-context7")).toBe(true)
})

it("copies a known server to a missing target from the row menu", async () => {
  renderInstalled()
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[0])
  await userEvent.click(await screen.findByRole("menuitem", { name: /Copy to Codex/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-codex-context7")).toBe(true)
  // The review panel reports success; a toast on top would say it twice.
  expect(toast.success).not.toHaveBeenCalled()
})

it("runs a health check from the row menu and toasts the outcome", async () => {
  renderInstalled()
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[0])
  await userEvent.click(await screen.findByRole("menuitem", { name: /^Test$/i }))
  await waitFor(() => expect(toast.success).toHaveBeenCalled())
})

it("tests and copies a custom server by reading its on-disk spec", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith("config.toml") ? '[mcp_servers.mine]\ncommand = "node"\nargs = ["s.js"]\n' : "{}"
  )
  renderInstalled()
  // "mine" is the custom server on Codex (rows sorted: Context7, then mine).
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[1])
  await userEvent.click(await screen.findByRole("menuitem", { name: /Copy to Claude Code/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-claude-mine")).toBe(true)
})

it("narrows by source filter and shows the filtered-empty state on no search hit", async () => {
  renderInstalled()
  // Filter to Codex-only: the claude-only Context7 drops, custom "mine" stays.
  await userEvent.click(screen.getByRole("button", { name: /Codex\s*1/i }))
  expect(screen.queryByText("Context7")).not.toBeInTheDocument()
  expect(screen.getByText("mine")).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(/Search MCP servers/i), "zzz")
  expect(screen.getByText(/No servers match your filter/i)).toBeInTheDocument()
})

it("opens the read-only detail dialog from a row card", async () => {
  renderInstalled()
  await userEvent.click(screen.getByRole("button", { name: /^Context7/i }))
  expect(await screen.findByRole("dialog")).toBeInTheDocument()
})

it("edits a custom server end to end and runs the edit step", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith("config.toml") ? '[mcp_servers.mine]\ncommand = "node"\nargs = ["s.js"]\n' : "{}"
  )
  renderInstalled()
  // Open "mine" (custom, on Codex) → its read-only detail dialog → Edit.
  await userEvent.click(screen.getByRole("button", { name: /^mine$/i }))
  await userEvent.click(await screen.findByRole("button", { name: /^Edit$/i }))
  // The edit form opens prefilled; saving runs the edit step.
  await userEvent.click(await screen.findByRole("button", { name: /Save changes/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id.includes("mine"))).toBe(true)
})

it("doesn't toast a copy the user walked away from", async () => {
  mockRun.mockResolvedValue([])
  renderInstalled()
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[0])
  await userEvent.click(await screen.findByRole("menuitem", { name: /Copy to Codex/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  expect(toast.success).not.toHaveBeenCalled()
})

it("doesn't toast a copy whose step failed", async () => {
  mockRun.mockImplementation(async (steps: { id: string; label: string }[]) =>
    steps.map((st) => ({ id: st.id, label: st.label, status: "error", output: [] }))
  )
  renderInstalled()
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[0])
  await userEvent.click(await screen.findByRole("menuitem", { name: /Copy to Codex/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  expect(toast.success).not.toHaveBeenCalled()
})

it("copies to Claude by writing its file on a desktop-only machine", async () => {
  renderInstalled(
    scan({ claudeMcps: { known: [], custom: [] }, codexMcps: { known: ["context7"], custom: [] } }),
    undefined,
    "file"
  )
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[0])
  await userEvent.click(await screen.findByRole("menuitem", { name: /Copy to Claude Code/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const [step] = mockRun.mock.calls[0][0] as { id: string; kind: string }[]
  expect(step).toMatchObject({ id: "mcp-add-claude-context7", kind: "mergeFile" })
})

it("says why Claude is missing from the menu when there is no route to it", async () => {
  renderInstalled(scan(), undefined, "none")
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[0])
  expect(await screen.findByText(en.mcp.claudeMissing)).toBeInTheDocument()
  expect(
    screen.queryByRole("menuitem", { name: /Remove from Claude Code/i })
  ).not.toBeInTheDocument()
})

it("opens the edit form straight from a custom server's Edit item", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith("config.toml") ? '[mcp_servers.mine]\ncommand = "node"\nargs = ["s.js"]\n' : "{}"
  )
  renderInstalled()
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[1])
  await userEvent.click(await screen.findByRole("menuitem", { name: /^Edit$/i }))
  // The form itself, not the read-only viewer it used to open.
  expect(await screen.findByRole("button", { name: /Save changes/i })).toBeInTheDocument()
})

it("keeps the edit form open until the edit is on disk", async () => {
  mockRun.mockResolvedValue([])
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith("config.toml") ? '[mcp_servers.mine]\ncommand = "node"\nargs = ["s.js"]\n' : "{}"
  )
  renderInstalled()
  await userEvent.click(screen.getAllByRole("button", { name: /Actions/i })[1])
  await userEvent.click(await screen.findByRole("menuitem", { name: /^Edit$/i }))
  await userEvent.click(await screen.findByRole("button", { name: /Save changes/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  expect(screen.getByRole("button", { name: /Save changes/i })).toBeInTheDocument()
})
