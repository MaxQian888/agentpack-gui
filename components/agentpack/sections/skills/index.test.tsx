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
  checkRepoUpdates: jest.fn(async () => []),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickFolder: jest.fn(async () => null) }))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import type { SkillsScanResult } from "@/lib/skills/types"
import { RunnerHarness } from "../../run/__testing__/harness"
import { SkillsSection } from "./index"
import { checkRepoUpdates, readTextFile } from "@/lib/tauri/commands"

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
  jest.clearAllMocks()
  useAppStore.setState({ paths, panelOpen: false })
})

function renderSection(scan: SkillsScanResult | null, loading = false) {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <SkillsSection scan={scan} loading={loading} refresh={jest.fn()} />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("shows a loading state while the scan is pending", () => {
  renderSection(null)
  expect(screen.getByText(en.skillsBrowser.loading)).toBeInTheDocument()
})

it("renders the installed workbench with tiled catalog and add actions", async () => {
  renderSection({
    skills: [],
    errors: [{ source: "codex", message: "boom" }],
  })
  expect(screen.getByRole("region", { name: en.skillsBrowser.summaryLabel })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.skillsBrowser.tabCatalog })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.skillsBrowser.tabAdd })).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.statTotal)).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.statManaged)).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.statUpdates)).toBeInTheDocument()
  // A failed scan is a headline fact exactly when there is one.
  expect(screen.getByText(en.skillsBrowser.statScanIssues)).toBeInTheDocument()
  expect(screen.getByText(/Scan failed for Codex: boom/)).toBeInTheDocument()
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())
})

it("keeps the summary to three facts when every root scanned cleanly", async () => {
  renderSection({ skills: [], errors: [] })
  const summary = within(screen.getByRole("region", { name: en.skillsBrowser.summaryLabel }))
  expect(summary.queryByText(en.skillsBrowser.statScanIssues)).not.toBeInTheDocument()
  // "Sources" and its per-root breakdown moved onto the scope chips, which
  // carry the same counts and also filter by them.
  expect(summary.queryByText(en.skillsBrowser.statSources)).not.toBeInTheDocument()
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())
})

it("offers the bundled catalog as the empty state's next step", async () => {
  renderSection({ skills: [], errors: [] })
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.emptyBrowse }))
  expect(await screen.findByText(en.catalog.skills["rust"].title)).toBeInTheDocument()
})

it("shows the empty state when no skills exist anywhere", async () => {
  renderSection({ skills: [], errors: [] })
  expect(screen.getByText(en.skillsBrowser.empty)).toBeInTheDocument()
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())
})

it("opens the bundled catalog", async () => {
  renderSection({ skills: [], errors: [] })
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.tabCatalog }))
  // The six bundled skills render with their catalog titles.
  expect(await screen.findByText(en.catalog.skills["rust"].title)).toBeInTheDocument()
})

it("opens the add-skills view", async () => {
  renderSection({ skills: [], errors: [] })
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.tabAdd }))
  expect(await screen.findByText(en.skillsBrowser.addGithubTitle)).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.addLocalTitle)).toBeInTheDocument()
})

it("swaps the column rather than opening a panel under the installed list", async () => {
  // With twenty-odd skills installed, appending the catalog below them put it a
  // screen and a half down: the click looked like it had done nothing.
  const installed: SkillsScanResult = {
    skills: [
      {
        path: "/h/.claude/skills/fornax-cli",
        source: "claude",
        dirName: "fornax-cli",
        isSymlink: false,
        linkTarget: null,
        skillMd: "---\nname: fornax-cli\ndescription: about it\n---\n",
        modifiedAt: 0,
        origin: null,
      },
    ],
    errors: [],
  }
  renderSection(installed)
  expect(await screen.findByText("fornax-cli")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.tabCatalog }))
  expect(await screen.findByText(en.catalog.skills["rust"].title)).toBeInTheDocument()
  expect(screen.queryByText("fornax-cli")).not.toBeInTheDocument()

  // And the aside is the way back — the installed list is one of its choices.
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.tabInstalled }))
  expect(await screen.findByText("fornax-cli")).toBeInTheDocument()
  expect(screen.queryByText(en.catalog.skills["rust"].title)).not.toBeInTheDocument()
})

const managed: SkillsScanResult = {
  skills: [
    {
      path: "/h/.claude/skills/web",
      source: "claude",
      dirName: "web",
      isSymlink: false,
      linkTarget: null,
      skillMd: "---\nname: web\n---\n",
      modifiedAt: 0,
      origin: { repo: "o/r", ref: "HEAD", relPath: "", contentHash: "h1", installedAt: 0 },
    },
  ],
  errors: [],
}

it("reads Updates as unmeasured, not zero, until someone checks", async () => {
  renderSection(managed)
  const summary = within(screen.getByRole("region", { name: en.skillsBrowser.summaryLabel }))
  expect(summary.getByText(en.skillsBrowser.statUpdates).parentElement).toHaveTextContent("—")
  expect(summary.getByText(en.skillsBrowser.statUpdatesPending)).toBeInTheDocument()
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())
})

it("keeps checked updates when the installed view is left and reopened", async () => {
  ;(checkRepoUpdates as jest.Mock).mockResolvedValue([
    { path: "/h/.claude/skills/web", hasUpdate: true, latestHash: "h2", error: null },
  ])
  renderSection(managed)
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.checkUpdates }))
  expect(await screen.findByText(en.skillsBrowser.updateAvailable)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.tabCatalog }))
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.tabInstalled }))
  // The check was a network round-trip per skill; switching views used to drop it.
  expect(await screen.findByText(en.skillsBrowser.updateAvailable)).toBeInTheDocument()
  const summary = within(screen.getByRole("region", { name: en.skillsBrowser.summaryLabel }))
  expect(summary.getByText(en.skillsBrowser.statUpdates).parentElement).toHaveTextContent("1")
})

it("shows a failed scan as a failure with a retry, not as an empty disk", async () => {
  const refresh = jest.fn()
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <SkillsSection scan={null} loading={false} refresh={refresh} error="permission denied" />
      </RunnerHarness>
    </I18nProvider>
  )
  expect(screen.getByText(en.skillsBrowser.scanFailed("permission denied"))).toBeInTheDocument()
  expect(screen.queryByText(en.skillsBrowser.empty)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.retry }))
  expect(refresh).toHaveBeenCalled()
})
