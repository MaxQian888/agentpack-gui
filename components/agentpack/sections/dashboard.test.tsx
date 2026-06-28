jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands")

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as api from "@/lib/tauri/commands"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import type { Paths } from "@/lib/agentpack/types"
import { DashboardSection } from "./dashboard"

const paths: Paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeSkillsDir: "/h/.claude/skills",
  codexConfig: "/h/.codex/config.toml",
  codexSkillsDir: "/h/.codex/skills",
  ccSwitchSettings: "/h/.cc-switch/settings.json",
  ccSwitchDb: "/h/.cc-switch/cc-switch.db",
  os: "mac",
}

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ detections: {}, paths, panelOpen: false, dryRun: true })
  ;(api.readTextFile as jest.Mock).mockResolvedValue("")
  ;(api.listDir as jest.Mock).mockResolvedValue([])
  ;(api.ccLoadProviders as jest.Mock).mockResolvedValue([])
  ;(api.pathExists as jest.Mock).mockResolvedValue(false)
  ;(api.runCommand as jest.Mock).mockImplementation(async (_cmd, onLine) => {
    onLine("my-custom: npx -y my-custom-mcp")
    return 0
  })
})

function renderDashboard() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <DashboardSection />
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
  // claude mcp list returned a non-registry id → classified as custom.
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
  ;(api.listDir as jest.Mock).mockImplementation(async (p: string) =>
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
  await userEvent.click(screen.getAllByRole("button", { name: "✕" })[0])
  await userEvent.click(screen.getAllByRole("button", { name: /^restore backup$/i })[0])
  await userEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[0])
  await userEvent.click(screen.getByRole("button", { name: /apply/i }))

  expect(useAppStore.getState().panelOpen).toBe(true)
})
