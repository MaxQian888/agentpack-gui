jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/system", () => ({ revealPath: jest.fn(), openPath: jest.fn() }))
jest.mock("@/lib/tauri/commands", () => ({
  pathExists: jest.fn(async () => false),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  listSkillFiles: jest.fn(async () => [
    { relPath: "reference.md", bytes: 2048, isDir: false },
    { relPath: "scripts", bytes: 0, isDir: true },
  ]),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { openPath, revealPath } from "@/lib/tauri/system"
import type { SkillRow } from "@/lib/skills/types"
import { RunnerHarness } from "../../run/__testing__/harness"
import { SkillDetailDialog } from "./skill-detail-dialog"

const paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeSkillsDir: "/h/.claude/skills",
  codexSkillsDir: "/h/.codex/skills",
  opencodeConfig: "/h/.config/opencode/opencode.json",
  opencodeSkillsDir: "/h/.config/opencode/skills",
  agentsSkillsDir: "/h/.agents/skills",
  os: "mac",
} as never

const skillMd = [
  "---",
  "name: find-docs",
  "description: Retrieves docs",
  "license: MIT",
  "---",
  "# Documentation Lookup",
  "",
  "| Col |",
  "| --- |",
  "| val |",
].join("\n")

const row: SkillRow = {
  dirName: "find-docs",
  name: "find-docs",
  description: "Retrieves docs",
  nameMismatch: false,
  modifiedAt: 1700000000000,
  entries: {
    claude: {
      source: "claude",
      dirName: "find-docs",
      path: "/h/.claude/skills/find-docs",
      isSymlink: false,
      linkTarget: null,
      skillMd,
      modifiedAt: 1700000000000,
      origin: null,
    },
  },
}

beforeEach(() => {
  useAppStore.setState({ paths, panelOpen: false })
})

function renderDialog() {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <SkillDetailDialog row={row} open onOpenChange={jest.fn()} refresh={jest.fn()} />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("renders frontmatter attrs, path metadata and the markdown body", async () => {
  renderDialog()
  // The collapsible "all fields" section lists any non-highlighted attributes.
  expect(screen.getByText(en.skillsBrowser.allFieldsTitle)).toBeInTheDocument()
  expect(screen.getByText("license")).toBeInTheDocument()
  expect(screen.getByText("MIT")).toBeInTheDocument()
  // The body renders as doc markdown: real heading + GFM table.
  expect(screen.getByRole("heading", { name: "Documentation Lookup" })).toBeInTheDocument()
  expect(screen.getByText("val").closest("td")).not.toBeNull()
  // Install path shown.
  expect(screen.getByText("/h/.claude/skills/find-docs")).toBeInTheDocument()
})

it("reads current config values when opened", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith("settings.json")
      ? JSON.stringify({ skillOverrides: { "find-docs": "off" } })
      : "{}"
  )
  renderDialog()
  await waitFor(() => expect(readTextFile).toHaveBeenCalledWith("/h/.claude/settings.json"))
  // The visibility select reflects the persisted "off" state.
  expect(await screen.findByText(en.skillsBrowser.visibility["off"])).toBeInTheDocument()
})

it("writes skillOverrides through the runner when visibility changes", async () => {
  renderDialog()
  await userEvent.click(screen.getAllByRole("combobox")[0])
  await userEvent.click(
    await screen.findByRole("option", { name: en.skillsBrowser.visibility["name-only"] })
  )
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.claude/settings.json",
      expect.stringContaining('"find-docs": "name-only"')
    )
  )
})

it("writes permission.skill through the runner when permission changes", async () => {
  renderDialog()
  await userEvent.click(screen.getAllByRole("combobox")[1])
  await userEvent.click(
    await screen.findByRole("option", { name: en.skillsBrowser.permission["deny"] })
  )
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.config/opencode/opencode.json",
      expect.stringContaining('"find-docs": "deny"')
    )
  )
})

it("shows invocation, context cost and reveal/open actions", async () => {
  renderDialog()
  expect(screen.getByText(en.skillsBrowser.invocationTitle)).toBeInTheDocument()
  expect(screen.getByText("/find-docs")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.revealInFolder }))
  expect(revealPath).toHaveBeenCalledWith("/h/.claude/skills/find-docs")
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.openSkillMd }))
  expect(openPath).toHaveBeenCalledWith("/h/.claude/skills/find-docs/SKILL.md")
})

it("enters and cancels the editor without writing", async () => {
  renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.edit }))
  expect(screen.getByRole("textbox")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.editCancel }))
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("renders highlighted frontmatter fields and allowed-tools chips", () => {
  const rich: SkillRow = {
    dirName: "deploy",
    name: "deploy",
    description: "Deploys the app",
    nameMismatch: false,
    modifiedAt: 0,
    entries: {
      claude: {
        source: "claude",
        dirName: "deploy",
        path: "/h/.claude/skills/deploy",
        isSymlink: false,
        linkTarget: null,
        skillMd:
          "---\nname: deploy\nwhen_to_use: on release\nallowed-tools: Read Grep\nmodel: opus\n---\nbody",
        modifiedAt: 0,
        origin: null,
      },
    },
  }
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <SkillDetailDialog row={rich} open onOpenChange={jest.fn()} refresh={jest.fn()} />
      </RunnerHarness>
    </I18nProvider>
  )
  expect(screen.getByText(en.skillsBrowser.whenToUseLabel)).toBeInTheDocument()
  expect(screen.getByText("on release")).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.allowedToolsLabel)).toBeInTheDocument()
  expect(screen.getByText("Read")).toBeInTheDocument()
  expect(screen.getByText("Grep")).toBeInTheDocument()
})

it("lists the skill's supporting files with sizes", async () => {
  renderDialog()
  expect(await screen.findByText("reference.md")).toBeInTheDocument()
  // 2048 bytes renders as KB.
  expect(screen.getByText("2.0 KB")).toBeInTheDocument()
  expect(screen.getByText("scripts")).toBeInTheDocument()
})

it("edits SKILL.md and saves the new content through the runner", async () => {
  renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.edit }))
  const textarea = screen.getByRole("textbox")
  await userEvent.clear(textarea)
  await userEvent.type(textarea, "edited body")
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.editSave }))
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(
      "/h/.claude/skills/find-docs/SKILL.md",
      "edited body"
    )
  )
})

it("asks before Esc throws away an edited SKILL.md", async () => {
  const onOpenChange = jest.fn()
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <SkillDetailDialog row={row} open onOpenChange={onOpenChange} refresh={jest.fn()} />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.edit }))
  await userEvent.type(screen.getByRole("textbox"), " more")
  await userEvent.keyboard("{Escape}")
  expect(await screen.findByText(en.skillsBrowser.editDiscardTitle)).toBeInTheDocument()
  expect(onOpenChange).not.toHaveBeenCalled()
  // Keep editing: the draft is still there.
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.editKeep }))
  expect(screen.getByRole("textbox")).toHaveValue(`${skillMd} more`)
  // Discard: now it closes.
  await userEvent.keyboard("{Escape}")
  await userEvent.click(await screen.findByRole("button", { name: en.skillsBrowser.editDiscard }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it("closes without asking when the draft is unchanged", async () => {
  const onOpenChange = jest.fn()
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <SkillDetailDialog row={row} open onOpenChange={onOpenChange} refresh={jest.fn()} />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.edit }))
  await userEvent.keyboard("{Escape}")
  expect(onOpenChange).toHaveBeenCalledWith(false)
  expect(screen.queryByText(en.skillsBrowser.editDiscardTitle)).not.toBeInTheDocument()
})

it("stays in the editor, draft intact, when the save fails", async () => {
  ;(writeTextFile as jest.Mock).mockRejectedValueOnce(new Error("read-only file system"))
  const refresh = jest.fn()
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <SkillDetailDialog row={row} open onOpenChange={jest.fn()} refresh={refresh} />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.edit }))
  const textarea = screen.getByRole("textbox")
  await userEvent.clear(textarea)
  await userEvent.type(textarea, "edited body")
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.editSave }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(screen.getByRole("textbox")).toHaveValue("edited body")
})
