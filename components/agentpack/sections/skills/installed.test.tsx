jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/system", () => ({ revealPath: jest.fn(), openPath: jest.fn() }))
jest.mock("@/lib/tauri/commands", () => ({
  pathExists: jest.fn(async () => false),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  removeDir: jest.fn(async () => undefined),
  installSkillFromDir: jest.fn(async () => ["/h/.codex/skills/caveman"]),
  listSkillFiles: jest.fn(async () => []),
  checkRepoUpdates: jest.fn(async () => []),
  updateSkill: jest.fn(async () => ["/h/.claude/skills/web"]),
  listSkillBackups: jest.fn(async () => []),
  backupSkill: jest.fn(async () => ({
    id: "caveman-1",
    name: "caveman",
    dirName: "caveman",
    source: "claude",
    bytes: 0,
    createdAt: 0,
  })),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import {
  checkRepoUpdates,
  installSkillFromDir,
  readTextFile,
  removeDir,
  updateSkill,
} from "@/lib/tauri/commands"
import type { InstalledSkill, SkillsScanResult } from "@/lib/skills/types"
import { openPath, revealPath } from "@/lib/tauri/system"
import { RunnerHarness } from "../../run/__testing__/harness"
import { InstalledSkillsTab } from "./installed"

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

function skill(
  over: Partial<InstalledSkill> & { source: InstalledSkill["source"]; dirName: string }
): InstalledSkill {
  return {
    path: `/h/${over.source}/${over.dirName}`,
    isSymlink: false,
    linkTarget: null,
    skillMd: `---\nname: ${over.dirName}\ndescription: about ${over.dirName}\n---\n# ${over.dirName}\n`,
    modifiedAt: 0,
    origin: null,
    ...over,
  }
}

const scan: SkillsScanResult = {
  skills: [
    skill({
      source: "claude",
      dirName: "caveman",
      path: "/h/.claude/skills/caveman",
      isSymlink: true,
      linkTarget: "/h/.agents/skills/caveman",
    }),
    skill({ source: "agents", dirName: "caveman", path: "/h/.agents/skills/caveman" }),
    skill({ source: "codex", dirName: "tauri-v2", path: "/h/.codex/skills/tauri-v2" }),
    skill({ source: "claude", dirName: "rust", path: "/h/.claude/skills/rust" }),
  ],
  errors: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(readTextFile as jest.Mock).mockResolvedValue("{}")
  useAppStore.setState({ paths, panelOpen: false })
})

function renderTab(refresh = jest.fn()) {
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <InstalledSkillsTab scan={scan} refresh={refresh} />
      </RunnerHarness>
    </I18nProvider>
  )
  return refresh
}

/**
 * Pick a status — the select moved inside the refinement popover, which stays
 * open after a choice, so only open it when it isn't already.
 */
async function pickStatus(label: string) {
  const name = en.skillsBrowser.statusFilter
  if (!screen.queryByRole("combobox", { name })) {
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }))
  }
  await userEvent.click(await screen.findByRole("combobox", { name }))
  await userEvent.click(await screen.findByRole("option", { name: label }))
}

it("groups skills into rows with source, symlink and bundled tags", async () => {
  renderTab()
  // caveman + tauri-v2 + rust = 3 rows (caveman groups claude + agents).
  expect(screen.getByText("caveman")).toBeInTheDocument()
  expect(screen.getByText("tauri-v2")).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.symlinkBadge)).toBeInTheDocument()
  // "rust" is a bundled registry id.
  expect(screen.getByText(en.skillsBrowser.bundledBadge)).toBeInTheDocument()
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())
})

it("filters by source pill and by search query", async () => {
  renderTab()
  await userEvent.click(screen.getByRole("button", { name: /Codex 1/ }))
  expect(screen.queryByText("caveman")).not.toBeInTheDocument()
  expect(screen.getByText("tauri-v2")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: /All/ }))
  await userEvent.type(screen.getByLabelText(en.skillsBrowser.searchPlaceholder), "cave")
  expect(screen.getByText("caveman")).toBeInTheDocument()
  expect(screen.queryByText("tauri-v2")).not.toBeInTheDocument()
})

it("filters installed skills by management and issue status", async () => {
  renderTab()
  await userEvent.click(screen.getByRole("button", { name: /Filters/ }))
  await userEvent.click(
    await screen.findByRole("combobox", { name: en.skillsBrowser.statusFilter })
  )
  expect(screen.getByRole("option", { name: en.skillsBrowser.statusManaged })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: en.skillsBrowser.statusUnmanaged })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: en.skillsBrowser.statusUpdates })).toBeInTheDocument()
  expect(screen.getByRole("option", { name: en.skillsBrowser.statusIssues })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("option", { name: en.skillsBrowser.statusManaged }))
  expect(screen.getByText(en.skillsBrowser.emptyFiltered)).toBeInTheDocument()
  // The folded filter announces itself, so it can never silently hide rows.
  expect(screen.getByRole("button", { name: /Filters 1/ })).toBeInTheDocument()
})

it("treats divergent copies across skill sources as a conflict", async () => {
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <InstalledSkillsTab
          scan={{
            skills: [
              skill({ source: "claude", dirName: "shared", path: "/c/shared" }),
              skill({
                source: "codex",
                dirName: "shared",
                path: "/x/shared",
                skillMd: "---\nname: shared\n---\n# Different content\n",
              }),
            ],
            errors: [],
          }}
          refresh={jest.fn()}
        />
      </RunnerHarness>
    </I18nProvider>
  )
  await pickStatus(en.skillsBrowser.statusIssues)
  expect(screen.getByText("shared")).toBeInTheDocument()
})

it("shows scan errors only in the all and issues status views", async () => {
  const message = en.skillsBrowser.scanError("Codex", "permission denied")
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <InstalledSkillsTab
          scan={{ ...scan, errors: [{ source: "codex", message: "permission denied" }] }}
          refresh={jest.fn()}
        />
      </RunnerHarness>
    </I18nProvider>
  )

  expect(screen.getByText(message)).toBeInTheDocument()
  await pickStatus(en.skillsBrowser.statusUnmanaged)
  expect(screen.queryByText(message)).not.toBeInTheDocument()
  await pickStatus(en.skillsBrowser.statusIssues)
  expect(screen.getByText(message)).toBeInTheDocument()
})

it("shows the filtered-empty state when nothing matches", async () => {
  renderTab()
  await userEvent.type(screen.getByLabelText(en.skillsBrowser.searchPlaceholder), "zzz")
  expect(screen.getByText(en.skillsBrowser.emptyFiltered)).toBeInTheDocument()
})

it("deletes a skill from one source after confirmation", async () => {
  const refresh = renderTab()
  // caveman row is first; open its actions menu.
  await userEvent.click(screen.getAllByRole("button", { name: en.skillsBrowser.actions })[0])
  await userEvent.click(
    await screen.findByRole("menuitem", { name: en.skillsBrowser.deleteFrom("Claude Code") })
  )
  // Confirm dialog explains symlink-safe deletion, then deletes the real path.
  expect(
    await screen.findByText(en.skillsBrowser.deleteConfirmTitle("caveman"))
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.confirmDelete }))
  await waitFor(() => expect(removeDir).toHaveBeenCalledWith("/h/.claude/skills/caveman"))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

it("copies a skill to an agent it is missing from", async () => {
  const refresh = renderTab()
  await userEvent.click(screen.getAllByRole("button", { name: en.skillsBrowser.actions })[0])
  await userEvent.click(
    await screen.findByRole("menuitem", { name: en.skillsBrowser.copyTo("Codex") })
  )
  // The canonical (agents) copy is the source, resolved content not the symlink.
  await waitFor(() =>
    expect(installSkillFromDir).toHaveBeenCalledWith("/h/.agents/skills/caveman", "caveman", [
      "codex",
    ])
  )
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

it("opens and closes the detail dialog", async () => {
  renderTab()
  await userEvent.click(screen.getByText("tauri-v2"))
  expect(await screen.findByText(en.skillsBrowser.configTitle)).toBeInTheDocument()
  await userEvent.keyboard("{Escape}")
  await waitFor(() =>
    expect(screen.queryByText(en.skillsBrowser.configTitle)).not.toBeInTheDocument()
  )
})

it("shows an inline enable-status badge for a non-default skill", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (path: string) =>
    path.endsWith("settings.json")
      ? JSON.stringify({ skillOverrides: { "tauri-v2": "off" } })
      : "{}"
  )
  renderTab()
  expect(await screen.findByText(en.skillsBrowser.visibility["off"])).toBeInTheDocument()
})

it("reveals and opens a skill from the row menu", async () => {
  renderTab()
  const actions = () => screen.getAllByRole("button", { name: en.skillsBrowser.actions })[0]
  await userEvent.click(actions())
  await userEvent.click(
    await screen.findByRole("menuitem", { name: en.skillsBrowser.revealInFolder })
  )
  await waitFor(() => expect(revealPath).toHaveBeenCalled())
  await userEvent.click(actions())
  await userEvent.click(await screen.findByRole("menuitem", { name: en.skillsBrowser.openSkillMd }))
  await waitFor(() => expect(openPath).toHaveBeenCalledWith(expect.stringContaining("SKILL.md")))
})

it("opens the backups dialog from the toolbar", async () => {
  renderTab()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.backups }))
  expect(await screen.findByText(en.skillsBrowser.backupsTitle)).toBeInTheDocument()
})

it("checks for updates and flags a managed skill with a pending update", async () => {
  const onUpdateCountChange = jest.fn()
  const managedScan: SkillsScanResult = {
    skills: [
      skill({
        source: "claude",
        dirName: "web",
        path: "/h/.claude/skills/web",
        origin: { repo: "o/r", ref: "HEAD", relPath: "", contentHash: "h1", installedAt: 0 },
      }),
    ],
    errors: [],
  }
  ;(checkRepoUpdates as jest.Mock).mockResolvedValue([
    { path: "/h/.claude/skills/web", hasUpdate: true, latestHash: "h2", error: null },
  ])
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <InstalledSkillsTab
          scan={managedScan}
          refresh={jest.fn()}
          onUpdateCountChange={onUpdateCountChange}
        />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.checkUpdates }))
  await waitFor(() =>
    expect(checkRepoUpdates).toHaveBeenCalledWith(
      [{ path: "/h/.claude/skills/web", origin: expect.objectContaining({ repo: "o/r" }) }],
      null
    )
  )
  expect(await screen.findByText(en.skillsBrowser.updateAvailable)).toBeInTheDocument()
  await waitFor(() => expect(onUpdateCountChange).toHaveBeenLastCalledWith(1))

  // "Update all" re-syncs the managed skill through the runner.
  await userEvent.click(screen.getByRole("button", { name: /Update all/ }))
  await waitFor(() =>
    expect(updateSkill).toHaveBeenCalledWith("/h/.claude/skills/web", ["claude"], null)
  )
})

it("updates a single managed skill from its row menu", async () => {
  const managedScan: SkillsScanResult = {
    skills: [
      skill({
        source: "claude",
        dirName: "web",
        path: "/h/.claude/skills/web",
        origin: { repo: "o/r", ref: "HEAD", relPath: "", contentHash: "h1", installedAt: 0 },
      }),
    ],
    errors: [],
  }
  ;(checkRepoUpdates as jest.Mock).mockResolvedValue([
    { path: "/h/.claude/skills/web", hasUpdate: true, latestHash: "h2", error: null },
  ])
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <InstalledSkillsTab scan={managedScan} refresh={jest.fn()} />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.checkUpdates }))
  await screen.findByText(en.skillsBrowser.updateAvailable)
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.actions }))
  await userEvent.click(await screen.findByRole("menuitem", { name: en.skillsBrowser.update }))
  await waitFor(() =>
    expect(updateSkill).toHaveBeenCalledWith("/h/.claude/skills/web", ["claude"], null)
  )
})
