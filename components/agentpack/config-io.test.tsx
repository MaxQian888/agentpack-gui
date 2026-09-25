const saveDialog = jest.fn()
const openDialog = jest.fn()
jest.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...a: unknown[]) => saveDialog(...a),
  open: (...a: unknown[]) => openDialog(...a),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  writeTextFile: jest.fn(async () => undefined),
  readTextFile: jest.fn(async () => "{}"),
  pathExists: jest.fn(async () => true),
}))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
// The section hosts the backup dialogs, which reach for the runner; those have
// their own tests, so here they only need to mount.
jest.mock("./run/runner-context", () => ({
  useRunnerCtx: () => ({ run: jest.fn(async () => []) }),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { isTauri } from "@/lib/tauri"
import { pathExists, readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { serializePlan } from "@/lib/agentpack/config"
import { CONFIG_FILES } from "@/lib/agentpack/config-editor/files"
import { serializeProfiles } from "@/lib/agentpack/profile"
import type { Plan } from "@/lib/agentpack/types"
import { en } from "@/lib/i18n/en"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { ConfigIO } from "./config-io"

beforeEach(() => {
  jest.clearAllMocks()
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(writeTextFile as jest.Mock).mockResolvedValue(undefined)
  useAppStore.setState({ osOverride: null, paths: null })
  useAppStore.getState().resetPlan()
})

function renderIO(scan: React.ComponentProps<typeof ConfigIO>["scan"] = null) {
  return render(
    <I18nProvider>
      <ConfigIO scan={scan} />
    </I18nProvider>
  )
}

const clickSave = () => userEvent.click(screen.getByRole("button", { name: /save config/i }))
const clickLoad = () => userEvent.click(screen.getByRole("button", { name: /load config/i }))

it("errors out of Tauri-only actions when not in Tauri", async () => {
  ;(isTauri as jest.Mock).mockReturnValue(false)
  renderIO()
  await clickSave()
  expect(toast.error).toHaveBeenCalled()
  expect(saveDialog).not.toHaveBeenCalled()
})

it("writes the serialized plan to the chosen path", async () => {
  saveDialog.mockResolvedValue("/tmp/agentpack.config.json")
  renderIO()
  await clickSave()
  expect(writeTextFile).toHaveBeenCalledWith(
    "/tmp/agentpack.config.json",
    serializePlan(useAppStore.getState().plan)
  )
  expect(toast.success).toHaveBeenCalled()
})

it("does nothing when the save dialog is cancelled", async () => {
  saveDialog.mockResolvedValue(null)
  renderIO()
  await clickSave()
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("loads a valid config and applies it to the store", async () => {
  const plan = { ...useAppStore.getState().plan, clis: ["claude-code" as const] }
  openDialog.mockResolvedValue("/tmp/cfg.json")
  ;(readTextFile as jest.Mock).mockResolvedValue(serializePlan(plan))
  renderIO()
  await clickLoad()
  expect(useAppStore.getState().plan.clis).toEqual(["claude-code"])
  expect(toast.success).toHaveBeenCalled()
})

it("re-stamps a config written on another OS onto this one", async () => {
  // A config written on Windows says `os: "win"`; loaded as-is on a Mac, the
  // step builder would stage the Windows commands (winget, PowerShell) here.
  const plan = {
    ...useAppStore.getState().plan,
    os: "win" as const,
    clis: ["claude-code" as const],
    cliMethods: { "claude-code": "native" },
  }
  openDialog.mockResolvedValue("/tmp/cfg.json")
  ;(readTextFile as jest.Mock).mockResolvedValue(serializePlan(plan))
  useAppStore.setState({ osOverride: "mac" })
  renderIO()
  await clickLoad()
  expect(toast.success).toHaveBeenCalledWith(en.shell.configLoaded)
  expect(useAppStore.getState().plan.os).toBe("mac")
  // A method this OS also offers survives the re-stamp.
  expect(useAppStore.getState().plan.cliMethods?.["claude-code"]).toBe("native")
})

it("says which file it couldn't write, and why", async () => {
  saveDialog.mockResolvedValue("/tmp/agentpack.config.json")
  ;(writeTextFile as jest.Mock).mockRejectedValue(new Error("EROFS"))
  renderIO()
  await clickSave()
  expect(toast.error).toHaveBeenCalledWith(
    en.profiles.configWriteFailed("/tmp/agentpack.config.json", "EROFS")
  )
  expect(toast.success).not.toHaveBeenCalled()
})

it("toasts an error for an invalid config file", async () => {
  openDialog.mockResolvedValue("/tmp/cfg.json")
  ;(readTextFile as jest.Mock).mockResolvedValue("{ not json")
  renderIO()
  await clickLoad()
  expect(toast.error).toHaveBeenCalled()
})

it("does nothing when the open dialog is cancelled", async () => {
  openDialog.mockResolvedValue(null)
  renderIO()
  await clickLoad()
  expect(readTextFile).not.toHaveBeenCalled()
})

describe("profiles", () => {
  const measuredScan: NonNullable<React.ComponentProps<typeof ConfigIO>["scan"]> = {
    at: Date.UTC(2026, 7, 24),
    degraded: false,
    claudeSettings: { status: "missing", hasBackup: false },
    codexConfig: { status: "missing", hasBackup: false },
  }

  beforeEach(() => {
    useAppStore.setState({ paths: { home: "/h" } as never, profiles: [], currentProfileId: null })
    ;(readTextFile as jest.Mock).mockResolvedValue("")
  })

  it("saves the current plan as a named profile and persists it", async () => {
    useAppStore.getState().toggleCli("codex")
    renderIO()
    await userEvent.type(screen.getByPlaceholderText(/profile name/i), "Work")
    await userEvent.click(screen.getByRole("button", { name: /save current as profile/i }))
    // Scoped to the list: the summary strip also names the active profile, and
    // a saved profile becomes active — so an unscoped query matches twice.
    const list = screen.getByRole("region", { name: en.profiles.listPanel })
    expect(within(list).getByText("Work")).toBeInTheDocument()
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.agentpack/profiles.json",
      expect.stringContaining("Work")
    )
  })

  it("can't be saved without a name", async () => {
    useAppStore.getState().toggleCli("codex")
    renderIO()
    // Disabled rather than a click that only toasts "enter a name".
    expect(screen.getByRole("button", { name: /save current as profile/i })).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText(/profile name/i), "Work")
    expect(screen.getByRole("button", { name: /save current as profile/i })).toBeEnabled()
  })

  it("won't save an empty selection, and says what to do first", async () => {
    renderIO()
    await userEvent.type(screen.getByPlaceholderText(/profile name/i), "Nothing")
    expect(screen.getByRole("button", { name: /save current as profile/i })).toBeDisabled()
    expect(screen.getByText(en.profiles.emptySelection)).toBeInTheDocument()
  })

  it("loads a saved profile back into the selection", async () => {
    const plan: Plan = { ...useAppStore.getState().plan, clis: ["codex"] }
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Work", createdAt: 0, plan }] })
    )
    renderIO()
    await userEvent.click(await screen.findByRole("button", { name: en.profiles.apply }))
    expect(useAppStore.getState().plan.clis).toContain("codex")
    // It installs nothing, and says so — the button used to read "Apply".
    expect(toast.success).toHaveBeenCalledWith(en.profiles.applied("Work"))
  })

  it("points the load at the review panel when one is wired up", async () => {
    const onReview = jest.fn()
    const plan: Plan = { ...useAppStore.getState().plan, clis: ["codex"] }
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Work", createdAt: 0, plan }] })
    )
    render(
      <I18nProvider>
        <ConfigIO onReview={onReview} />
      </I18nProvider>
    )
    await userEvent.click(await screen.findByRole("button", { name: en.profiles.apply }))
    const options = (toast.success as jest.Mock).mock.calls.at(-1)![1]
    expect(options.action.label).toBe(en.tray.review)
    options.action.onClick()
    expect(onReview).toHaveBeenCalled()
  })

  it("re-stamps a profile saved on another OS onto this one", async () => {
    const plan: Plan = { ...useAppStore.getState().plan, os: "win", clis: ["claude-code"] }
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Win", createdAt: 0, plan }] })
    )
    useAppStore.setState({ osOverride: "mac" })
    renderIO()
    await userEvent.click(await screen.findByRole("button", { name: en.profiles.apply }))
    expect(useAppStore.getState().plan.os).toBe("mac")
    expect(useAppStore.getState().plan.clis).toEqual(["claude-code"])
  })

  it("reports how many profile requirements are missing from a measured machine", async () => {
    const plan: Plan = { ...useAppStore.getState().plan, clis: ["codex"] }
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Work", createdAt: 0, plan }] })
    )

    renderIO(measuredScan)

    expect(await screen.findByText(en.profiles.machineMissing(1))).toBeInTheDocument()
  })

  it("reports a complete profile only after the machine has been measured", async () => {
    const plan: Plan = { ...useAppStore.getState().plan, clis: ["codex"] }
    useAppStore.setState({ detections: { codex: { installed: true, version: "1.0.0" } } })
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Work", createdAt: 0, plan }] })
    )

    renderIO(measuredScan)

    expect(await screen.findByText(en.profiles.machineComplete)).toBeInTheDocument()
  })

  it("makes no completeness claim before the machine has been measured", async () => {
    const plan: Plan = { ...useAppStore.getState().plan, clis: ["codex"] }
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Work", createdAt: 0, plan }] })
    )

    renderIO()
    await screen.findByText("Work")

    expect(screen.queryByText(en.profiles.machineMissing(1))).not.toBeInTheDocument()
    expect(screen.queryByText(en.profiles.machineComplete)).not.toBeInTheDocument()
  })

  it("renames then deletes a profile", async () => {
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({
        version: 1,
        profiles: [{ id: "p1", name: "Old", createdAt: 0, plan: useAppStore.getState().plan }],
      })
    )
    renderIO()
    await screen.findByText("Old")
    await userEvent.click(screen.getByRole("button", { name: /rename/i }))
    const input = screen.getByDisplayValue("Old")
    await userEvent.clear(input)
    await userEvent.type(input, "New")
    await userEvent.click(screen.getByRole("button", { name: en.profiles.renameCommit }))
    expect(screen.getByText("New")).toBeInTheDocument()

    // Permanent, so it asks once — and nothing happens until it is answered.
    await userEvent.click(screen.getByRole("button", { name: en.profiles.delete }))
    expect(await screen.findByText(en.profiles.deleteTitle("New"))).toBeInTheDocument()
    expect(useAppStore.getState().profiles).toHaveLength(1)
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: en.profiles.delete })
    )
    expect(useAppStore.getState().profiles).toHaveLength(0)
  })

  it("keeps a profile whose delete was cancelled", async () => {
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({
        version: 1,
        profiles: [{ id: "p1", name: "Old", createdAt: 0, plan: useAppStore.getState().plan }],
      })
    )
    renderIO()
    await screen.findByText("Old")
    await userEvent.click(screen.getByRole("button", { name: en.profiles.delete }))
    await userEvent.click(await screen.findByRole("button", { name: en.shell.cancel }))
    expect(useAppStore.getState().profiles).toHaveLength(1)
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it("says a broken profiles.json is broken, and refuses to write over it", async () => {
    // Parsing degrades a corrupt file to "no profiles" — right for rendering,
    // wrong for the next save, which would have replaced it for good.
    ;(readTextFile as jest.Mock).mockResolvedValue("{ not json")
    renderIO()
    expect(
      await screen.findByText(en.profiles.storeCorrupt("/h/.agentpack/profiles.json"))
    ).toBeInTheDocument()
    expect(screen.queryByText(en.profiles.empty)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /save current as profile/i })).toBeDisabled()
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it("says which file couldn't be read, and reads it again on request", async () => {
    ;(readTextFile as jest.Mock).mockRejectedValueOnce(new Error("EACCES"))
    renderIO()
    expect(
      await screen.findByText(en.profiles.storeUnreadable("/h/.agentpack/profiles.json", "EACCES"))
    ).toBeInTheDocument()
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({
        version: 1,
        profiles: [{ id: "p1", name: "Back", createdAt: 0, plan: useAppStore.getState().plan }],
      })
    )
    await userEvent.click(screen.getByRole("button", { name: en.profiles.readAgain }))
    expect(await screen.findByText("Back")).toBeInTheDocument()
    // Saving is possible again once the file reads.
    useAppStore.getState().toggleCli("codex")
    await userEvent.type(screen.getByPlaceholderText(/profile name/i), "Next")
    expect(screen.getByRole("button", { name: /save current as profile/i })).toBeEnabled()
  })

  it("does not leave a profile on screen whose write failed", async () => {
    ;(writeTextFile as jest.Mock).mockRejectedValue(new Error("ENOSPC"))
    useAppStore.getState().toggleCli("codex")
    renderIO()
    await userEvent.type(screen.getByPlaceholderText(/profile name/i), "Work")
    await userEvent.click(screen.getByRole("button", { name: /save current as profile/i }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        en.profiles.writeFailed("/h/.agentpack/profiles.json", "ENOSPC")
      )
    )
    expect(useAppStore.getState().profiles).toHaveLength(0)
    expect(toast.success).not.toHaveBeenCalled()
    // The name is kept, so trying again is one click.
    expect(screen.getByPlaceholderText(/profile name/i)).toHaveValue("Work")
  })

  /**
   * `persist()` silently no-ops in web mode, but the callers announced success
   * anyway — the app told the user their profile was saved when nothing had
   * been written. Save/Load in the same file always got this right.
   */
  it("does not claim a profile was saved when there is nowhere to save it", async () => {
    ;(isTauri as jest.Mock).mockReturnValue(false)
    useAppStore.getState().toggleCli("codex")
    renderIO()
    await userEvent.type(screen.getByPlaceholderText(/profile name/i), "Work")
    await userEvent.click(screen.getByRole("button", { name: /save current as profile/i }))

    expect(writeTextFile).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(en.shell.notInTauri)
    expect(toast.success).not.toHaveBeenCalledWith(en.profiles.saved("Work"))
  })

  it("does not claim a profile was deleted when the delete could not be written", async () => {
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({
        version: 1,
        profiles: [{ id: "p1", name: "Old", createdAt: 0, plan: useAppStore.getState().plan }],
      })
    )
    renderIO()
    await screen.findByText("Old")
    ;(isTauri as jest.Mock).mockReturnValue(false)
    await userEvent.click(screen.getByRole("button", { name: en.profiles.delete }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: en.profiles.delete,
      })
    )

    expect(toast.error).toHaveBeenCalledWith(en.shell.notInTauri)
    expect(toast.success).not.toHaveBeenCalledWith(en.profiles.deleted("Old"))
  })

  // Applying only touches the in-memory plan, so it really does work here.
  it("still confirms an applied profile in web mode — no write is involved", async () => {
    const plan: Plan = { ...useAppStore.getState().plan, clis: ["codex"] }
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Work", createdAt: 0, plan }] })
    )
    renderIO()
    await userEvent.click(await screen.findByRole("button", { name: en.profiles.apply }))
    ;(isTauri as jest.Mock).mockReturnValue(false)
    expect(toast.success).toHaveBeenCalledWith(en.profiles.applied("Work"))
  })
})

describe("config files", () => {
  const PATHS = {
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
    ccSwitchDb: "/h/.cc-switch/cc-switch.db",
    ccConnectDir: "/h/.cc-connect",
    ccConnectConfig: "/h/.cc-connect/config.toml",
    mcpDisabledStore: "/h/.agentpack/mcp-disabled.json",
    shellProfile: "/h/.zshrc",
    os: "mac" as const,
  }

  it("lists every editable config file with its path and an editor trigger", async () => {
    useAppStore.getState().setPaths(PATHS)
    renderIO()
    for (const def of CONFIG_FILES) {
      expect(await screen.findByText(en.configFiles.files[def.id].title)).toBeInTheDocument()
      expect(screen.getByText(PATHS[def.pathKey])).toBeInTheDocument()
    }
    // Present on disk (pathExists → true), so every row offers Edit, not Create.
    expect(await screen.findAllByRole("button", { name: en.configFiles.edit })).toHaveLength(
      CONFIG_FILES.length
    )
  })

  it("says it is still checking rather than calling every file missing", async () => {
    // Before the probe answers, "missing" + Create would open a file that is
    // there seeded with `{}` instead of its contents.
    ;(pathExists as jest.Mock).mockReturnValue(new Promise(() => {}))
    useAppStore.getState().setPaths(PATHS)
    renderIO()
    const pending = await screen.findAllByRole("button", { name: en.configFiles.checking })
    expect(pending).toHaveLength(CONFIG_FILES.length)
    for (const button of pending) expect(button).toBeDisabled()
    expect(screen.queryByText(en.configFiles.missing)).not.toBeInTheDocument()
  })

  it("offers Create for a file that does not exist yet", async () => {
    ;(pathExists as jest.Mock).mockResolvedValue(false)
    useAppStore.getState().setPaths(PATHS)
    renderIO()
    expect(await screen.findAllByRole("button", { name: en.configFiles.create })).toHaveLength(
      CONFIG_FILES.length
    )
  })
})

/**
 * Four sections had no story for web mode at all. The config card returned
 * `null` and vanished outright; the CLI and runtime lists rendered without
 * their status badges, which reads as "you have none of these" rather than
 * "this can't be known here".
 */
describe("web mode says so instead of going quiet", () => {
  it("explains the config editor instead of disappearing", async () => {
    ;(isTauri as jest.Mock).mockReturnValue(false)
    // Exactly what web mode looks like: the shell only calls setPaths in Tauri.
    useAppStore.setState({ paths: null })
    renderIO()
    // The card is still there, titled, with a reason.
    expect(await screen.findByText(en.configFiles.title)).toBeInTheDocument()
    expect(screen.getByText(en.configFiles.notTauri)).toBeInTheDocument()
  })
})
