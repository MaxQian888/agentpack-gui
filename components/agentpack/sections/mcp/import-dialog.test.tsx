const mockRun = jest.fn()
jest.mock("../../run/runner-context", () => ({
  useRunnerCtx: () => ({ run: mockRun, onAfterRun: () => () => {} }),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({ readTextFile: jest.fn(async () => "{}") }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { ImportDialog } from "./import-dialog"
import type { DashboardScan } from "../dashboard"

const scan = (over: Partial<DashboardScan> = {}): DashboardScan =>
  ({
    claudeMcps: { known: [], custom: [] },
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
  useAppStore.setState({ paths })
})

function renderDialog(onOpenChange = jest.fn(), over: Partial<DashboardScan> = {}) {
  render(
    <I18nProvider>
      <ImportDialog open onOpenChange={onOpenChange} scan={scan(over)} refresh={() => {}} />
    </I18nProvider>
  )
  return { onOpenChange }
}

const paste = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText(/Paste JSON/i), { target: { value } })

it("parses a claude mcp add command and imports to the default target", async () => {
  const { onOpenChange } = renderDialog()
  paste("claude mcp add fetch npx -y @modelcontextprotocol/server-fetch")
  expect(await screen.findByText("fetch")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /Import 1/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-claude-fetch")).toBe(true)
  expect(toast.success).toHaveBeenCalled()
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it("imports a JSON mcpServers block to a toggled target", async () => {
  renderDialog()
  paste('{"mcpServers":{"foo":{"command":"npx","args":["x"]}}}')
  expect(await screen.findByText("foo")).toBeInTheDocument()
  // Toggle OpenCode on (checkbox order: claude, codex, opencode).
  await userEvent.click(screen.getAllByRole("checkbox")[2])
  await userEvent.click(screen.getByRole("button", { name: /Import 1/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-opencode-foo")).toBe(true)
})

it("flags an id that collides with an existing server", async () => {
  renderDialog(jest.fn(), { claudeMcps: { known: [], custom: ["foo"] } })
  paste('{"mcpServers":{"foo":{"command":"npx","args":["x"]}}}')
  expect(await screen.findByText(/importing overwrites it/i)).toBeInTheDocument()
})

it("shows a parse error and disables import for junk input", async () => {
  renderDialog()
  paste("this is not a config")
  expect(await screen.findByText(/Couldn't parse/i)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Import 0/i })).toBeDisabled()
  expect(mockRun).not.toHaveBeenCalled()
})
