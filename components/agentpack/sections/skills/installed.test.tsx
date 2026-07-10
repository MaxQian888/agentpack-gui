jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  pathExists: jest.fn(async () => false),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  removeDir: jest.fn(async () => undefined),
  installSkillFromDir: jest.fn(async () => ["/h/.codex/skills/caveman"]),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { installSkillFromDir, removeDir } from "@/lib/tauri/commands"
import type { InstalledSkill, SkillsScanResult } from "@/lib/skills/types"
import { RunnerProvider } from "../../run/runner-context"
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
  useAppStore.setState({ paths, dryRun: false, panelOpen: false })
})

function renderTab(refresh = jest.fn()) {
  render(
    <I18nProvider>
      <RunnerProvider>
        <InstalledSkillsTab scan={scan} refresh={refresh} />
      </RunnerProvider>
    </I18nProvider>
  )
  return refresh
}

it("groups skills into rows with source, symlink and bundled badges", () => {
  renderTab()
  // caveman + tauri-v2 + rust = 3 rows (caveman groups claude + agents).
  expect(screen.getByText("caveman")).toBeInTheDocument()
  expect(screen.getByText("tauri-v2")).toBeInTheDocument()
  expect(screen.getByText(en.skillsBrowser.symlinkBadge)).toBeInTheDocument()
  // "rust" is a bundled registry id.
  expect(screen.getByText(en.skillsBrowser.bundledBadge)).toBeInTheDocument()
})

it("filters by source pill and by search query", async () => {
  renderTab()
  await userEvent.click(screen.getByRole("button", { name: /Codex 1/ }))
  expect(screen.queryByText("caveman")).not.toBeInTheDocument()
  expect(screen.getByText("tauri-v2")).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: /All/ }))
  await userEvent.type(screen.getByPlaceholderText(en.skillsBrowser.searchPlaceholder), "cave")
  expect(screen.getByText("caveman")).toBeInTheDocument()
  expect(screen.queryByText("tauri-v2")).not.toBeInTheDocument()
})

it("shows the filtered-empty state when nothing matches", async () => {
  renderTab()
  await userEvent.type(screen.getByPlaceholderText(en.skillsBrowser.searchPlaceholder), "zzz")
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

it("opens the detail dialog from a row click", async () => {
  renderTab()
  await userEvent.click(screen.getByText("tauri-v2"))
  expect(await screen.findByText(en.skillsBrowser.configTitle)).toBeInTheDocument()
})
