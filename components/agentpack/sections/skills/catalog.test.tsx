jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  installSkill: jest.fn(async () => ["/h/.claude/skills/cpp-cmake"]),
  removeDir: jest.fn(async () => undefined),
  backupSkill: jest.fn(async () => ({
    id: "rust-1",
    name: "rust",
    dirName: "rust",
    source: "claude",
    bytes: 0,
    createdAt: 0,
  })),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerHarness } from "../../run/__testing__/harness"
import { useAppStore } from "@/store/app-store"
import { backupSkill, installSkill, removeDir } from "@/lib/tauri/commands"
import type { SkillsScanResult } from "@/lib/skills/types"
import { CatalogTab } from "./catalog"

const paths = {
  home: "/h",
  claudeSkillsDir: "/h/.claude/skills",
  codexSkillsDir: "/h/.codex/skills",
  opencodeSkillsDir: "/h/.config/opencode/skills",
  agentsSkillsDir: "/h/.agents/skills",
  os: "mac",
} as never

const emptyScan: SkillsScanResult = { skills: [], errors: [] }
const rustInstalled: SkillsScanResult = {
  skills: [
    {
      source: "claude",
      dirName: "rust",
      path: "/h/.claude/skills/rust",
      isSymlink: false,
      linkTarget: null,
      skillMd: "---\nname: rust\n---\n",
      modifiedAt: 0,
      origin: null,
    },
  ],
  errors: [],
}

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths, panelOpen: false })
})

function renderCatalog(scan: SkillsScanResult = emptyScan, refresh = jest.fn()) {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <CatalogTab scan={scan} refresh={refresh} />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("offers all five skill roots as one-click install chips", () => {
  renderCatalog()
  // 6 bundled skills × 5 roots, each a single toggle rather than a checkbox
  // plus a pair of buttons that only appear once it is ticked.
  expect(screen.getAllByTitle(/^Install into /).length).toBe(30)
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
})

it("marks the roots a bundled skill is already installed in", () => {
  renderCatalog(rustInstalled)
  expect(screen.getByTitle("Delete from Claude Code")).toBeInTheDocument()
  expect(screen.getAllByTitle(/^Install into /).length).toBe(29)
})

it("installs into a root in one click, through the runner", async () => {
  renderCatalog()
  await userEvent.click(screen.getAllByTitle("Install into Claude Code")[0])
  await waitFor(() => expect(installSkill).toHaveBeenCalled())
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("confirms, then backs the skill up before removing it from a root", async () => {
  renderCatalog(rustInstalled)
  await userEvent.click(screen.getByTitle("Delete from Claude Code"))
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }))
  await waitFor(() => expect(removeDir).toHaveBeenCalledWith("/h/.claude/skills/rust"))
  // Backups promises a copy of every deleted skill; this path used to skip it.
  expect(backupSkill).toHaveBeenCalledWith("/h/.claude/skills/rust")
  expect((backupSkill as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (removeDir as jest.Mock).mock.invocationCallOrder[0]
  )
})

it("keeps the skill when its backup fails", async () => {
  ;(backupSkill as jest.Mock).mockRejectedValueOnce(new Error("disk full"))
  const refresh = jest.fn()
  renderCatalog(rustInstalled, refresh)
  await userEvent.click(screen.getByTitle("Delete from Claude Code"))
  await userEvent.click(await screen.findByRole("button", { name: /^Delete$/ }))
  // `refresh` follows the settled run, so the remove has had its chance.
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(backupSkill).toHaveBeenCalled()
  expect(removeDir).not.toHaveBeenCalled()
})
