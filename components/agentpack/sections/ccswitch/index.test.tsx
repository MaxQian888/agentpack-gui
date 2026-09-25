jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@tauri-apps/plugin-dialog", () => ({
  open: jest.fn(async () => null),
  save: jest.fn(async () => null),
}))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri/settings", () => ({ saveSettings: jest.fn(async () => undefined) }))
jest.mock("@/lib/tauri/commands", () => ({
  detectCli: jest.fn(async () => ({ installed: false })),
  ccLoadProviders: jest.fn(async () => [
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: false },
  ]),
  providerLoad: jest.fn(async () => []),
  runCommand: jest.fn(async (_cmd: unknown, onLine: (l: string) => void) => {
    onLine("installing")
    return 0
  }),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  ccWriteProvider: jest.fn(async () => ["ok"]),
  ccSchemaStatus: jest.fn(async () => ({ exists: true, userVersion: 0, missingColumns: [] })),
  ccInitDb: jest.fn(async () => undefined),
  launchCcSwitch: jest.fn(async () => undefined),
  quitCcSwitch: jest.fn(async () => true),
  ccSwitchRunning: jest.fn(async () => false),
  loginStatus: jest.fn(async () => ({
    claude: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "not signed in" },
    codex: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "not signed in" },
    opencode: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "not signed in" },
  })),
  isProcessRunning: jest.fn(async () => false),
  pathExists: jest.fn(async () => true),
  backupList: jest.fn(async () => [] as unknown[]),
  backupSnapshot: jest.fn(async () => ({ id: "snapshot-1", ts: 1, reason: "x", files: [] })),
  backupRestore: jest.fn(async () => ({
    restoredPaths: ["/h/.claude/settings.json"],
    safetySnapshotId: "snapshot-safety",
  })),
}))

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerHarness } from "../../run/__testing__/harness"
import { useRunnerCtx } from "../../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { toast } from "sonner"
import {
  ccWriteProvider,
  runCommand,
  writeTextFile,
  ccLoadProviders,
  readTextFile,
  ccSwitchRunning,
  quitCcSwitch,
  launchCcSwitch,
  detectCli,
  pathExists,
  providerLoad,
  ccSchemaStatus,
  ccInitDb,
  loginStatus,
  backupList,
  backupRestore,
} from "@/lib/tauri/commands"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { CcSwitchSection } from "./index"
import { en } from "@/lib/i18n/en"
import { RECOMMENDED_PROVIDERS } from "@/lib/agentpack/ccswitch/preset"
import { saveSettings } from "@/lib/tauri/settings"

const CC_SETTINGS = "/h/.cc-switch/settings.json"
const paths = {
  ccSwitchSettings: CC_SETTINGS,
  ccSwitchDb: "/h/.cc-switch/cc-switch.db",
  claudeSettings: "/h/.claude/settings.json",
  codexConfig: "/h/.codex/config.toml",
  codexAuth: "/h/.codex/auth.json",
  opencodeConfig: "/h/.config/opencode/opencode.json",
  home: "/h",
  os: "mac",
} as never

beforeEach(() => {
  jest.clearAllMocks()
  // clearAllMocks keeps implementations, so restore the defaults that individual
  // tests override with a persistent mockResolvedValue (running=false, and
  // cc-switch detected=false + DB present so the auto-init flow stays dormant).
  ;(ccSwitchRunning as jest.Mock).mockResolvedValue(false)
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: false })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(ccSchemaStatus as jest.Mock).mockResolvedValue({
    exists: true,
    userVersion: 0,
    missingColumns: [],
  })
  // The import tests install a path-aware implementation; without resetting it
  // here every later test would see an unmanaged endpoint on disk.
  ;(readTextFile as jest.Mock).mockImplementation(async () => "{}")
  // Account-profile tests need a provider list that survives the reload after a
  // write, so they use a persistent mock — restore the default row here.
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: false },
  ])
  // The import tests point this at a bundle; left set, a later test would open it.
  ;(openDialog as jest.Mock).mockResolvedValue(null)
  useAppStore.setState((state) => ({
    paths,
    panelOpen: false,
    osOverride: null,
    settings: { ...state.settings, providerBackend: "ccswitch" },
  }))
})

afterEach(async () => {
  // A scan fans out to several async desktop reads. Flush their state updates
  // before RTL unmounts the tree so tests that only assert initial UI do not
  // leak React act() warnings into later cases.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
})

function renderCc() {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <CcSwitchSection />
        <RetryProbe />
      </RunnerHarness>
    </I18nProvider>
  )
}

/** The real review panel, driven by hand — for the tests whose subject is the gate. */
function renderCcWithPanel() {
  return render(
    <I18nProvider>
      <RunnerHarness panel>
        <CcSwitchSection />
      </RunnerHarness>
    </I18nProvider>
  )
}

/**
 * The review panel's Retry, reachable while a dialog is open. (The panel's own
 * button sits under the re-opened form's modal layer.)
 */
function RetryProbe() {
  const { retry } = useRunnerCtx()
  return (
    <button type="button" onClick={() => void retry()}>
      test-retry
    </button>
  )
}

it("lists providers from the DB", async () => {
  renderCc()
  expect(await screen.findByText("Mine")).toBeInTheDocument()
})

it("filters and sorts providers by name, app, official/current state", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    {
      id: "1",
      app_type: "claude",
      name: "Zulu",
      settings_config: '{"env":{"ANTHROPIC_BASE_URL":"https://z"}}',
      is_current: false,
    },
    {
      id: "2",
      app_type: "codex",
      name: "Alpha",
      settings_config: '{"auth":{"OPENAI_API_KEY":"x"}}',
      is_current: true,
    },
    {
      id: "3",
      app_type: "opencode",
      name: en.ccswitch.officialName,
      settings_config: "{}",
      is_current: false,
    },
  ])
  renderCc()
  await screen.findByText("Zulu")

  await userEvent.type(screen.getByPlaceholderText(en.ccswitch.providerSearch), "alpha")
  expect(screen.getByText("Alpha")).toBeInTheDocument()
  expect(screen.queryByText("Zulu")).not.toBeInTheDocument()

  await userEvent.clear(screen.getByPlaceholderText(en.ccswitch.providerSearch))
  await userEvent.click(screen.getByRole("combobox", { name: en.ccswitch.providerStatusFilter }))
  await userEvent.click(screen.getByRole("option", { name: en.ccswitch.providerStatusOfficial }))
  expect(screen.getByText(en.ccswitch.officialName)).toBeInTheDocument()
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument()
})

it("switches to the independent native provider store and persists the choice", async () => {
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("radio", { name: en.ccswitch.backendNative }))
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ providerBackend: "native" }))
  // Native mode is now stated by the option itself rather than by a second
  // panel restating it, so that is what confirms the switch landed.
  await waitFor(() =>
    expect(screen.getByRole("radio", { name: en.ccswitch.backendNative })).toBeChecked()
  )
  // No cc-switch app to install, so that step is absent — not present and ticked.
  expect(screen.queryByText(en.ccswitch.install)).not.toBeInTheDocument()
  expect(screen.queryByText(en.ccswitch.stepDatabaseTitle)).not.toBeInTheDocument()
})

it("ignores a stale CC Switch scan that finishes after switching to native", async () => {
  let resolveCc!: (providers: unknown[]) => void
  ;(ccLoadProviders as jest.Mock).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveCc = resolve
    })
  )
  ;(providerLoad as jest.Mock).mockResolvedValueOnce([
    {
      id: "native-1",
      app_type: "opencode",
      name: "Native relay",
      settings_config: "{}",
      is_current: true,
    },
  ])
  renderCc()
  await userEvent.click(screen.getByRole("radio", { name: en.ccswitch.backendNative }))
  expect(await screen.findByText("Native relay")).toBeInTheDocument()

  await act(async () => {
    resolveCc([
      {
        id: "cc-1",
        app_type: "claude",
        name: "Stale relay",
        settings_config: "{}",
        is_current: true,
      },
    ])
  })
  expect(screen.queryByText("Stale relay")).not.toBeInTheDocument()
  expect(screen.getByText("Native relay")).toBeInTheDocument()
})

it("installs cc-switch via the runner when not detected", async () => {
  renderCc()
  const install = await screen.findByRole("button", { name: en.ccswitch.install })
  await userEvent.click(install)
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
})

it("applies the visible-apps selection once something changed", async () => {
  renderCc()
  const apply = screen.getByRole("button", { name: en.shell.apply })
  // The file's own contents written back to it is a review of nothing.
  expect(apply).toBeDisabled()
  expect(screen.getByText(en.ccswitch.visibleUnchanged)).toBeInTheDocument()
  const gemini = await screen.findByLabelText(en.ccswitch.appLabels.gemini)
  await waitFor(() => expect(gemini).toBeChecked())
  await userEvent.click(gemini)
  await userEvent.click(apply)
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith(CC_SETTINGS, expect.any(String)))
})

it("keeps unapplied visible-app toggles through a rescan", async () => {
  renderCc()
  const gemini = await screen.findByLabelText(en.ccswitch.appLabels.gemini)
  await waitFor(() => expect(gemini).toBeChecked())
  await userEvent.click(gemini)
  // Every run triggers one; it used to put the file's values back over the edit.
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.refresh }))
  await waitFor(() => expect(loginStatus).toHaveBeenCalledTimes(2))
  await act(async () => {
    await Promise.resolve()
  })
  expect(gemini).not.toBeChecked()
  expect(screen.getByRole("button", { name: en.shell.apply })).toBeEnabled()
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

it("re-opens the form with what was typed when the review is walked away from", async () => {
  renderCcWithPanel()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.addProvider }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldName), "Relay")
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldToken), "sk-pasted")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await userEvent.click(await screen.findByRole("button", { name: en.review.discard }))
  // Nothing was written — and nothing typed, the pasted token included, is lost.
  await waitFor(() => expect(screen.getByLabelText(en.ccswitch.fieldName)).toHaveValue("Relay"))
  expect(screen.getByLabelText(en.ccswitch.fieldToken)).toHaveValue("sk-pasted")
  expect(ccWriteProvider).not.toHaveBeenCalled()
})

it("closes a re-opened add form once a retry in the review panel lands it", async () => {
  ;(ccWriteProvider as jest.Mock).mockRejectedValueOnce("cc-switch is running")
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.addProvider }))
  await userEvent.type(screen.getByLabelText(en.ccswitch.fieldName), "Relay")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))
  await waitFor(() => expect(screen.getByLabelText(en.ccswitch.fieldName)).toHaveValue("Relay"))

  // The retry lands the add; the reload after it finds the new row.
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "1", app_type: "claude", name: "Mine", settings_config: "{}", is_current: false },
    { id: "2", app_type: "claude", name: "Relay", settings_config: "{}", is_current: true },
  ])
  fireEvent.click(screen.getByRole("button", { name: "test-retry", hidden: true }))

  // Left open, the form was a second add of the same row one Save away.
  await waitFor(() =>
    expect(screen.queryByLabelText(en.ccswitch.fieldName)).not.toBeInTheDocument()
  )
  expect(ccWriteProvider).toHaveBeenCalledTimes(2)
  expect(await screen.findByText("Relay")).toBeInTheDocument()
})

it("keeps the keys the form doesn't model when a provider is edited", async () => {
  const stored = {
    env: {
      ANTHROPIC_AUTH_TOKEN: "old",
      ANTHROPIC_BASE_URL: "https://relay",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000",
    },
    permissions: { allow: ["Bash"] },
  }
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    {
      id: "1",
      app_type: "claude",
      name: "Mine",
      settings_config: JSON.stringify(stored),
      is_current: true,
    },
  ])
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.rowActionEdit }))
  const token = screen.getByLabelText(en.ccswitch.fieldToken)
  await userEvent.clear(token)
  await userEvent.type(token, "new")
  await userEvent.click(screen.getByRole("button", { name: en.shell.save }))

  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "update" }))
  )
  const req = (ccWriteProvider as jest.Mock).mock.calls[0][0]
  expect(JSON.parse(req.settingsConfig)).toEqual({
    env: { ...stored.env, ANTHROPIC_AUTH_TOKEN: "new" },
    permissions: { allow: ["Bash"] },
  })
  // It is the current row, so what goes live is the whole env, not four keys.
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.claude/settings.json",
      expect.stringContaining("CLAUDE_CODE_MAX_OUTPUT_TOKENS")
    )
  )
})

it("says a profile is already active instead of offering an Apply that does nothing", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "a", app_type: "claude", name: "Gateway", settings_config: "{}", is_current: true },
  ])
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith("accounts.json")
      ? JSON.stringify({
          version: 2,
          profiles: [{ id: "p1", name: "Work", backend: "ccswitch", picks: { claude: "a" } }],
        })
      : "{}"
  )
  renderCc()
  const row = (await screen.findByText("Work")).closest("tr")!
  expect(within(row).getByText(en.ccswitch.accountActive)).toBeInTheDocument()
  expect(within(row).getByRole("button", { name: en.ccswitch.accountApply })).toBeDisabled()
})

it("says so when an import brings nothing new", async () => {
  ;(openDialog as jest.Mock).mockResolvedValue("/tmp/bundle.json")
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path === "/tmp/bundle.json"
      ? JSON.stringify({
          version: 1,
          providers: [{ app: "claude", name: "Mine", settingsConfig: "{}" }],
        })
      : "{}"
  )
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.importProviders }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.importFreshOnly }))
  expect(toast.message).toHaveBeenCalledWith(en.ccswitch.importNothingNew)
  expect(ccWriteProvider).not.toHaveBeenCalled()
})

it("names an import file it couldn't read instead of rejecting unhandled", async () => {
  ;(openDialog as jest.Mock).mockResolvedValue("/tmp/bundle.json")
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) => {
    if (path === "/tmp/bundle.json") throw "permission denied"
    return "{}"
  })
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.importProviders }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      en.ccswitch.importReadFailed("/tmp/bundle.json", "permission denied")
    )
  )
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

it("offers each recommended preset exactly once, beside a list that has rows", async () => {
  // Quick add has one home at a time — the empty list, or the aside. Rendering
  // it in both would put every preset button on screen twice.
  renderCc()
  await screen.findByText("Mine")
  const preset = RECOMMENDED_PROVIDERS[0]
  expect(screen.getAllByRole("button", { name: preset.label })).toHaveLength(1)
  expect(screen.queryByText(en.ccswitch.emptyHint)).not.toBeInTheDocument()
})

it("puts quick add inside the empty list, where a first provider is chosen", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([])
  renderCc()
  expect(await screen.findByText(en.ccswitch.emptyHint)).toBeInTheDocument()
  const preset = RECOMMENDED_PROVIDERS[0]
  expect(screen.getAllByRole("button", { name: preset.label })).toHaveLength(1)
  // Nothing to filter yet, so the toolbar isn't chrome describing an empty list.
  expect(
    screen.queryByRole("group", { name: en.ccswitch.providerToolbarLabel })
  ).not.toBeInTheDocument()
})

it("names each provider's endpoint in the list instead of hiding it in the form", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([
    {
      id: "1",
      app_type: "claude",
      name: "Relay",
      settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://relay.example" } }),
      is_current: false,
    },
  ])
  renderCc()
  expect(await screen.findByText("https://relay.example")).toBeInTheDocument()
})

it("sorts the current provider to the top when asked to", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([
    { id: "1", app_type: "claude", name: "Alpha", settings_config: "{}", is_current: false },
    { id: "2", app_type: "codex", name: "Zulu", settings_config: "{}", is_current: true },
  ])
  renderCc()
  await screen.findByText("Zulu")
  await userEvent.click(screen.getByRole("combobox", { name: en.ccswitch.providerSort }))
  await userEvent.click(screen.getByRole("option", { name: en.ccswitch.providerSortCurrent }))
  const firstBodyRow = screen.getAllByRole("row")[1]
  expect(within(firstBodyRow).getByText("Zulu")).toBeInTheDocument()
})

it("falls back to the no-db message when the list is empty", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([])
  renderCc()
  expect(await screen.findByText(en.ccswitch.empty)).toBeInTheDocument()
})

it("reviews database initialization as a real step before creating it", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: false })
  ;(ccSchemaStatus as jest.Mock)
    .mockResolvedValueOnce({ exists: false, userVersion: 0, missingColumns: [] })
    .mockResolvedValue({ exists: true, userVersion: 0, missingColumns: [] })
  renderCc()

  const initialize = await screen.findByRole("button", { name: en.ccswitch.initDb })
  expect(ccInitDb).not.toHaveBeenCalled()
  await userEvent.click(initialize)

  await waitFor(() => expect(ccInitDb).toHaveBeenCalledTimes(1))
  expect(await screen.findByText(en.ccswitch.dbReady)).toBeInTheDocument()
})

it("reports a failed database creation from the step that ran it", async () => {
  ;(ccSchemaStatus as jest.Mock).mockResolvedValue({
    exists: false,
    userVersion: 0,
    missingColumns: [],
  })
  ;(ccInitDb as jest.Mock).mockRejectedValueOnce("permission denied: ~/.cc-switch")
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccswitch.initDb }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccswitch.initFailed))
})

it("points an out-of-date DB at cc-switch instead of touching its schema", async () => {
  // Migrating someone else's database is cc-switch's job; agentpack names the
  // missing columns and stops.
  ;(ccSchemaStatus as jest.Mock).mockResolvedValue({
    exists: true,
    userVersion: 3,
    missingColumns: ["website_url"],
  })
  // What the backend really does with such a database: `cc_load_providers`
  // asserts the columns it SELECTs and refuses.
  ;(ccLoadProviders as jest.Mock).mockRejectedValue(
    "this cc-switch database predates the columns agentpack needs."
  )
  ;(loginStatus as jest.Mock).mockResolvedValueOnce({
    claude: { signedIn: true, mode: "oauth", plan: "max", expiresAt: null, source: "Keychain" },
    codex: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "not signed in" },
    opencode: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "not signed in" },
  })
  renderCc()
  expect(await screen.findByText(en.ccswitch.schemaStale("website_url"))).toBeInTheDocument()
  // Asked anyway, it would only produce the same verdict as a raw error.
  expect(ccLoadProviders).not.toHaveBeenCalled()
  expect(ccInitDb).not.toHaveBeenCalled()
  // The rest of the page still reads — it used to share one Promise.all with
  // the provider read and never arrive.
  expect(await screen.findByText(/max/)).toBeInTheDocument()
  expect(screen.getByText(en.ccswitch.notDetected)).toBeInTheDocument()
  // The list says why it is empty, and adding waits for the migration.
  expect(screen.getByText(en.ccswitch.listOutdated)).toBeInTheDocument()
  expect(screen.queryByText(en.ccswitch.noDb)).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.ccswitch.addProvider })).toBeDisabled()
  expect(screen.getAllByText(en.ccswitch.addNeedsMigration).length).toBeGreaterThan(0)
})

it("launches cc-switch for the migration and re-reads the schema after", async () => {
  ;(ccSchemaStatus as jest.Mock).mockResolvedValue({
    exists: true,
    userVersion: 3,
    missingColumns: ["website_url"],
  })
  renderCc()
  const launch = await screen.findByRole("button", { name: en.ccswitch.launchCcSwitch })
  ;(ccSchemaStatus as jest.Mock).mockResolvedValue({
    exists: true,
    userVersion: 5,
    missingColumns: [],
  })
  ;(ccSwitchRunning as jest.Mock).mockResolvedValue(true)
  await userEvent.click(launch)
  expect(launchCcSwitch).toHaveBeenCalled()
  expect(await screen.findByText(en.ccswitch.dbReady)).toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalledWith(en.ccswitch.initFailed)
})

it("still reads the schema, logins and backups when the provider read fails", async () => {
  ;(ccLoadProviders as jest.Mock).mockRejectedValueOnce(new Error("db locked"))
  ;(backupList as jest.Mock).mockResolvedValueOnce([
    { id: "snapshot-9", ts: 1700000000000, reason: "provider write", files: [] },
  ])
  renderCc()
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccswitch.loadFailed))
  expect(await screen.findByText("provider write")).toBeInTheDocument()
  expect(screen.getByText(en.ccswitch.dbReady)).toBeInTheDocument()
  // No list is not "database not found": the database is right there.
  expect(screen.queryByText(en.ccswitch.noDb)).not.toBeInTheDocument()
  expect(
    within(screen.getByRole("region", { name: en.ccswitch.providersTitle })).getByText(
      en.ccswitch.loadFailed
    )
  ).toBeInTheDocument()
})

it("keeps adding a provider waiting until the database exists", async () => {
  ;(ccSchemaStatus as jest.Mock).mockResolvedValue({
    exists: false,
    userVersion: 0,
    missingColumns: [],
  })
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([])
  renderCc()
  await screen.findByRole("button", { name: en.ccswitch.initDb })
  const providerStep = screen.getByText(en.ccswitch.stepProviderTitle).closest("li")!
  expect(providerStep.dataset.status).toBe("waiting")
  // Add and every quick-add preset would open a form whose save could only
  // fail with a raw error from the backend.
  expect(screen.getByRole("button", { name: en.ccswitch.addProvider })).toBeDisabled()
  expect(screen.getByRole("button", { name: RECOMMENDED_PROVIDERS[0].label })).toBeDisabled()
  expect(screen.getAllByText(en.ccswitch.addNeedsDb).length).toBeGreaterThan(0)
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

it("offers to import a relay found in the live config that no provider covers", async () => {
  // Anyone who configured an endpoint by hand (or with the removed relay card)
  // would otherwise see an empty list and lose it on the first switch.
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([])
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path === "/h/.claude/settings.json"
      ? JSON.stringify({
          env: { ANTHROPIC_BASE_URL: "https://hand.example", ANTHROPIC_AUTH_TOKEN: "sk-hand" },
        })
      : "{}"
  )
  renderCc()

  await userEvent.click(
    await screen.findByRole("button", {
      name: en.ccswitch.importOne("claude", "https://hand.example"),
    })
  )
  // The candidate lands in the normal add form so the user reviews it first.
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByLabelText(en.ccswitch.fieldBaseUrl)).toHaveValue(
    "https://hand.example"
  )
})

it("stays quiet when every live endpoint already has a provider row", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([
    {
      id: "1",
      app_type: "claude",
      name: "Mine",
      settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://hand.example" } }),
      is_current: true,
    },
  ])
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path === "/h/.claude/settings.json"
      ? JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://hand.example" } })
      : "{}"
  )
  renderCc()
  await screen.findByText("Mine")
  expect(screen.queryByText(en.ccswitch.unmanagedTitle(1))).not.toBeInTheDocument()
})

it("shows each CLI's own login without ever reading a credential", async () => {
  ;(loginStatus as jest.Mock).mockResolvedValueOnce({
    claude: {
      signedIn: true,
      mode: "oauth",
      plan: "max",
      expiresAt: null,
      source: "macOS Keychain",
    },
    codex: { signedIn: true, mode: "chatgpt", plan: null, expiresAt: null, source: "auth.json" },
    opencode: {
      signedIn: true,
      mode: "2 providers",
      plan: null,
      expiresAt: null,
      source: "OpenCode auth.json",
    },
  })
  renderCc()
  expect(await screen.findByText(/max/)).toBeInTheDocument()
  // `auth_mode` is the field that decides whether a codex relay applies at all.
  expect(screen.getByText(/chatgpt/)).toBeInTheDocument()
  expect(screen.getByText(/2 providers/)).toBeInTheDocument()
})

it("offers an official-login row for an app that has none, and it overrides nothing", async () => {
  // Without this row there is no way back from a relay to the CLI's own account.
  ;(ccLoadProviders as jest.Mock).mockResolvedValueOnce([])
  renderCc()

  await userEvent.click(
    await screen.findByRole("button", { name: en.ccswitch.addOfficial("claude") })
  )
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByLabelText(en.ccswitch.fieldBaseUrl)).toHaveValue("")
  await userEvent.click(within(dialog).getByRole("button", { name: en.shell.save }))

  await waitFor(() => expect(ccWriteProvider).toHaveBeenCalled())
  const req = (ccWriteProvider as jest.Mock).mock.calls[0][0]
  expect(JSON.parse(req.settingsConfig).env).toEqual({})
})

it("imports a bundle straight through when no name collides", async () => {
  ;(openDialog as jest.Mock).mockResolvedValue("/tmp/bundle.json")
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path === "/tmp/bundle.json"
      ? JSON.stringify({
          version: 1,
          providers: [
            {
              app: "claude",
              name: "Imported",
              settingsConfig: JSON.stringify({
                env: { ANTHROPIC_BASE_URL: "https://i", ANTHROPIC_CUSTOM_HEADERS: "X: 1" },
              }),
            },
          ],
        })
      : "{}"
  )
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.importProviders }))

  await waitFor(() => expect(ccWriteProvider).toHaveBeenCalled())
  const req = (ccWriteProvider as jest.Mock).mock.calls[0][0]
  expect(req.op).toBe("add")
  // The stored config rides through verbatim, so hand-written fields survive.
  expect(JSON.parse(req.settingsConfig).env.ANTHROPIC_CUSTOM_HEADERS).toBe("X: 1")
})

it("asks before replacing a provider an import collides with", async () => {
  ;(openDialog as jest.Mock).mockResolvedValue("/tmp/bundle.json")
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path === "/tmp/bundle.json"
      ? JSON.stringify({
          version: 1,
          providers: [{ app: "claude", name: "Mine", settingsConfig: "{}" }],
        })
      : "{}"
  )
  renderCc()
  await screen.findByText("Mine")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.importProviders }))

  const dialog = await screen.findByRole("alertdialog")
  expect(ccWriteProvider).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.importOverwrite }))
  await waitFor(() =>
    expect(ccWriteProvider).toHaveBeenCalledWith(expect.objectContaining({ op: "update", id: "1" }))
  )
})

it("saves the current selection as an account profile", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "a", app_type: "claude", name: "Gateway", settings_config: "{}", is_current: true },
    { id: "b", app_type: "codex", name: "Official", settings_config: "{}", is_current: true },
  ])
  renderCc()
  await screen.findByText("Gateway")
  await userEvent.type(screen.getByLabelText(en.ccswitch.accountNewLabel), "Work")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.accountSave }))

  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const [path, body] = (writeTextFile as jest.Mock).mock.calls.find(([p]: [string]) =>
    p.endsWith("accounts.json")
  )!
  expect(path).toContain(".agentpack/accounts.json")
  const saved = JSON.parse(body).profiles[0]
  expect(saved.name).toBe("Work")
  // A profile records which row each app points at — no config copy, no secret.
  expect(saved.picks).toEqual({ claude: "a", codex: "b" })
  expect(body).not.toContain("settings_config")
})

it("rolls back an account profile and keeps its name when saving fails", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "a", app_type: "claude", name: "Gateway", settings_config: "{}", is_current: true },
  ])
  ;(writeTextFile as jest.Mock).mockRejectedValueOnce(new Error("read-only filesystem"))
  renderCc()
  await screen.findByText("Gateway")
  const name = screen.getByLabelText(en.ccswitch.accountNewLabel)
  await userEvent.type(name, "Work")
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.accountSave }))

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccswitch.accountWriteFailed))
  expect(name).toHaveValue("Work")
  expect(screen.queryByText("Work")).not.toBeInTheDocument()
})

it("applying a profile switches every app through the same setCurrent path", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "a", app_type: "claude", name: "Gateway", settings_config: "{}", is_current: false },
    { id: "b", app_type: "codex", name: "Official", settings_config: "{}", is_current: false },
  ])
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith("accounts.json")
      ? JSON.stringify({
          version: 1,
          profiles: [{ id: "p1", name: "Work", picks: { claude: "a", codex: "b" } }],
        })
      : "{}"
  )
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccswitch.accountApply }))

  await waitFor(() => expect(ccWriteProvider).toHaveBeenCalledTimes(2))
  const ops = (ccWriteProvider as jest.Mock).mock.calls.map(([r]) => [r.op, r.app, r.id])
  expect(ops).toEqual([
    ["setCurrent", "claude", "a"],
    ["setCurrent", "codex", "b"],
  ])
})

it("edits an account profile name and persists the updated mapping", async () => {
  ;(ccLoadProviders as jest.Mock).mockResolvedValue([
    { id: "a", app_type: "claude", name: "Gateway", settings_config: "{}", is_current: false },
  ])
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith("accounts.json")
      ? JSON.stringify({
          version: 2,
          profiles: [
            {
              id: "p1",
              name: "Work",
              backend: "ccswitch",
              picks: { claude: "a" },
            },
          ],
        })
      : "{}"
  )
  renderCc()
  const accountRow = (await screen.findByText("Work")).closest("tr")!

  await userEvent.click(within(accountRow).getByRole("button", { name: en.ccswitch.rowActionEdit }))
  const dialog = await screen.findByRole("dialog")
  const name = within(dialog).getByLabelText(en.ccswitch.accountNewLabel)
  await userEvent.clear(name)
  await userEvent.type(name, "Personal")
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.accountUpdate }))

  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const [, body] = (writeTextFile as jest.Mock).mock.calls.find(([path]: [string]) =>
    path.endsWith("accounts.json")
  )!
  expect(JSON.parse(body).profiles[0]).toEqual({
    id: "p1",
    name: "Personal",
    backend: "ccswitch",
    picks: { claude: "a" },
  })
})

it("requires confirmation before deleting an account profile", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith("accounts.json")
      ? JSON.stringify({
          version: 2,
          profiles: [{ id: "p1", name: "Work", backend: "ccswitch", picks: { claude: "1" } }],
        })
      : "{}"
  )
  renderCc()
  const accountRow = (await screen.findByText("Work")).closest("tr")!

  await userEvent.click(
    within(accountRow).getByRole("button", { name: en.ccswitch.rowActionDelete })
  )
  const dialog = await screen.findByRole("alertdialog")
  expect(writeTextFile).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.rowActionDelete }))

  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const [, body] = (writeTextFile as jest.Mock).mock.calls.find(([path]: [string]) =>
    path.endsWith("accounts.json")
  )!
  expect(JSON.parse(body).profiles).toEqual([])
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

it("renders the backup history and restores an entry through the review panel", async () => {
  ;(backupList as jest.Mock).mockResolvedValue([
    { id: "snapshot-9", ts: 1700000000000, reason: "provider write", files: [{}, {}] },
  ])
  renderCc()
  expect(await screen.findByText("provider write")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.ccswitch.restore }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccswitch.restore }))
  await waitFor(() => expect(backupRestore).toHaveBeenCalledWith("snapshot-9"))
  // Success is the panel's "All set", not a second toast.
  expect(toast.success).not.toHaveBeenCalled()
  // The step log names the restore point the restore itself created — the undo
  // is undoable, and the user is told so rather than having to trust it.
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
  ;(ccSwitchRunning as jest.Mock).mockResolvedValue(true)
  renderCc()
  await screen.findByText("Mine")
  expect(await screen.findByText(en.ccswitch.runningTitle)).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByRole("button", { name: en.ccswitch.rowActionEdit })).toBeDisabled()
  )
  expect(screen.getByRole("button", { name: en.ccswitch.addProvider })).toBeDisabled()
  expect(ccWriteProvider).not.toHaveBeenCalled()
})

describe("app control (open / quit / status)", () => {
  const cc = en.ccswitch

  /** cc-switch installed, so the control row renders at all. */
  const installed = () => (detectCli as jest.Mock).mockResolvedValue({ installed: true })

  it("reports the live running state", async () => {
    installed()
    ;(ccSwitchRunning as jest.Mock).mockResolvedValue(true)
    renderCc()
    expect(await screen.findByText(cc.appRunning)).toBeInTheDocument()
  })

  it("reports a stopped app and disables Quit — there is nothing to quit", async () => {
    installed()
    renderCc()
    expect(await screen.findByText(cc.appStopped)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: cc.appQuit })).toBeDisabled())
  })

  it("opens the app and refreshes into the running state", async () => {
    installed()
    renderCc()
    await screen.findByText(cc.appStopped)
    // The app appears in the process table only after the launch returns.
    ;(ccSwitchRunning as jest.Mock).mockResolvedValue(true)

    await userEvent.click(screen.getByRole("button", { name: cc.appOpen }))

    expect(launchCcSwitch).toHaveBeenCalled()
    expect(await screen.findByText(cc.appRunning)).toBeInTheDocument()
  })

  it("quits the app and refreshes into the stopped state", async () => {
    installed()
    ;(ccSwitchRunning as jest.Mock).mockResolvedValue(true)
    renderCc()
    await screen.findByText(cc.appRunning)
    ;(ccSwitchRunning as jest.Mock).mockResolvedValue(false)

    // Two Quit buttons exist while it's running (the control row and the
    // "editing blocked" alert); the control row's comes first in DOM order.
    await userEvent.click(screen.getAllByRole("button", { name: cc.appQuit })[0])

    expect(quitCcSwitch).toHaveBeenCalled()
    expect(await screen.findByText(cc.appStopped)).toBeInTheDocument()
  })

  it("unblocks provider editing once the app is quit", async () => {
    installed()
    ;(ccSwitchRunning as jest.Mock).mockResolvedValue(true)
    renderCc()
    await screen.findByText("Mine")
    // The whole point: the fix is offered where the problem is stated.
    const alert = (await screen.findByText(cc.runningTitle)).closest("[role='alert']")!
    ;(ccSwitchRunning as jest.Mock).mockResolvedValue(false)

    await userEvent.click(within(alert as HTMLElement).getByRole("button", { name: cc.appQuit }))

    await waitFor(() => expect(screen.getByRole("button", { name: cc.addProvider })).toBeEnabled())
    expect(screen.queryByText(cc.runningTitle)).not.toBeInTheDocument()
  })

  it("says so when the app survives the quit, instead of silently doing nothing", async () => {
    installed()
    ;(ccSwitchRunning as jest.Mock).mockResolvedValue(true)
    ;(quitCcSwitch as jest.Mock).mockResolvedValue(false)
    renderCc()
    await screen.findByText(cc.appRunning)

    const alert = (await screen.findByText(cc.runningTitle)).closest("[role='alert']")!
    await userEvent.click(within(alert as HTMLElement).getByRole("button", { name: cc.appQuit }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(cc.quitFailed))
  })

  it("toasts when the app can't be launched at all", async () => {
    installed()
    ;(launchCcSwitch as jest.Mock).mockRejectedValueOnce(new Error("not installed"))
    renderCc()
    await screen.findByText(cc.appStopped)

    await userEvent.click(screen.getByRole("button", { name: cc.appOpen }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(cc.launchFailed))
  })

  it("hides the controls until cc-switch is actually installed", async () => {
    // detectCli defaults to not-installed here — nothing to open or quit.
    renderCc()
    await screen.findByText(en.ccswitch.notDetected)
    expect(screen.queryByText(cc.appTitle)).not.toBeInTheDocument()
  })
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
