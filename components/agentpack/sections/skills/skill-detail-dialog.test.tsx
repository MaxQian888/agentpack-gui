jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  pathExists: jest.fn(async () => false),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { readTextFile, writeTextFile } from "@/lib/tauri/commands"
import type { SkillRow } from "@/lib/skills/types"
import { RunnerProvider } from "../../run/runner-context"
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
    },
  },
}

beforeEach(() => {
  useAppStore.setState({ paths, dryRun: false, panelOpen: false })
})

function renderDialog() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <SkillDetailDialog row={row} open onOpenChange={jest.fn()} />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("renders frontmatter attrs, path metadata and the markdown body", async () => {
  renderDialog()
  // Frontmatter card lists raw attributes.
  expect(screen.getByText(en.skillsBrowser.frontmatterTitle)).toBeInTheDocument()
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
