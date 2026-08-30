jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/updater", () => ({
  getAppVersion: jest.fn().mockResolvedValue("1.0.0"),
  checkForUpdate: jest.fn(),
  downloadAndInstallUpdate: jest.fn(),
  restartApp: jest.fn(),
}))
// Real DEFAULT_SETTINGS, mocked writer: a hand-copied settings fixture goes
// stale the moment a preference is added, which is what it did.
jest.mock("@/lib/tauri/settings", () => ({
  ...jest.requireActual("@/lib/tauri/settings"),
  saveSettings: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn(), revealPath: jest.fn() }))
jest.mock("@/lib/tauri/os", () => ({
  osSummary: jest.fn().mockResolvedValue("macOS 15.3 · aarch64"),
}))
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { checkForUpdate, downloadAndInstallUpdate, restartApp } from "@/lib/tauri/updater"
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/tauri/settings"
import { openUrl, revealPath } from "@/lib/tauri/system"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { AboutSection } from "./about"

const mockedCheck = checkForUpdate as jest.Mock
const info = { version: "2.0.0", currentVersion: "1.0.0", body: "New stuff" }

beforeEach(() => {
  useAppStore.setState({
    appVersion: null,
    updateState: "idle",
    updateInfo: null,
    downloadProgress: 0,
    settings: { ...DEFAULT_SETTINGS, onboarded: true },
    paths: null,
  })
})

function renderAbout() {
  return render(
    <I18nProvider>
      <AboutSection />
    </I18nProvider>
  )
}

it("shows the app version resolved on mount", async () => {
  renderAbout()
  expect(await screen.findByText(en.about.currentVersion("1.0.0"))).toBeInTheDocument()
})

it("organizes status, the update panel, and links as one workbench", async () => {
  renderAbout()
  await screen.findByText(en.about.currentVersion("1.0.0"))

  expect(screen.getByRole("region", { name: en.about.summaryLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: en.about.updatePanel })).toBeInTheDocument()
  expect(screen.getByRole("complementary", { name: en.about.actionsLabel })).toBeInTheDocument()
  expect(screen.getByText(en.about.locationsTitle)).toBeInTheDocument()
  expect(screen.getByText(en.about.sourceTitle)).toBeInTheDocument()
})

/**
 * The preferences this section used to carry moved to the Preferences tab. If
 * one reappears here it is a duplicate writer for the same setting, which is
 * exactly how two switches end up disagreeing about a global hotkey.
 */
it("leaves every user preference to the Preferences section", async () => {
  renderAbout()
  await screen.findByText(en.about.currentVersion("1.0.0"))

  expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  expect(screen.queryByText(en.preferences.languageLabel)).not.toBeInTheDocument()
  expect(screen.queryByText(en.preferences.osLabel)).not.toBeInTheDocument()
})

it("reports up to date when no update is found", async () => {
  mockedCheck.mockResolvedValueOnce(null)
  renderAbout()
  await userEvent.click(screen.getByRole("button", { name: en.about.checkNow }))
  expect(await screen.findByText(en.about.upToDate)).toBeInTheDocument()
})

it("surfaces an available update, then installs and restarts", async () => {
  mockedCheck.mockResolvedValueOnce(info)
  ;(downloadAndInstallUpdate as jest.Mock).mockImplementationOnce(
    async (cb: (n: number) => void) => {
      cb(50)
    }
  )
  renderAbout()
  await userEvent.click(screen.getByRole("button", { name: en.about.checkNow }))

  expect(await screen.findByText(en.about.updateAvailable("2.0.0"))).toBeInTheDocument()
  expect(screen.getByText("New stuff")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: en.about.installAndRestart }))
  await waitFor(() => expect(downloadAndInstallUpdate).toHaveBeenCalled())
  await waitFor(() => expect(restartApp).toHaveBeenCalled())
})

it("skips a version and persists the choice", async () => {
  mockedCheck.mockResolvedValueOnce(info)
  renderAbout()
  await userEvent.click(screen.getByRole("button", { name: en.about.checkNow }))
  await screen.findByText(en.about.updateAvailable("2.0.0"))

  await userEvent.click(screen.getByRole("button", { name: en.about.skipVersion }))
  expect(saveSettings).toHaveBeenCalledWith({ skippedVersion: "2.0.0" })
  await waitFor(() =>
    expect(screen.queryByText(en.about.updateAvailable("2.0.0"))).not.toBeInTheDocument()
  )
})

it("toasts when the update check fails", async () => {
  mockedCheck.mockRejectedValueOnce(new Error("offline"))
  renderAbout()
  await userEvent.click(screen.getByRole("button", { name: en.about.checkNow }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.about.checkFailed))
  expect(screen.getByRole("alert")).toHaveTextContent(en.about.updateError("offline"))
})

it("opens the releases page", async () => {
  renderAbout()
  await userEvent.click(screen.getByRole("button", { name: en.about.viewOnGitHub }))
  expect(openUrl).toHaveBeenCalledWith(expect.stringContaining("/releases"))
})

it("reveals config folders when paths are known", async () => {
  useAppStore.setState({
    paths: {
      home: "/home",
      claudeSettings: "/home/.claude/settings.json",
      claudeConfig: "/home/.claude.json",
      claudeSkillsDir: "/home/.claude/skills",
      codexConfig: "/home/.codex/config.toml",
      codexAuth: "/home/.codex/auth.json",
      codexSkillsDir: "/home/.codex/skills",
      opencodeConfig: "/home/.config/opencode/opencode.json",
      opencodeSkillsDir: "/home/.config/opencode/skills",
      piSettings: "/home/.pi/agent/settings.json",
      piAuth: "/home/.pi/agent/auth.json",
      piTrust: "/home/.pi/agent/trust.json",
      piSessionsDir: "/home/.pi/agent/sessions",
      piNpmDir: "/home/.pi/agent/npm",
      piGitDir: "/home/.pi/agent/git",
      piSkillsDir: "/home/.pi/agent/skills",
      agentsSkillsDir: "/home/.agents/skills",
      ccSwitchSettings: "/home/.cc-switch/settings.json",
      ccSwitchDb: "/home/.cc-switch/db.sqlite",
      ccConnectDir: "/home/.cc-connect",
      ccConnectConfig: "/home/.cc-connect/config.toml",
      mcpDisabledStore: "/home/.agentpack/mcp-disabled.json",
      shellProfile: "/home/.zshrc",
      os: "mac",
    },
  })
  renderAbout()
  await userEvent.click(screen.getByRole("button", { name: en.about.openClaudeFolder }))
  expect(revealPath).toHaveBeenCalledWith("/home/.claude/settings.json")
})
