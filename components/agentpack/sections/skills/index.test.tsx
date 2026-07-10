jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  pathExists: jest.fn(async () => false),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  removeDir: jest.fn(async () => undefined),
  installSkill: jest.fn(async () => []),
  installSkillFromDir: jest.fn(async () => []),
  fetchRepoSkills: jest.fn(async () => ({ scanId: "s", skills: [] })),
  installRepoSkills: jest.fn(async () => []),
  cleanupRepoScan: jest.fn(async () => undefined),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickFolder: jest.fn(async () => null) }))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import type { SkillsScanResult } from "@/lib/skills/types"
import { RunnerProvider } from "../../run/runner-context"
import { SkillsSection } from "./index"

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

beforeEach(() => {
  useAppStore.setState({ paths, dryRun: false, panelOpen: false })
})

function renderSection(scan: SkillsScanResult | null, loading = false) {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <SkillsSection scan={scan} loading={loading} refresh={jest.fn()} />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("shows a loading state while the scan is pending", () => {
  renderSection(null)
  expect(screen.getByText(en.skillsBrowser.loading)).toBeInTheDocument()
})

it("renders the three tabs and surfaces scan errors", () => {
  renderSection({
    skills: [],
    errors: [{ source: "codex", message: "boom" }],
  })
  expect(screen.getByRole("tab", { name: en.skillsBrowser.tabInstalled })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: en.skillsBrowser.tabCatalog })).toBeInTheDocument()
  expect(screen.getByRole("tab", { name: en.skillsBrowser.tabAdd })).toBeInTheDocument()
  expect(screen.getByText(/Scan failed for Codex: boom/)).toBeInTheDocument()
})

it("shows the empty state when no skills exist anywhere", () => {
  renderSection({ skills: [], errors: [] })
  expect(screen.getByText(en.skillsBrowser.empty)).toBeInTheDocument()
})

it("switches to the bundled catalog tab", async () => {
  renderSection({ skills: [], errors: [] })
  await userEvent.click(screen.getByRole("tab", { name: en.skillsBrowser.tabCatalog }))
  // The six bundled skills render with their catalog titles.
  expect(await screen.findByText(en.catalog.skills["rust"].title)).toBeInTheDocument()
})

it("switches to the add tab", async () => {
  renderSection({ skills: [], errors: [] })
  await userEvent.click(screen.getByRole("tab", { name: en.skillsBrowser.tabAdd }))
  expect(await screen.findByText(en.skillsBrowser.addGithubTitle)).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.addLocalTitle)).toBeInTheDocument()
})
