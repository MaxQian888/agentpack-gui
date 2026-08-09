jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  runCommand: jest.fn(async () => 0),
  pathExists: jest.fn(async () => false),
}))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))

import { render, screen, within } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { RunnerHarness } from "../../run/__testing__/harness"
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
  useAppStore.setState({ paths: { home: "/h" } as never, panelOpen: false })
})

function renderSection(loading = false, value: DashboardScan | null = scan()) {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <McpSection scan={value} loading={loading} refresh={() => {}} />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("renders the catalog workbench with tiled management actions", () => {
  renderSection()
  expect(screen.getByRole("region", { name: /MCP summary/i })).toBeInTheDocument()
  const actions = within(screen.getByRole("complementary", { name: /MCP management views/i }))
  expect(actions.getByRole("button", { name: /^Installed$/i })).toBeInTheDocument()
  expect(actions.getByRole("button", { name: /Overview/i })).toBeInTheDocument()
  expect(actions.getByRole("button", { name: /Add custom/i })).toBeInTheDocument()
  // Stat strip: the catalog total tracks the registry size.
  expect(screen.getByText(String(MCP_SERVERS.length))).toBeInTheDocument()
})

it("counts custom MCP servers in installed and target coverage metrics", () => {
  renderSection(
    false,
    scan({
      claudeMcps: { known: ["context7"], custom: ["private-search"] },
      codexMcps: { known: [], custom: ["private-search"] },
    })
  )
  const summary = within(screen.getByRole("region", { name: /MCP summary/i }))
  expect(summary.getByText(en.mcp.statInstalled).parentElement).toHaveTextContent("2")
  expect(summary.getByText(en.mcp.targets.claude).parentElement).toHaveTextContent("2")
  expect(summary.getByText(en.mcp.targets.codex).parentElement).toHaveTextContent("1")
})

it("shows unknown MCP coverage while the first scan is pending", () => {
  renderSection(true, null)
  const summary = within(screen.getByRole("region", { name: /MCP summary/i }))
  expect(summary.getAllByText("—")).toHaveLength(4)
})

it("shows a not-desktop notice when not running under Tauri", () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  renderSection()
  expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /Add custom/i })).not.toBeInTheDocument()
})
