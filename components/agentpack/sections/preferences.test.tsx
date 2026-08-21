jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/settings", () => ({
  ...jest.requireActual("@/lib/tauri/settings"),
  saveSettings: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@/lib/tauri/shortcut", () => ({
  DEFAULT_SUMMON_SHORTCUT: "CommandOrControl+Shift+A",
  registerSummonShortcut: jest.fn().mockResolvedValue(true),
  unregisterSummonShortcut: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", resolvedTheme: "light", setTheme: mockSetTheme }),
}))
const mockSetTheme = jest.fn()
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { isTauri } from "@/lib/tauri"
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/tauri/settings"
import {
  DEFAULT_SUMMON_SHORTCUT,
  registerSummonShortcut,
  unregisterSummonShortcut,
} from "@/lib/tauri/shortcut"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { PreferencesSection } from "./preferences"

const prefs = en.preferences

beforeEach(() => {
  jest.clearAllMocks()
  ;(isTauri as jest.Mock).mockReturnValue(true)
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, onboarded: true },
    osOverride: null,
    onboardingOpen: false,
    tourActive: false,
  })
})

function renderPreferences() {
  return render(
    <I18nProvider>
      <PreferencesSection />
    </I18nProvider>
  )
}

it("groups every preference under a named heading", () => {
  renderPreferences()
  expect(screen.getByRole("region", { name: prefs.summaryLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: prefs.panelLabel })).toBeInTheDocument()
  for (const group of [prefs.appearanceTitle, prefs.startupTitle, prefs.systemTitle]) {
    expect(screen.getByRole("region", { name: group })).toBeInTheDocument()
  }
})

it("switches the theme without persisting it itself", async () => {
  renderPreferences()
  await userEvent.click(screen.getByRole("radio", { name: prefs.themeDark }))
  expect(mockSetTheme).toHaveBeenCalledWith("dark")
  // next-themes owns its own storage; writing it to settings.json too would give
  // the theme two sources of truth that can disagree after an import.
  expect(saveSettings).not.toHaveBeenCalled()
})

it("persists the interface scale", async () => {
  renderPreferences()
  await userEvent.click(screen.getByRole("radio", { name: prefs.scaleValue(125) }))
  expect(saveSettings).toHaveBeenCalledWith({ uiScale: 125 })
  expect(useAppStore.getState().settings.uiScale).toBe(125)
})

it("persists the reduced-motion override", async () => {
  renderPreferences()
  await userEvent.click(screen.getByRole("switch", { name: prefs.motionLabel }))
  expect(saveSettings).toHaveBeenCalledWith({ reduceMotion: true })
})

it("persists the startup screen", async () => {
  renderPreferences()
  await userEvent.selectOptions(screen.getByLabelText(prefs.startupSectionLabel), "history")
  expect(saveSettings).toHaveBeenCalledWith({ startupSection: "history" })
})

it("returns the startup screen to the default", async () => {
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, startupSection: "history" },
  })
  renderPreferences()
  const select = screen.getByLabelText(prefs.startupSectionLabel)
  await userEvent.selectOptions(select, prefs.startupDefault)
  expect(saveSettings).toHaveBeenCalledWith({ startupSection: null })
})

it("persists the auto-check preference on toggle", async () => {
  renderPreferences()
  await userEvent.click(screen.getByRole("switch", { name: prefs.autoCheckLabel }))
  expect(saveSettings).toHaveBeenCalledWith({ autoCheckUpdates: false })
})

it("brings the quick-start card back", async () => {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, quickStartDismissed: true } })
  renderPreferences()
  await userEvent.click(screen.getByRole("switch", { name: prefs.quickStartLabel }))
  expect(saveSettings).toHaveBeenCalledWith({ quickStartDismissed: false })
})

it("claims the global hotkey and persists it once the OS grants it", async () => {
  ;(registerSummonShortcut as jest.Mock).mockResolvedValue(true)
  renderPreferences()
  await userEvent.click(screen.getByRole("switch", { name: prefs.hotkeyLabel }))
  await waitFor(() =>
    expect(saveSettings).toHaveBeenCalledWith({ summonShortcut: DEFAULT_SUMMON_SHORTCUT })
  )
})

it("keeps the hotkey off and explains why when the accelerator is taken", async () => {
  ;(registerSummonShortcut as jest.Mock).mockResolvedValue(false)
  renderPreferences()
  await userEvent.click(screen.getByRole("switch", { name: prefs.hotkeyLabel }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(prefs.hotkeyTaken(DEFAULT_SUMMON_SHORTCUT))
  )
  expect(saveSettings).not.toHaveBeenCalledWith(
    expect.objectContaining({ summonShortcut: DEFAULT_SUMMON_SHORTCUT })
  )
})

it("releases the hotkey when switched back off", async () => {
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, summonShortcut: DEFAULT_SUMMON_SHORTCUT },
  })
  renderPreferences()
  await userEvent.click(screen.getByRole("switch", { name: prefs.hotkeyLabel }))
  await waitFor(() =>
    expect(unregisterSummonShortcut).toHaveBeenCalledWith(DEFAULT_SUMMON_SHORTCUT)
  )
  expect(saveSettings).toHaveBeenCalledWith({ summonShortcut: null })
})

/**
 * Web mode can apply the theme, the language and the scale — they are the
 * browser's, not the machine's — but it can neither remember them nor claim a
 * system-wide accelerator. It says both rather than showing a bare disabled
 * switch, per design.md § 7.
 */
it("admits what it cannot do outside the desktop app", () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  renderPreferences()

  expect(screen.getByText(prefs.webNote)).toBeInTheDocument()
  expect(screen.getByRole("switch", { name: prefs.hotkeyLabel })).toBeDisabled()
  expect(screen.getByText(prefs.hotkeyDesktopOnly)).toBeInTheDocument()
})

it("targets another OS for generated install commands", async () => {
  renderPreferences()
  await userEvent.selectOptions(screen.getByLabelText(prefs.osLabel), "win")
  expect(useAppStore.getState().osOverride).toBe("win")
})

it("opens both guided help entry points", async () => {
  renderPreferences()
  await userEvent.click(screen.getByRole("button", { name: en.welcome.reopen }))
  expect(useAppStore.getState().onboardingOpen).toBe(true)
  await userEvent.click(screen.getByRole("button", { name: en.tour.start }))
  expect(useAppStore.getState().tourActive).toBe(true)
})

it("restores this page's defaults and leaves everything else alone", async () => {
  useAppStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      uiScale: 125,
      reduceMotion: true,
      startupSection: "history",
      autoCheckUpdates: false,
      quickStartDismissed: true,
      // Not this page's business: a reset that dropped the proxy would take the
      // route to npm with it.
      proxy: { mode: "manual", httpUrl: "http://127.0.0.1:7890", targets: ["npm"] },
      ghMirrorPrefix: "https://mirror/",
    },
    osOverride: "win",
  })
  renderPreferences()
  await userEvent.click(screen.getByRole("button", { name: prefs.defaultsAction }))

  expect(mockSetTheme).toHaveBeenCalledWith("system")
  expect(useAppStore.getState().osOverride).toBeNull()
  expect(saveSettings).toHaveBeenCalledWith({
    uiScale: 100,
    reduceMotion: false,
    startupSection: null,
    autoCheckUpdates: true,
    quickStartDismissed: false,
  })
  const after = useAppStore.getState().settings
  expect(after.proxy).toEqual({
    mode: "manual",
    httpUrl: "http://127.0.0.1:7890",
    targets: ["npm"],
  })
  expect(after.ghMirrorPrefix).toBe("https://mirror/")
})
