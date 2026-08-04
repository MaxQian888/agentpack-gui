jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/updater", () => ({
  getAppVersion: jest.fn().mockResolvedValue("1.0.0"),
  checkForUpdate: jest.fn(),
  downloadAndInstallUpdate: jest.fn(),
  restartApp: jest.fn(),
}))
jest.mock("@/lib/tauri/settings", () => ({
  saveSettings: jest.fn().mockResolvedValue(undefined),
  DEFAULT_SETTINGS: {
    autoCheckUpdates: true,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    onboardingProgress: null,
    quickStartDismissed: false,
  },
}))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn(), revealPath: jest.fn() }))
jest.mock("@/lib/tauri/os", () => ({
  osSummary: jest.fn().mockResolvedValue("macOS 15.3 · aarch64"),
}))
jest.mock("@/lib/tauri/shortcut", () => ({
  DEFAULT_SUMMON_SHORTCUT: "CommandOrControl+Shift+A",
  registerSummonShortcut: jest.fn().mockResolvedValue(true),
  unregisterSummonShortcut: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { checkForUpdate, downloadAndInstallUpdate, restartApp } from "@/lib/tauri/updater"
import { saveSettings } from "@/lib/tauri/settings"
import {
  DEFAULT_SUMMON_SHORTCUT,
  registerSummonShortcut,
  unregisterSummonShortcut,
} from "@/lib/tauri/shortcut"
import { revealPath } from "@/lib/tauri/system"
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
    settings: {
      autoCheckUpdates: true,
      skippedVersion: null,
      lastCheckAt: null,
      onboarded: true,
      onboardingProgress: null,
      quickStartDismissed: false,
      ghMirrorPrefix: null,
      skillRepoSources: [],
      proxy: null,
      summonShortcut: null,
      monthlySubscriptionUsd: null,
      providerBackend: "native",
    },
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
})

it("persists the auto-check preference on toggle", async () => {
  renderAbout()
  await userEvent.click(screen.getByRole("switch", { name: en.about.autoCheckLabel }))
  expect(saveSettings).toHaveBeenCalledWith({ autoCheckUpdates: false })
})

it("claims the global hotkey and persists it once the OS grants it", async () => {
  ;(registerSummonShortcut as jest.Mock).mockResolvedValue(true)
  renderAbout()
  await userEvent.click(screen.getByRole("switch", { name: en.about.summonShortcutLabel }))
  await waitFor(() =>
    expect(saveSettings).toHaveBeenCalledWith({ summonShortcut: DEFAULT_SUMMON_SHORTCUT })
  )
})

it("keeps the hotkey off and explains why when the accelerator is taken", async () => {
  ;(registerSummonShortcut as jest.Mock).mockResolvedValue(false)
  renderAbout()
  await userEvent.click(screen.getByRole("switch", { name: en.about.summonShortcutLabel }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(en.about.shortcutTaken(DEFAULT_SUMMON_SHORTCUT))
  )
  expect(saveSettings).not.toHaveBeenCalledWith(
    expect.objectContaining({ summonShortcut: DEFAULT_SUMMON_SHORTCUT })
  )
})

it("releases the hotkey when switched back off", async () => {
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, summonShortcut: DEFAULT_SUMMON_SHORTCUT },
  })
  renderAbout()
  await userEvent.click(screen.getByRole("switch", { name: en.about.summonShortcutLabel }))
  await waitFor(() =>
    expect(unregisterSummonShortcut).toHaveBeenCalledWith(DEFAULT_SUMMON_SHORTCUT)
  )
  expect(saveSettings).toHaveBeenCalledWith({ summonShortcut: null })
})

it("reopens the welcome wizard on demand", async () => {
  useAppStore.setState({ onboardingOpen: false })
  renderAbout()
  await userEvent.click(screen.getByRole("button", { name: en.welcome.reopen }))
  expect(useAppStore.getState().onboardingOpen).toBe(true)
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
