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

beforeEach(() => {
  mockRun.mockClear()
  ;(toast.success as jest.Mock).mockClear()
  useAppStore.getState().resetPlan()
  useAppStore.setState({
    paths,
    detections: { "claude-code": { installed: true, version: "1" } } as never,
  })
})

function renderMatrix(over: Partial<DashboardScan> = {}) {
  render(
    <I18nProvider>
      <MatrixTab scan={scan(over)} refresh={() => {}} />
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
  expect(toast.success).toHaveBeenCalled()
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
