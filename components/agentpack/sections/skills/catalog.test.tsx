jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  pathExists: jest.fn(async () => true),
  installSkill: jest.fn(async () => ["/h/.claude/skills/rust"]),
  removeDir: jest.fn(async () => undefined),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { installSkill, removeDir, pathExists } from "@/lib/tauri/commands"
import { CatalogTab } from "./catalog"

const paths = {
  home: "/h",
  claudeSkillsDir: "/h/.claude/skills",
  codexSkillsDir: "/h/.codex/skills",
  os: "mac",
} as never

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths, dryRun: false, panelOpen: false })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
})

function renderSkills() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <CatalogTab />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("checking a target adds the skill with that target", async () => {
  renderSkills()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  const skills = useAppStore.getState().plan.skills
  expect(skills.length).toBeGreaterThan(0)
  expect(skills[0].targets).toContain("claude")
})

it("reveals install/uninstall actions once a target is selected", async () => {
  renderSkills()
  expect(screen.queryByRole("button", { name: /Install now/i })).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(screen.getAllByRole("button", { name: /Install now/i }).length).toBeGreaterThan(0)
})

it("shows an installed badge once detection resolves", async () => {
  renderSkills()
  expect((await screen.findAllByText(/Installed/i)).length).toBeGreaterThan(0)
})

it("install now runs the install step through the runner", async () => {
  renderSkills()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  await userEvent.click(screen.getAllByRole("button", { name: /Install now/i })[0])
  await waitFor(() => expect(installSkill).toHaveBeenCalled())
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("uninstall now removes the skill destinations", async () => {
  renderSkills()
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  await userEvent.click(screen.getAllByRole("button", { name: /Uninstall now/i })[0])
  await waitFor(() => expect(removeDir).toHaveBeenCalled())
})
