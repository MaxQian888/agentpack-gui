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
function DashboardHarness() {
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
  return <DashboardSection scan={scan} scanning={scanning} rescan={rescan} />
}

function renderDashboard() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <DashboardHarness />
      </RunnerProvider>
    </I18nProvider>
  )
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

it("renders rich state and runs uninstall / remove / restore actions", async () => {
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
  ;(api.pathExists as jest.Mock).mockResolvedValue(true)

  renderDashboard()

  // Wait for the async scan, then assert scan- and store-derived content.
  expect(await screen.findByText("Prov")).toBeInTheDocument()
  expect(screen.getByText(/update → 2\.0\.0/)).toBeInTheDocument()
  expect(screen.getByText(/configured/i)).toBeInTheDocument()

  // Exercise the action handlers (dry-run → no real mutation).
  await userEvent.click(screen.getByRole("button", { name: /uninstall/i }))
  // The per-entity remove is now an icon button labelled "Remove <id>" (the
  // codex MCP "memory" and the claude skill "rust"); the bare "Remove" text
  // buttons below belong to the relay and provider rows.
  await userEvent.click(screen.getByRole("button", { name: `${en.dashboard.remove} memory` }))
  await userEvent.click(screen.getAllByRole("button", { name: /^restore backup$/i })[0])
  await userEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0])
  await userEvent.click(screen.getByRole("button", { name: /apply/i }))

  expect(useAppStore.getState().panelOpen).toBe(true)
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
