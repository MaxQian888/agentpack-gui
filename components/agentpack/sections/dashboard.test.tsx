jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
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
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as api from "@/lib/tauri/commands"
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/tauri/settings"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import type { Paths } from "@/lib/agentpack/types"
import { BACKUP_SUFFIX } from "@/lib/agentpack/plan"
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
  useAppStore.getState().resetPlan()
  useAppStore.setState({
    detections: {},
    paths,
    panelOpen: false,
    dryRun: true,
    onboardingOpen: false,
    settings: { ...DEFAULT_SETTINGS },
  })
  // User-scope MCP servers are now read from ~/.claude.json (not `claude mcp list`);
  // a non-registry id there should classify as custom.
  ;(api.readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p === paths.claudeConfig ? JSON.stringify({ mcpServers: { "my-custom": {} } }) : ""
  )
  ;(api.listSkills as jest.Mock).mockResolvedValue([])
  ;(api.ccLoadProviders as jest.Mock).mockResolvedValue([])
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
    <DashboardSection scan={scan} scanning={scanning} rescan={rescan} onNavigate={onNavigate} />
  )
}

function renderDashboard() {
  const onNavigate = jest.fn()
  render(
    <I18nProvider>
      <RunnerProvider>
        <DashboardHarness onNavigate={onNavigate} />
      </RunnerProvider>
    </I18nProvider>
  )
  return { onNavigate }
}

it("renders the dashboard title and grouped sections", async () => {
  renderDashboard()
  expect(screen.getByText(/environment dashboard/i)).toBeInTheDocument()
  expect(screen.getByText(/MCP servers/i)).toBeInTheDocument()
  await screen.findByText("my-custom") // flush the async scan
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
    dryRun: true,
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
  ;(api.ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "x", app_type: "claude", name: "Prov", settings_config: "{}", is_current: false },
  ] as Provider[])

  renderDashboard()

  // Wait for the async scan, then assert scan- and store-derived content.
  expect(await screen.findByText("Prov")).toBeInTheDocument()
  expect(screen.getByText(/update → 2\.0\.0/)).toBeInTheDocument()
  expect(screen.getByText(/configured/i)).toBeInTheDocument()

  // The overview is read-only now: removing an MCP server / skill / provider,
  // uninstalling a CLI and applying cc-switch visible apps all moved to the
  // sections that own them. Only the health banner's fixes stay here.
  expect(screen.queryByRole("button", { name: /uninstall/i })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /^remove/i })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: /apply/i })).not.toBeInTheDocument()
})

it("leads with a health banner and runs its fixes", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
    dryRun: true,
  })
  // settings.json exists but doesn't parse — a real problem — and it has a
  // backup, so the banner can offer to restore it.
  ;(api.readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p === paths.claudeSettings ? "{ not json" : ""
  )
  ;(api.pathExists as jest.Mock).mockImplementation(
    async (p: string) => p === `${paths.claudeSettings}${BACKUP_SUFFIX}`
  )

  renderDashboard()

  // Two issues: the upgradable CLI and the unparsable settings.json. The absent
  // codex config.toml is NOT one — a file that was never there on a machine
  // without Codex is the normal state, not something to fix.
  expect(await screen.findByText(en.dashboard.healthNeedsAttention(2))).toBeInTheDocument()
  expect(
    screen.getByText(
      en.dashboard.healthConfig(en.dashboard.fileClaudeSettings, en.dashboard.configInvalid)
    )
  ).toBeInTheDocument()
  expect(screen.queryByText(new RegExp(en.dashboard.fileCodexConfig))).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: en.shell.upgrade }))
  expect(useAppStore.getState().panelOpen).toBe(true)

  await userEvent.click(screen.getByRole("button", { name: en.dashboard.restore }))
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("says everything is fine when there is nothing to fix", async () => {
  renderDashboard()
  await screen.findByText("my-custom") // flush the async scan
  expect(screen.getByText(en.dashboard.healthAllGood)).toBeInTheDocument()
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
