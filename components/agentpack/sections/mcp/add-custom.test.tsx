const mockRun = jest.fn()
jest.mock("../../run/runner-context", () => ({
  useRunnerCtx: () => ({ run: mockRun, onAfterRun: () => () => {} }),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { AddCustomTab } from "./add-custom"
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
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths })
})

function renderAdd(s: DashboardScan | null = scan(), refresh = jest.fn()) {
  render(
    <I18nProvider>
      <AddCustomTab scan={s} refresh={refresh} route="cli" />
    </I18nProvider>
  )
  return { refresh }
}

it("runs the add-spec step and refreshes after the form submits", async () => {
  const { refresh } = renderAdd()
  await userEvent.type(screen.getByLabelText(/Server id/i), "my-server")
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1))
  const steps = mockRun.mock.calls[0][0] as { id: string }[]
  expect(steps.some((s) => s.id === "mcp-add-claude-my-server")).toBe(true)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it("does nothing until the paths are resolved", async () => {
  useAppStore.setState({ paths: undefined as never })
  const { refresh } = renderAdd()
  await userEvent.type(screen.getByLabelText(/Server id/i), "my-server")
  await userEvent.click(screen.getByRole("button", { name: /Add server/i }))
  expect(mockRun).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})
