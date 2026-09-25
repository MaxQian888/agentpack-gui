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
import { en } from "@/lib/i18n/en"
import type { ClaudeMcpRoute } from "@/lib/agentpack/plan"
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

function renderDialog(
  onOpenChange = jest.fn(),
  over: Partial<DashboardScan> = {},
  route: ClaudeMcpRoute = "cli"
) {
  render(
    <I18nProvider>
      <ImportDialog
        open
        onOpenChange={onOpenChange}
        scan={scan(over)}
        refresh={() => {}}
        route={route}
      />
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
  // Closing is the confirmation here; the panel already says "All set".
  expect(toast.success).not.toHaveBeenCalled()
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

it("keeps the paste and the dialog when the user walks away from the review", async () => {
  mockRun.mockResolvedValue([])
  const { onOpenChange } = renderDialog()
  paste("claude mcp add fetch npx -y @modelcontextprotocol/server-fetch")
  await userEvent.click(await screen.findByRole("button", { name: /Import 1/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  // Nothing was written: no success toast, no closing, no wiping what was pasted.
  expect(toast.success).not.toHaveBeenCalled()
  expect(onOpenChange).not.toHaveBeenCalledWith(false)
  expect(screen.getByPlaceholderText(/Paste JSON/i)).toHaveValue(
    "claude mcp add fetch npx -y @modelcontextprotocol/server-fetch"
  )
})

it("overwrites an existing id as an edit, since claude mcp add rejects a duplicate", async () => {
  renderDialog(jest.fn(), { claudeMcps: { known: [], custom: ["foo"] } })
  paste('{"mcpServers":{"foo":{"command":"npx","args":["x"]}}}')
  await userEvent.click(await screen.findByRole("button", { name: /Import 1/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const ids = (mockRun.mock.calls[0][0] as { id: string }[]).map((s) => s.id)
  expect(ids).toEqual(["mcp-edit-remove-claude-foo", "mcp-edit-add-claude-foo"])
})

it("writes Claude's file directly on a desktop-only machine", async () => {
  renderDialog(jest.fn(), {}, "file")
  paste('{"mcpServers":{"foo":{"command":"npx","args":["x"]}}}')
  await userEvent.click(await screen.findByRole("button", { name: /Import 1/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalled())
  const [step] = mockRun.mock.calls[0][0] as { id: string; kind: string; path?: string }[]
  expect(step).toMatchObject({
    id: "mcp-add-claude-foo",
    kind: "mergeFile",
    path: "/h/.claude.json",
  })
})

it("doesn't offer Claude when there is no route to it", async () => {
  renderDialog(jest.fn(), {}, "none")
  paste('{"mcpServers":{"foo":{"command":"npx","args":["x"]}}}')
  const [claude] = screen.getAllByRole("checkbox")
  expect(claude).toBeDisabled()
  expect(claude).not.toBeChecked()
  // Claude was the only default target, so there is nothing to import into yet.
  expect(await screen.findByRole("button", { name: /Import 1/i })).toBeDisabled()
  expect(screen.getByTitle(en.mcp.claudeMissing)).toBeInTheDocument()
})

it("gates Codex when every pasted server is SSE", async () => {
  renderDialog()
  paste('{"mcpServers":{"ev":{"type":"sse","url":"https://x.example/sse"}}}')
  expect(await screen.findByText("ev")).toBeInTheDocument()
  const codex = screen.getAllByRole("checkbox")[1]
  expect(codex).toBeDisabled()
  expect(screen.getByTitle(en.mcp.capCodexNoSse)).toBeInTheDocument()
})
