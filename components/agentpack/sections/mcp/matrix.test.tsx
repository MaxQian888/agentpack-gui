const mockRun = jest.fn()
jest.mock("../../run/runner-context", () => ({
  useRunnerCtx: () => ({ run: mockRun, onAfterRun: () => () => {} }),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({ readTextFile: jest.fn(async () => "{}") }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { readTextFile } from "@/lib/tauri/commands"
import { en } from "@/lib/i18n/en"
import type { ClaudeMcpRoute } from "@/lib/agentpack/plan"
import { MatrixTab } from "./matrix"
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

/** What `run()` resolves with once the user applied and every step landed. */
const applied = (steps: { id: string; label: string }[]) =>
  steps.map((s) => ({ id: s.id, label: s.label, status: "done", output: [] }))

beforeEach(() => {
  mockRun.mockReset()
  mockRun.mockImplementation(async (steps) => applied(steps))
  ;(toast.success as jest.Mock).mockClear()
  useAppStore.getState().resetPlan()
  useAppStore.setState({
    paths,
    detections: { "claude-code": { installed: true, version: "1" } } as never,
  })
})

function renderMatrix(over: Partial<DashboardScan> = {}, route: ClaudeMcpRoute = "cli") {
  render(
    <I18nProvider>
      <MatrixTab scan={scan(over)} refresh={() => {}} route={route} />
    </I18nProvider>
  )
}

it("renders a server row and copies a known server to a missing target", async () => {
  renderMatrix()
  expect(screen.getByText("Context7")).toBeInTheDocument()
  await userEvent.click(screen.getByTitle("Copy to Codex"))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-codex-context7")).toBe(true)
  // The review panel reports success; a toast on top would say it twice.
  expect(toast.success).not.toHaveBeenCalled()
})

it("removes a present target after confirming", async () => {
  renderMatrix()
  await userEvent.click(screen.getByTitle("Remove from Claude Code"))
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
  expect(mockRun).not.toHaveBeenCalled()
  await userEvent.click(await screen.findByRole("button", { name: /^Remove$/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-remove-claude-context7")).toBe(true)
})

it("copies a custom server using its on-disk spec", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith("config.toml") ? '[mcp_servers.mine]\ncommand = "node"\nargs = ["s.js"]\n' : "{}"
  )
  renderMatrix({
    claudeMcps: { known: [], custom: [] },
    codexMcps: { known: [], custom: ["mine"] },
  })
  await screen.findByText("mine")
  const claudeCell = await screen.findByTitle("Copy to Claude Code")
  await waitFor(() => expect(claudeCell).not.toBeDisabled())
  await userEvent.click(claudeCell)
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-claude-mine")).toBe(true)
})

it("shows the empty state when nothing is configured", () => {
  renderMatrix({ claudeMcps: { known: [], custom: [] } })
  expect(screen.getByText(/No MCP servers configured yet/i)).toBeInTheDocument()
})

it("doesn't toast a copy the user walked away from", async () => {
  mockRun.mockResolvedValue([])
  renderMatrix()
  await userEvent.click(screen.getByTitle("Copy to Codex"))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  expect(toast.success).not.toHaveBeenCalled()
})

it("disables Claude's cells, add and remove alike, with the reason, when there is no route", async () => {
  renderMatrix({}, "none")
  // Context7 is on Claude: the remove used to stage nothing and toast "empty plan".
  const cell = await screen.findByTitle(en.mcp.claudeMissing)
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())
  expect(cell).toBeDisabled()
  expect(screen.queryByTitle("Remove from Claude Code")).not.toBeInTheDocument()
})

it("names why a custom server's cell can't copy when its entry is unreadable", async () => {
  // "mine" is listed on Codex, but no config file has an entry to copy from.
  ;(readTextFile as jest.Mock).mockImplementation(async () => "{}")
  renderMatrix({
    claudeMcps: { known: [], custom: [] },
    codexMcps: { known: [], custom: ["mine"] },
  })
  const cells = await screen.findAllByTitle(en.mcp.copyNoSpec)
  // Claude and OpenCode: both empty, both blocked, both saying why.
  expect(cells).toHaveLength(2)
  for (const cell of cells) expect(cell).toBeDisabled()
})
