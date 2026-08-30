import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import type { Paths } from "@/lib/agentpack/types"
import { PiSection } from "./index"
import { usePiManagementController } from "../../pi-controller"
import {
  piAuthStatus,
  piManagementScan,
  piPackageSearch,
  piSessionDirsSet,
} from "@/lib/tauri/commands"
import { pickFolder } from "@/lib/tauri/dialog"

const run = jest.fn(async () => [])

jest.mock("@/lib/tauri/commands", () => ({
  launchPiInteractive: jest.fn(async () => undefined),
  piAuthStatus: jest.fn(async () => ({ installed: true, providers: [] })),
  piManagementScan: jest.fn(async (scope) => ({
    installed: true,
    scope: scope.kind,
    cwd: scope.cwd,
    settingsPath:
      scope.kind === "project" ? `${scope.cwd}/.pi/settings.json` : "/h/.pi/agent/settings.json",
    packages: [],
    trust: { state: "ask", source: "default" },
    errors: [],
  })),
  piPackageSearch: jest.fn(async () => []),
  piSessionDirsGet: jest.fn(async () => []),
  piSessionDirsSet: jest.fn(async (dirs) => dirs),
  pathExists: jest.fn(async () => true),
  readTextFile: jest.fn(async () => '{"packages":[]}'),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickFolder: jest.fn(async () => null) }))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn(async () => undefined) }))
jest.mock("../../run/runner-context", () => ({ useRunnerCtx: () => ({ run }) }))

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
  piSettings: "/h/.pi/agent/settings.json",
  piAuth: "/h/.pi/agent/auth.json",
  piTrust: "/h/.pi/agent/trust.json",
  piSessionsDir: "/h/.pi/agent/sessions",
  piNpmDir: "/h/.pi/agent/npm",
  piGitDir: "/h/.pi/agent/git",
  piSkillsDir: "/h/.pi/agent/skills",
  agentsSkillsDir: "/h/.agents/skills",
  ccSwitchSettings: "/h/.cc-switch/settings.json",
  ccSwitchDb: "/h/.cc-switch/db.sqlite",
  ccConnectDir: "/h/.cc-connect",
  ccConnectConfig: "/h/.cc-connect/config.toml",
  mcpDisabledStore: "/h/.agentpack/mcp-disabled.json",
  shellProfile: "/h/.zshrc",
  os: "mac",
}

function renderPi(onOpenClis = jest.fn()) {
  function Harness() {
    const controller = usePiManagementController(["/history/project"])
    return <PiSection controller={controller} onOpenClis={onOpenClis} />
  }
  return render(
    <I18nProvider>
      <Harness />
    </I18nProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  useAppStore.setState({ paths, detections: {} })
})

it("shows the CLIs install CTA without invoking Pi when it is missing", async () => {
  const onOpenClis = jest.fn()
  useAppStore.setState({ detections: { pi: { installed: false } } })
  renderPi(onOpenClis)
  await userEvent.click(screen.getByRole("button", { name: en.pi.installPi }))
  expect(onOpenClis).toHaveBeenCalled()
  expect(piManagementScan).not.toHaveBeenCalled()
  expect(piAuthStatus).not.toHaveBeenCalled()
})

it("switches to a selected project scope without recursively searching disk", async () => {
  useAppStore.setState({ detections: { pi: { installed: true, version: "0.84.4" } } })
  ;(pickFolder as jest.Mock).mockResolvedValue("/picked/project")
  renderPi()
  await waitFor(() => expect(piManagementScan).toHaveBeenCalledWith({ kind: "global" }))
  await userEvent.click(screen.getByRole("button", { name: en.pi.projectScope }))
  await userEvent.click(screen.getByRole("button", { name: en.pi.chooseFolder }))
  await waitFor(() =>
    expect(piManagementScan).toHaveBeenCalledWith({ kind: "project", cwd: "/picked/project" })
  )
  expect(localStorage.getItem("agentpack.pi.projects")).toContain("/picked/project")
})

it("uses no-refresh for automatic auth status and refreshes only on click", async () => {
  useAppStore.setState({ detections: { pi: { installed: true, version: "0.84.4" } } })
  ;(piAuthStatus as jest.Mock).mockResolvedValue({
    installed: true,
    providers: [{ provider: "anthropic", status: "valid", source: "authFile" }],
  })
  renderPi()
  await userEvent.click(screen.getByRole("tab", { name: en.pi.authentication }))
  await waitFor(() => expect(piAuthStatus).toHaveBeenCalledWith(false))
  expect(screen.getByText("anthropic")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.pi.refreshAuth }))
  await waitFor(() => expect(piAuthStatus).toHaveBeenCalledWith(true))
  expect(piPackageSearch).not.toHaveBeenCalled()
})

it("persists an explicitly selected additional Pi session folder", async () => {
  useAppStore.setState({ detections: { pi: { installed: true, version: "0.84.4" } } })
  ;(pickFolder as jest.Mock).mockResolvedValue("/history/pi-extra")
  renderPi()
  await userEvent.click(screen.getByRole("button", { name: en.pi.addSessionFolder }))
  await waitFor(() => expect(piSessionDirsSet).toHaveBeenCalledWith(["/history/pi-extra"]))
})
