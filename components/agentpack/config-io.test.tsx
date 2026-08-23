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

import { render, screen, within } from "@testing-library/react"
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
  ;(isTauri as jest.Mock).mockReturnValue(true)
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

  it("warns and saves nothing when the name is blank", async () => {
    renderIO()
    await userEvent.click(screen.getByRole("button", { name: /save current as profile/i }))
    expect(useAppStore.getState().profiles).toHaveLength(0)
    expect(toast.error).toHaveBeenCalled()
  })

  it("applies a saved profile back into the plan", async () => {
    const plan: Plan = { ...useAppStore.getState().plan, clis: ["codex"] }
    ;(readTextFile as jest.Mock).mockResolvedValue(
      serializeProfiles({ version: 1, profiles: [{ id: "p1", name: "Work", createdAt: 0, plan }] })
    )
    renderIO()
    await userEvent.click(await screen.findByRole("button", { name: /^apply$/i }))
    expect(useAppStore.getState().plan.clis).toContain("codex")
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

    await userEvent.click(screen.getByRole("button", { name: /delete/i }))
    expect(useAppStore.getState().profiles).toHaveLength(0)
  })

  /**
   * `persist()` silently no-ops in web mode, but the callers announced success
   * anyway — the app told the user their profile was saved when nothing had
   * been written. Save/Load in the same file always got this right.
   */
  it("does not claim a profile was saved when there is nowhere to save it", async () => {
    ;(isTauri as jest.Mock).mockReturnValue(false)
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
    await userEvent.click(screen.getByRole("button", { name: /delete/i }))

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
    await userEvent.click(await screen.findByRole("button", { name: /^apply$/i }))
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
