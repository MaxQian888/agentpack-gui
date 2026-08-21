jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  installSkill: jest.fn(async () => ["/h/.claude/skills/cpp-cmake"]),
  removeDir: jest.fn(async () => undefined),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerHarness } from "../../run/__testing__/harness"
import { useAppStore } from "@/store/app-store"
import { installSkill, removeDir } from "@/lib/tauri/commands"
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

function renderCatalog(scan: SkillsScanResult = emptyScan) {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <CatalogTab scan={scan} refresh={jest.fn()} />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("offers all four skill roots as one-click install chips", () => {
  renderCatalog()
  // 6 bundled skills × 4 roots, each a single toggle rather than a checkbox
  // plus a pair of buttons that only appear once it is ticked.
  expect(screen.getAllByTitle(/^Install into /).length).toBe(24)
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
})

it("marks the roots a bundled skill is already installed in", () => {
  renderCatalog(rustInstalled)
  expect(screen.getByTitle("Delete from Claude Code")).toBeInTheDocument()
  expect(screen.getAllByTitle(/^Install into /).length).toBe(23)
})

it("installs into a root in one click, through the runner", async () => {
  renderCatalog()
  await userEvent.click(screen.getAllByTitle("Install into Claude Code")[0])
  await waitFor(() => expect(installSkill).toHaveBeenCalled())
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("confirms before removing a skill from a root", async () => {
  renderCatalog(rustInstalled)
  await userEvent.click(screen.getByTitle("Delete from Claude Code"))
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }))
  await waitFor(() => expect(removeDir).toHaveBeenCalled())
})
