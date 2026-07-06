jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri/commands", () => ({
  detectCli: jest.fn(async () => ({ installed: false })),
  ccLoadProviders: jest.fn(async () => [
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: false },
  ]),
  runCommand: jest.fn(async (_cmd: unknown, onLine: (l: string) => void) => {
    onLine("installing")
    return 0
  }),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  ccWriteProvider: jest.fn(async () => ["ok"]),
  launchCcSwitch: jest.fn(async () => undefined),
  isProcessRunning: jest.fn(async () => false),
  pathExists: jest.fn(async () => true),
  backupList: jest.fn(async () => [] as unknown[]),
  backupSnapshot: jest.fn(async () => ({ id: "snapshot-1", ts: 1, reason: "x", files: [] })),
  backupRestore: jest.fn(async () => ["/h/.claude/settings.json"]),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { toast } from "sonner"
import {
  ccWriteProvider,
  runCommand,
  writeTextFile,
  ccLoadProviders,
  readTextFile,
  isProcessRunning,
  detectCli,
  pathExists,
  launchCcSwitch,
  backupList,
  backupRestore,
} from "@/lib/tauri/commands"
import { CcSwitchSection } from "./ccswitch"
import { en } from "@/lib/i18n/en"

const CC_SETTINGS = "/h/.cc-switch/settings.json"
const paths = {
  ccSwitchSettings: CC_SETTINGS,
  ccSwitchDb: "/h/.cc-switch/cc-switch.db",
  claudeSettings: "/h/.claude/settings.json",
  codexConfig: "/h/.codex/config.toml",
  codexAuth: "/h/.codex/auth.json",
  os: "mac",
} as never

beforeEach(() => {
  jest.clearAllMocks()
  // clearAllMocks keeps implementations, so restore the defaults that individual
  // tests override with a persistent mockResolvedValue (running=false, and
  // cc-switch detected=false + DB present so the auto-init flow stays dormant).
  ;(isProcessRunning as jest.Mock).mockResolvedValue(false)
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: false })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  useAppStore.setState({ paths, dryRun: false, panelOpen: false, osOverride: null })
})

function renderCc() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <CcSwitchSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("lists providers from the DB", async () => {
  renderCc()
  expect(await screen.findByText("Mine")).toBeInTheDocument()
})

it("installs cc-switch via the runner when not detected", async () => {
  renderCc()
  const install = await screen.findByRole("button", { name: en.ccswitch.install })
  await userEvent.click(install)
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
})

it("applies the visible-apps selection", async () => {
  renderCc()
  await userEvent.click(screen.getByRole("button", { name: en.shell.apply }))
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith(CC_SETTINGS, expect.any(String)))
})

it("toggles a visible-app switch", async () => {
  renderCc()
  const geminiSwitch = await screen.findByLabelText(en.ccswitch.appLabels.gemini)
  // "{}" on disk → cc-switch treats absent apps as shown → the switch loads checked.
  await waitFor(() => expect(geminiSwitch).toBeChecked())
  await userEvent.click(geminiSwitch)
  expect(geminiSwitch).not.toBeChecked()
})

it("adds a provider through the form", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.addProvider }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldName), "New Provider")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "add" }))
  )
})

it("re-opens the form with the attempted values when a write fails", async () => {
  ;(ccWriteProvider as jest.Mock).mockRejectedValueOnce("cc-switch is running")
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.addProvider }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldName), "Relay")
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldBaseUrl), "https://r")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  // The failed write must not discard the user's input — the form comes back
  // pre-filled with exactly what they typed so they can fix and retry.
  await waitFor(() => expect(screen.getByLabelText(en.ccswitch.fieldName)).toHaveValue("Relay"))
  expect(screen.getByLabelText(en.ccswitch.fieldBaseUrl)).toHaveValue("https://r")
})

it("opens the edit form for an existing provider", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionEdit }))
  expect(screen.getByText(en.ccswitch.formEditTitle)).toBeInTheDocument()
})

it("echoes the stored provider config back into the edit form", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([
    {
      id: "1",
      app_type: "claude",
      name: "Mine",
      settings_config: JSON.stringify({
        env: { ANTHROPIC_AUTH_TOKEN: "tok", ANTHROPIC_BASE_URL: "https://relay" },
      }),
      is_current: false,
    },
  ])
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionEdit }))
  expect(screen.getByLabelText(en.ccswitch.fieldName)).toHaveValue("Mine")
  expect(screen.getByLabelText(en.ccswitch.fieldBaseUrl)).toHaveValue("https://relay")
})

it("sets a provider as current", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionSetCurrent }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(
    within(dialog).getByRole("button", { name: en.ccswitch.rowActionSetCurrent })
  )
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "setCurrent" }))
  )
})

it("deletes a non-current provider after confirmation", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionDelete }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.rowActionDelete }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "delete" }))
  )
})

it("offers recommended provider presets", async () => {
  renderCc()
  const presetBtn = screen.getAllByRole("button").find((b) => b.querySelector("svg"))
  expect(presetBtn).toBeTruthy()
})

it("falls back to the no-db message when the list is empty", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([])
  renderCc()
  expect(await screen.findByText(en.ccswitch.empty)).toBeInTheDocument()
})

it("auto-launches cc-switch to create the DB when detected but the DB is missing", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true })
  // No DB on the initial scan → needsDb → auto-launch (no click); the launch
  // creates it, so the first poll tick finds it and the section flips to ready.
  ;(pathExists as jest.Mock).mockResolvedValueOnce(false).mockResolvedValue(true)
  renderCc()
  await waitFor(() => expect(launchCcSwitch).toHaveBeenCalledTimes(1))
  expect(
    await screen.findByText(en.ccswitch.dbReady, undefined, { timeout: 3000 })
  ).toBeInTheDocument()
})

it("reflects the visible-apps selection read from disk", async () => {
  // A gemini=true settings.json on disk must flip the switch on load, instead of
  // always showing the DEFAULT_VISIBLE_APPS (gemini=false).
  ;(readTextFile as jest.Mock).mockResolvedValueOnce(
    JSON.stringify({ visibleApps: { gemini: true } })
  )
  renderCc()
  await waitFor(() => expect(screen.getByLabelText(en.ccswitch.appLabels.gemini)).toBeChecked())
})

it("syncs the live config when setting a provider as current", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionSetCurrent }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(
    within(dialog).getByRole("button", { name: en.ccswitch.rowActionSetCurrent })
  )
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "setCurrent" }))
  )
  // The claude provider's env is written into the live settings.json too.
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith("/h/.claude/settings.json", expect.any(String))
  )
})

it("syncs the live config after editing the current provider", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: true },
  ])
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionEdit }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldToken), "new-token")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "update" }))
  )
  // The edit lands on the live provider, so settings.json is rewritten with it.
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.claude/settings.json",
      expect.stringContaining("new-token")
    )
  )
})

it("does not sync when editing a provider that is not current", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionEdit }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldToken), "new-token")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "update" }))
  )
  expect(writeTextFile).not.toHaveBeenCalledWith("/h/.claude/settings.json", expect.any(String))
})

it("skips the live-config sync when the provider write fails", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: true },
  ])
  ;(ccWriteProvider as jest.Mock).mockRejectedValueOnce("cc-switch is running")
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionEdit }))
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await waitFor(() => expect(ccWriteProvider).toHaveBeenCalled())
  // The DB write failed, so the live config must stay untouched.
  expect(writeTextFile).not.toHaveBeenCalledWith("/h/.claude/settings.json", expect.any(String))
})

it("syncs the first provider of an app live (the DB marks it current)", async () => {
  renderCc()
  await screen.findByText("Mine") // claude provider exists but is not current
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.addProvider }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldName), "First")
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldToken), "tok-1")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "add" }))
  )
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.claude/settings.json",
      expect.stringContaining("tok-1")
    )
  )
})

it("renders the backup history and restores an entry", async () => {
  ;(backupList as jest.Mock).mockResolvedValue([
    { id: "snapshot-9", ts: 1700000000000, reason: "provider write", files: [{}, {}] },
  ])
  renderCc()
  expect(await screen.findByText("provider write")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.restore }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.restore }))
  await waitFor(() => expect(backupRestore).toHaveBeenCalledWith("snapshot-9"))
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en.ccswitch.restored))
})

it("toasts an error when a restore fails", async () => {
  ;(backupList as jest.Mock).mockResolvedValue([
    { id: "snapshot-9", ts: 1700000000000, reason: "provider write", files: [{}, {}] },
  ])
  ;(backupRestore as jest.Mock).mockRejectedValueOnce("cc-switch is running")
  renderCc()
  await screen.findByText("provider write")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.restore }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.restore }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccswitch.restoreFailed))
})

it("blocks editing and warns while cc-switch is running", async () => {
  ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  renderCc()
  await screen.findByText("Mine")
  expect(await screen.findByText(en.ccswitch.runningTitle)).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByRole("button", { name: en.ccswitch.rowActionEdit })).toBeDisabled()
  )
  expect(screen.getByRole("button", { name: en.ccswitch.addProvider })).toBeDisabled()
  expect(ccWriteProvider).not.toHaveBeenCalled()
})

it("toasts and stops loading when the initial scan fails", async () => {
  ;(ccLoadProviders as jest.Mock).mockRejectedValueOnce(new Error("db locked"))
  renderCc()
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccswitch.loadFailed))
  // The failure must not wedge the UI in a permanent loading state.
  await waitFor(() => expect(screen.queryByText(en.ccswitch.loading)).not.toBeInTheDocument())
})

it("shows a loading indicator before the first scan resolves", async () => {
  renderCc()
  // Synchronously after mount the async reload() has not resolved yet, so the
  // providers/backups areas show a spinner rather than "database not found".
  expect(screen.getAllByText(en.ccswitch.loading).length).toBeGreaterThan(0)
  // Let the whole scan settle so its state updates don't fire outside act().
  await waitFor(() => expect(screen.queryByText(en.ccswitch.loading)).not.toBeInTheDocument())
})
