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

import { render, screen } from "@testing-library/react"
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

function renderIO() {
  return render(
    <I18nProvider>
      <ConfigIO />
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
  beforeEach(() => {
    useAppStore.setState({ paths: { home: "/h" } as never, profiles: [], currentProfileId: null })
    ;(readTextFile as jest.Mock).mockResolvedValue("")
  })

  it("saves the current plan as a named profile and persists it", async () => {
    useAppStore.getState().toggleCli("codex")
    renderIO()
    await userEvent.type(screen.getByPlaceholderText(/profile name/i), "Work")
    await userEvent.click(screen.getByRole("button", { name: /save current as profile/i }))
    expect(screen.getByText("Work")).toBeInTheDocument()
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
    // Buttons in DOM order: Save-as, then the rename-commit (check) button.
    await userEvent.click(screen.getAllByRole("button")[1])
    expect(screen.getByText("New")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /delete/i }))
    expect(useAppStore.getState().profiles).toHaveLength(0)
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
