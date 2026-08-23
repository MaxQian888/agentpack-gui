jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands")
jest.mock("@/lib/tauri/settings", () => ({
  saveSettings: jest.fn(async () => undefined),
  DEFAULT_SETTINGS: {
    autoCheckUpdates: true,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    quickStartDismissed: false,
  },
}))

import { useCallback, useEffect, useState } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as api from "@/lib/tauri/commands"
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/tauri/settings"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { RunnerHarness } from "../run/__testing__/harness"
import { useAppStore } from "@/store/app-store"
import type { Paths } from "@/lib/agentpack/types"
import { BACKUP_SUFFIX } from "@/lib/agentpack/plan"
import { isTauri } from "@/lib/tauri"
import type { SectionKey } from "../sidebar-nav"
import { DashboardSection, scanEnvironment, type DashboardScan } from "./dashboard"

const paths: Paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeConfig: "/h/.claude.json",
  claudeSkillsDir: "/h/.claude/skills",
  codexConfig: "/h/.codex/config.toml",
  codexAuth: "/h/.codex/auth.json",
  codexSkillsDir: "/h/.codex/skills",
  opencodeConfig: "/h/.config/opencode/opencode.json",
  opencodeSkillsDir: "/h/.config/opencode/skills",
  agentsSkillsDir: "/h/.agents/skills",
  ccSwitchSettings: "/h/.cc-switch/settings.json",
  ccSwitchDb: "/h/.cc-switch/cc-switch.db",
  ccConnectDir: "/h/.cc-connect",
  ccConnectConfig: "/h/.cc-connect/config.toml",
  mcpDisabledStore: "/h/.agentpack/mcp-disabled.json",
  shellProfile: "/h/.zshrc",
  os: "mac",
}

beforeEach(() => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  useAppStore.getState().resetPlan()
  useAppStore.setState({
    detections: {},
    paths,
    panelOpen: false,
    onboardingOpen: false,
    networkProbe: null,
    latestVersions: {},
    activity: [],
    settings: { ...DEFAULT_SETTINGS },
  })
  // User-scope MCP servers are now read from ~/.claude.json (not `claude mcp list`);
  // a non-registry id there should classify as custom.
  ;(api.readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p === paths.claudeConfig ? JSON.stringify({ mcpServers: { "my-custom": {} } }) : ""
  )
  ;(api.listSkills as jest.Mock).mockResolvedValue([])
  ;(api.providerLoad as jest.Mock).mockResolvedValue([])
  ;(api.pathExists as jest.Mock).mockResolvedValue(false)
})

// Mirrors how ShellBody owns the scan: run it once and feed it down as props.
function DashboardHarness({ onNavigate }: { onNavigate: (key: SectionKey) => void }) {
  const paths = useAppStore((s) => s.paths)
  const [scan, setScan] = useState<DashboardScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const rescan = useCallback(async () => {
    if (!paths) return
    setScanning(true)
    try {
      setScan(await scanEnvironment(paths))
    } finally {
      setScanning(false)
    }
  }, [paths])
  // setState in the async continuation (not the effect body) avoids cascading renders.
  useEffect(() => {
    if (!paths) return
    let cancelled = false
    scanEnvironment(paths).then((result) => {
      if (!cancelled) setScan(result)
    })
    return () => {
      cancelled = true
    }
  }, [paths])
  return (
    <DashboardSection
      scan={scan}
      scanning={scanning}
      rescan={rescan}
      onNavigate={onNavigate}
      // The spend card has its own suite; here it only needs to be a scanned,
      // empty history so it renders its terminal state and not a skeleton.
      history={{ data: { sessions: [], errors: [] }, progress: null }}
    />
  )
}

function renderDashboard() {
  const onNavigate = jest.fn()
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <DashboardHarness onNavigate={onNavigate} />
      </RunnerHarness>
    </I18nProvider>
  )
  return { onNavigate }
}

/** A clean, fully-measured reading — for the states the async harness can't hold. */
const fakeScan = (over: Partial<DashboardScan> = {}): DashboardScan =>
  ({
    claudeMcps: { known: [], custom: [] },
    codexMcps: { known: [], custom: [] },
    opencodeMcps: { known: [], custom: [] },
    claudeSkills: { known: [], custom: [] },
    codexSkills: { known: [], custom: [] },
    relay: { hasToken: false },
    hasCodexRelay: false,
    providers: [],
    claudeSettings: { status: "ok", hasBackup: false },
    codexConfig: { status: "ok", hasBackup: false },
    at: Date.UTC(2026, 0, 2, 3, 4),
    degraded: false,
    ...over,
  }) as DashboardScan

/** Render one fixed frame, bypassing the scan the harness runs for real. */
function renderFrame(over: Partial<React.ComponentProps<typeof DashboardSection>> = {}) {
  const onNavigate = jest.fn()
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <DashboardSection
          scan={fakeScan()}
          scanning={false}
          rescan={jest.fn(async () => undefined)}
          onNavigate={onNavigate}
          history={{ data: { sessions: [], errors: [] }, progress: null }}
          {...over}
        />
      </RunnerHarness>
    </I18nProvider>
  )
  return { onNavigate }
}

it("renders the dashboard title and grouped sections", async () => {
  renderDashboard()
  expect(screen.getByText(/environment dashboard/i)).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: /MCP servers/i })).toBeInTheDocument()
  await screen.findByText("my-custom") // flush the async scan
})

it("organizes measured state into a summary, primary inventory, and supporting activity", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.2.3" } },
  })
  renderDashboard()
  await screen.findByText("my-custom")

  expect(screen.getByRole("region", { name: "Environment status" })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: "System inventory" })).toBeInTheDocument()
  expect(screen.getByRole("complementary", { name: "Usage and activity" })).toBeInTheDocument()
})

it("keeps desktop actions and unmeasured values honest in web mode", async () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  renderDashboard()

  await screen.findByText(en.dashboard.notTauri)
  // One verdict states the reason; the readouts and the inventory blocks each
  // stand down to an em dash rather than repeating it eleven times.
  const status = screen.getByRole("region", { name: en.dashboard.statusSummary })
  expect(within(status).getAllByText("—")).toHaveLength(5)
  expect(within(status).getByText(en.dashboard.notMeasured)).toBeInTheDocument()
  const inventory = screen.getByRole("region", { name: en.dashboard.systemInventory })
  expect(within(inventory).getAllByText("—")).toHaveLength(5)
  expect(within(inventory).queryByText(en.dashboard.notMeasured)).not.toBeInTheDocument()
  expect(within(inventory).queryByText(en.envcheck.notFound)).not.toBeInTheDocument()
  expect(within(inventory).queryByText(en.dashboard.relayNone)).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.dashboard.refresh })).not.toBeInTheDocument()
})

it("marks scan-derived metrics as incomplete when a desktop scan is degraded", async () => {
  ;(api.readTextFile as jest.Mock).mockRejectedValue(new Error("permission denied"))
  renderDashboard()

  await screen.findByText(en.diagnostics.degradedTitle)
  const status = screen.getByRole("region", { name: en.dashboard.statusSummary })
  expect(within(status).getAllByText("—")).toHaveLength(4)
  expect(within(status).getByText(en.dashboard.partialScan)).toBeInTheDocument()
})

it("shows a detected CLI version from the store", async () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.2.3" } } })
  renderDashboard()
  expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument()
  await screen.findByText("my-custom") // flush the async scan
})

it("scans real config and flags a registry-external MCP as custom", async () => {
  renderDashboard()
  // ~/.claude.json listed a non-registry id → classified as custom.
  expect(await screen.findByText("my-custom")).toBeInTheDocument()
  expect(screen.getAllByText(/custom/i).length).toBeGreaterThan(0)
})

it("renders rich scan state without any management actions", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  ;(api.readTextFile as jest.Mock).mockImplementation(async (p: string) => {
    if (p === paths.claudeSettings)
      return JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://r", ANTHROPIC_AUTH_TOKEN: "t" } })
    if (p === paths.codexConfig)
      return '[mcp_servers.memory]\ncommand = "npx"\n[model_providers.agentpack]\nname = "x"\n'
    return ""
  })
  ;(api.listSkills as jest.Mock).mockImplementation(async (p: string) =>
    p === paths.claudeSkillsDir ? ["rust"] : []
  )
  ;(api.providerLoad as jest.Mock).mockResolvedValue([
    { id: "x", app_type: "claude", name: "Prov", settings_config: "{}", is_current: false },
  ] as Provider[])

  renderDashboard()

  // Wait for the async scan, then assert scan- and store-derived content.
  expect(await screen.findByText("Prov")).toBeInTheDocument()
  expect(screen.getByText(/update → 2\.0\.0/)).toBeInTheDocument()
  expect(screen.getAllByText(/configured/i)).toHaveLength(2)

  // The overview is read-only now: removing an MCP server / skill / provider,
  // uninstalling a CLI and applying cc-switch visible apps all moved to the
  // sections that own them. Only the health banner's fixes stay here.
  expect(screen.queryByRole("button", { name: /uninstall/i })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /^remove/i })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument()
})

it("leads with the diagnostics list and stages its fixes for review", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  // settings.json exists but doesn't parse — a real problem — and it has a
  // backup, so the list can offer to restore it.
  ;(api.readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p === paths.claudeSettings ? "{ not json" : ""
  )
  ;(api.pathExists as jest.Mock).mockImplementation(
    async (p: string) => p === `${paths.claudeSettings}${BACKUP_SUFFIX}`
  )

  renderDashboard()

  // The unparsable settings.json, and the upgradable CLI. The absent codex
  // config.toml is NOT one — a file that was never there on a machine without
  // Codex is the normal state, not something to fix.
  await screen.findByText(en.diagnostics.configInvalidTitle(en.diagnostics.fileClaudeSettings))
  const list = screen.getByRole("region", { name: en.diagnostics.title })
  expect(
    within(list).queryByText(new RegExp(en.diagnostics.fileCodexConfig))
  ).not.toBeInTheDocument()

  // Both fixes stage a run for review rather than writing anything.
  await userEvent.click(within(list).getByRole("button", { name: en.shell.upgrade }))
  expect(useAppStore.getState().panelOpen).toBe(true)
  await userEvent.click(within(list).getByRole("button", { name: en.diagnostics.restore }))
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("stages every selected CLI upgrade as one reviewed batch", async () => {
  useAppStore.setState({
    detections: {
      "claude-code": { installed: true, version: "1.0.0" },
      codex: { installed: true, version: "1.0.0" },
    },
    latestVersions: { "claude-code": "2.0.0", codex: "2.0.0" },
    cliManagers: {},
  })
  renderFrame()

  const list = screen.getByRole("region", { name: en.diagnostics.title })
  const titles = [
    en.diagnostics.upgradeTitle(en.catalog.cli["claude-code"].title, "2.0.0"),
    en.diagnostics.upgradeTitle(en.catalog.cli.codex.title, "2.0.0"),
  ]
  for (const title of titles) {
    await userEvent.click(
      within(list).getByRole("checkbox", { name: en.diagnostics.selectRow(title) })
    )
  }
  await userEvent.click(
    within(list).getByRole("button", { name: en.diagnostics.batch["upgrade-cli"](2) })
  )

  await waitFor(() => expect(api.runCommand).toHaveBeenCalledTimes(2))
})

it("ranks a blocking finding above an optional one", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  ;(api.readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p === paths.claudeSettings ? "{ not json" : ""
  )
  ;(api.pathExists as jest.Mock).mockImplementation(
    async (p: string) => p === `${paths.claudeSettings}${BACKUP_SUFFIX}`
  )
  renderDashboard()
  await screen.findByText(en.diagnostics.configInvalidTitle(en.diagnostics.fileClaudeSettings))
  const list = screen.getByRole("region", { name: en.diagnostics.title })
  const rows = within(list).getAllByRole("listitem")
  expect(rows[0]).toHaveTextContent(
    en.diagnostics.configInvalidTitle(en.diagnostics.fileClaudeSettings)
  )
  expect(rows[rows.length - 1]).toHaveTextContent(/2\.0\.0/)
})

it("says everything is fine when there is nothing to fix", async () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderDashboard()
  await screen.findByText("my-custom") // flush the async scan
  expect(await screen.findByText(en.dashboard.healthAllGood)).toBeInTheDocument()
})

it("names the missing agent as the blocking finding on a bare machine", async () => {
  renderDashboard()
  await screen.findByText("my-custom")
  const list = screen.getByRole("region", { name: en.diagnostics.title })
  expect(within(list).getByText(en.diagnostics.noAgentTitle)).toBeInTheDocument()
  await userEvent.click(within(list).getByRole("button", { name: en.diagnostics.setUp }))
  expect(useAppStore.getState().onboardingOpen).toBe(true)
})

it("truncates a long list and hands off to the owning section", async () => {
  const ids = ["srv-a", "srv-b", "srv-c", "srv-d", "srv-e", "srv-f"]
  ;(api.readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p === paths.claudeConfig
      ? JSON.stringify({ mcpServers: Object.fromEntries(ids.map((id) => [id, {}])) })
      : ""
  )

  const { onNavigate } = renderDashboard()

  // Five of six rendered; the sixth only reachable through the MCP section.
  expect(await screen.findByText("srv-a")).toBeInTheDocument()
  expect(screen.getByText("srv-e")).toBeInTheDocument()
  expect(screen.queryByText("srv-f")).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: new RegExp(en.dashboard.viewAll(6)) }))
  expect(onNavigate).toHaveBeenCalledWith("mcp")
})

it("shows the quick-start card on a fresh, empty setup", async () => {
  renderDashboard()
  expect(screen.getByText(en.quickStart.title)).toBeInTheDocument()
  await screen.findByText("my-custom") // flush the async scan
})

it("reopens the welcome wizard from the quick-start card", async () => {
  renderDashboard()
  await userEvent.click(screen.getByRole("button", { name: en.quickStart.openGuide }))
  expect(useAppStore.getState().onboardingOpen).toBe(true)
})

it("hides the quick-start card once an assistant is installed", async () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderDashboard()
  await screen.findByText("my-custom") // flush the async scan
  expect(screen.queryByText(en.quickStart.title)).not.toBeInTheDocument()
})

it("permanently hides the quick-start card on Don't show again", async () => {
  renderDashboard()
  await userEvent.click(screen.getByRole("button", { name: en.quickStart.dismiss }))
  expect(screen.queryByText(en.quickStart.title)).not.toBeInTheDocument()
  expect(useAppStore.getState().settings.quickStartDismissed).toBe(true)
  expect(saveSettings).toHaveBeenCalledWith({ quickStartDismissed: true })
})

it("says a rescan is in flight rather than dating the reading it is replacing", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderFrame({ scanning: true })

  const status = screen.getByRole("region", { name: en.dashboard.statusSummary })
  expect(within(status).getByText(en.dashboard.scanning)).toBeInTheDocument()
  // The old timestamp would still be true of the data on screen, and completely
  // beside the point while it is being replaced.
  expect(within(status).queryByText(/scanned/i)).not.toBeInTheDocument()
})

it("dates the reading once a scan has landed", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderFrame()

  const status = screen.getByRole("region", { name: en.dashboard.statusSummary })
  expect(within(status).getByText(/scanned/i)).toBeInTheDocument()
})

it("names the value and the destination on every status readout", async () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  const { onNavigate } = renderFrame()

  // Visually these are five bare numbers; read out, they have to say where they
  // lead and what they are counting.
  const mcp = screen.getByRole("button", {
    name: en.dashboard.readoutAction(en.dashboard.overviewMcp, "0", en.dashboard.sectionMcp),
  })
  await userEvent.click(mcp)
  expect(onNavigate).toHaveBeenCalledWith("mcp")

  for (const [label, section] of [
    [en.dashboard.overviewSkills, en.dashboard.sectionSkills],
    [en.dashboard.overviewProviders, en.dashboard.sectionCcswitch],
  ] as const) {
    expect(
      screen.getByRole("button", { name: en.dashboard.readoutAction(label, "0", section) })
    ).toBeInTheDocument()
  }
})
