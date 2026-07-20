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
import { RunnerProvider } from "../../run/runner-context"
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
  useAppStore.setState({ paths, dryRun: false, panelOpen: false })
})

function renderCatalog(scan: SkillsScanResult = emptyScan) {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <CatalogTab scan={scan} refresh={jest.fn()} />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("reveals install/uninstall actions once a target is selected", async () => {
  renderCatalog()
  expect(screen.queryByRole("button", { name: /Install now/i })).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(screen.getAllByRole("button", { name: /Install now/i }).length).toBeGreaterThan(0)
})

it("offers all four skill roots as install targets", () => {
  renderCatalog()
  // 6 bundled skills × 4 sources.
  expect(screen.getAllByRole("checkbox").length).toBe(24)
})

it("shows an installed badge derived from the scan", () => {
  renderCatalog(rustInstalled)
  expect(screen.getAllByText(/Installed:/i).length).toBeGreaterThan(0)
})

it("install now runs the install step through the runner", async () => {
  renderCatalog()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  await userEvent.click(screen.getAllByRole("button", { name: /Install now/i })[0])
  await waitFor(() => expect(installSkill).toHaveBeenCalled())
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("uninstall now removes the skill destinations", async () => {
  renderCatalog()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  await userEvent.click(screen.getAllByRole("button", { name: /Uninstall now/i })[0])
  await waitFor(() => expect(removeDir).toHaveBeenCalled())
})
