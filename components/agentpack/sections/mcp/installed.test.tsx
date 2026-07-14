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
import { readTextFile } from "@/lib/tauri/commands"
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

beforeEach(() => {
  mockRun.mockClear()
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths })
})

afterEach(() => {
  ;(readTextFile as jest.Mock).mockImplementation(async () => "{}")
})

function renderInstalled(s: DashboardScan | null = scan()) {
  return render(
    <I18nProvider>
      <InstalledTab scan={s} refresh={() => {}} />
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

it("shows the empty state when nothing is configured", () => {
  renderInstalled(
    scan({ claudeMcps: { known: [], custom: [] }, codexMcps: { known: [], custom: [] } })
  )
  expect(screen.getByText(/No MCP servers configured yet/i)).toBeInTheDocument()
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

it("narrows by source filter and shows the filtered-empty state on no search hit", async () => {
  renderInstalled()
  // Filter to Codex-only: the claude-only Context7 drops, custom "mine" stays.
  await userEvent.click(screen.getByRole("button", { name: /Codex\s*1/i }))
  expect(screen.queryByText("Context7")).not.toBeInTheDocument()
  expect(screen.getByText("mine")).toBeInTheDocument()
  await userEvent.type(screen.getByPlaceholderText(/Search MCP servers/i), "zzz")
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
