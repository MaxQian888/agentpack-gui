jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  runCommand: jest.fn(async () => 0),
  pathExists: jest.fn(async () => false),
}))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))

import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { isTauri } from "@/lib/tauri"
import { MCP_SERVERS } from "@/lib/agentpack/registry"
import { McpSection } from "./index"
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

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths: { home: "/h" } as never, dryRun: false, panelOpen: false })
})

function renderSection(loading = false) {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <McpSection scan={scan()} loading={loading} refresh={() => {}} />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("renders the four tabs and the stat strip", () => {
  renderSection()
  expect(screen.getByRole("tab", { name: /Catalog/i })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: /Installed/i })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: /Overview/i })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: /Add custom/i })).toBeInTheDocument()
  // Stat strip: the catalog total tracks the registry size.
  expect(screen.getByText(String(MCP_SERVERS.length))).toBeInTheDocument()
})

it("shows a not-desktop notice when not running under Tauri", () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  renderSection()
  expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument()
  expect(screen.queryByRole("tab", { name: /Catalog/i })).not.toBeInTheDocument()
})
