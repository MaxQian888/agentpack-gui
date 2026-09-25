jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  pathExists: jest.fn(async () => true),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  runCommand: jest.fn(async () => 0),
  installSkillFromDir: jest.fn(async () => ["/h/.claude/skills/my-skill"]),
  fetchRepoSkills: jest.fn(async () => ({ scanId: "scan-1", skills: [] })),
  installRepoSkills: jest.fn(async () => ["/h/.claude/skills/web-design"]),
  cleanupRepoScan: jest.fn(async () => undefined),
  createSkill: jest.fn(async () => ["/h/.claude/skills/my-skill"]),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickFolder: jest.fn(async () => null) }))
jest.mock("@/lib/tauri/settings", () => ({
  DEFAULT_SETTINGS: {
    autoCheckUpdates: true,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    quickStartDismissed: false,
    ghMirrorPrefix: null,
  },
  loadSettings: jest.fn(async () => ({})),
  saveSettings: jest.fn(async () => ({})),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import {
  cleanupRepoScan,
  createSkill,
  fetchRepoSkills,
  installRepoSkills,
  installSkillFromDir,
  pathExists,
  runCommand,
} from "@/lib/tauri/commands"
import { pickFolder } from "@/lib/tauri/dialog"
import { saveSettings } from "@/lib/tauri/settings"
import { RunnerHarness } from "../../run/__testing__/harness"
import { AddSkillsTab } from "./add"

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
  useAppStore.setState({
    paths,
    panelOpen: false,
    settings: {
      autoCheckUpdates: true,
      skippedVersion: null,
      lastCheckAt: null,
      onboarded: false,
      quickStartDismissed: false,
      ghMirrorPrefix: null,
      skillRepoSources: [],
    },
  } as never)
})

function renderAdd(refresh = jest.fn()) {
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <AddSkillsTab installed={{ skills: [], errors: [] }} refresh={refresh} />
      </RunnerHarness>
    </I18nProvider>
  )
  return refresh
}

it("rejects an invalid GitHub source", async () => {
  renderAdd()
  await userEvent.type(
    screen.getByPlaceholderText(en.skillsBrowser.sourcePlaceholder),
    "not a repo"
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.fetchSkills }))
  expect(await screen.findByText(en.skillsBrowser.invalidSource)).toBeInTheDocument()
  expect(fetchRepoSkills).not.toHaveBeenCalled()
})

it("fetches repo skills, lets the user pick, installs and cleans up", async () => {
  ;(fetchRepoSkills as jest.Mock).mockResolvedValue({
    scanId: "scan-1",
    skills: [
      {
        dirName: "web-design",
        relPath: "skills/web-design",
        skillMd: "---\nname: web-design\ndescription: Design guidelines\n---\n",
      },
      { dirName: "react", relPath: "skills/react", skillMd: "---\nname: react\n---\n" },
    ],
  })
  const refresh = renderAdd()
  await userEvent.type(
    screen.getByPlaceholderText(en.skillsBrowser.sourcePlaceholder),
    "vercel-labs/agent-skills"
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.fetchSkills }))
  await waitFor(() =>
    expect(fetchRepoSkills).toHaveBeenCalledWith(
      "https://codeload.github.com/vercel-labs/agent-skills/tar.gz/HEAD"
    )
  )
  // Both skills listed with frontmatter names, pre-selected.
  expect(await screen.findByText("web-design")).toBeInTheDocument()
  expect(screen.getByText("Design guidelines")).toBeInTheDocument()
  // Deselect one, then install the rest into the default targets.
  await userEvent.click(screen.getByText("react"))
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.installSelected(1) }))
  await waitFor(() =>
    expect(installRepoSkills).toHaveBeenCalledWith(
      "scan-1",
      ["skills/web-design"],
      ["claude", "codex"],
      "vercel-labs/agent-skills",
      "HEAD"
    )
  )
  await waitFor(() => expect(cleanupRepoScan).toHaveBeenCalledWith("scan-1"))
  expect(refresh).toHaveBeenCalled()
})

it("reports a repo with no skills", async () => {
  ;(fetchRepoSkills as jest.Mock).mockResolvedValue({ scanId: "scan-2", skills: [] })
  renderAdd()
  await userEvent.type(screen.getByPlaceholderText(en.skillsBrowser.sourcePlaceholder), "o/r")
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.fetchSkills }))
  expect(await screen.findByText(en.skillsBrowser.noSkillsInRepo)).toBeInTheDocument()
  await waitFor(() => expect(cleanupRepoScan).toHaveBeenCalledWith("scan-2"))
})

it("runs the npx skills CLI escape hatch with the picked targets", async () => {
  renderAdd()
  await userEvent.type(screen.getByPlaceholderText(en.skillsBrowser.sourcePlaceholder), "o/r")
  await userEvent.click(screen.getByText(en.skillsBrowser.advancedTitle))
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.useNpx }))
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
  const cmd = (runCommand as jest.Mock).mock.calls[0][0]
  expect(cmd).toMatchObject({ file: "npx" })
  expect(cmd.args).toEqual(
    expect.arrayContaining(["skills", "add", "o/r", "-g", "-a", "claude-code", "codex"])
  )
})

it("validates a picked local folder and imports it", async () => {
  const refresh = renderAdd()
  // First pick: not a skill folder.
  ;(pickFolder as jest.Mock).mockResolvedValue("/tmp/not-a-skill")
  ;(pathExists as jest.Mock).mockResolvedValue(false)
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.pickFolder }))
  expect(await screen.findByText(en.skillsBrowser.notASkillFolder)).toBeInTheDocument()

  // Second pick: valid skill folder — import into the default targets.
  ;(pickFolder as jest.Mock).mockResolvedValue("/tmp/my-skill")
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.pickFolder }))
  expect(await screen.findByText("/tmp/my-skill")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.importNow }))
  await waitFor(() =>
    expect(installSkillFromDir).toHaveBeenCalledWith("/tmp/my-skill", "my-skill", [
      "claude",
      "codex",
    ])
  )
  expect(refresh).toHaveBeenCalled()
})

it("cancelling the folder picker is a no-op", async () => {
  renderAdd()
  ;(pickFolder as jest.Mock).mockResolvedValue(null)
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.pickFolder }))
  expect(screen.queryByText(en.skillsBrowser.notASkillFolder)).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.skillsBrowser.importNow })).not.toBeInTheDocument()
})

it("creates a new skill from the scaffold form", async () => {
  const refresh = renderAdd()
  await userEvent.type(screen.getByLabelText(en.skillsBrowser.nameLabel), "my-skill")
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.createNow }))
  await waitFor(() => expect(createSkill).toHaveBeenCalled())
  const [name, targets, content] = (createSkill as jest.Mock).mock.calls[0]
  expect(name).toBe("my-skill")
  expect(targets).toEqual(["claude", "codex"])
  expect(content).toContain("name: my-skill")
  expect(refresh).toHaveBeenCalled()
})

it("disables create for an invalid skill name", async () => {
  renderAdd()
  await userEvent.type(screen.getByLabelText(en.skillsBrowser.nameLabel), "bad name")
  expect(screen.getByText(en.skillsBrowser.nameInvalid)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.skillsBrowser.createNow })).toBeDisabled()
})

it("adds a recommended repo source, then browses it", async () => {
  ;(fetchRepoSkills as jest.Mock).mockResolvedValue({
    scanId: "s3",
    skills: [{ dirName: "x", relPath: "x", skillMd: "---\nname: x\n---\n" }],
  })
  renderAdd()
  // The recommended Anthropic chip adds it to the saved list.
  await userEvent.click(screen.getByRole("button", { name: /Anthropic/ }))
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.browse }))
  await waitFor(() =>
    expect(fetchRepoSkills).toHaveBeenCalledWith(
      "https://codeload.github.com/anthropics/skills/tar.gz/HEAD"
    )
  )
})

it("saves a GitHub mirror prefix from the advanced settings", async () => {
  renderAdd()
  await userEvent.click(screen.getByText(en.skillsBrowser.advancedTitle))
  await userEvent.type(screen.getByPlaceholderText("https://gh-proxy.com/"), "https://m.example/")
  await waitFor(() =>
    expect(saveSettings).toHaveBeenCalledWith({ ghMirrorPrefix: expect.any(String) })
  )
})

it("saves a manually-entered repo source and removes it", async () => {
  renderAdd()
  await userEvent.type(
    screen.getByPlaceholderText(en.skillsBrowser.repoUrlPlaceholder),
    "me/skills"
  )
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.addRepo }))
  expect(screen.getByText("me/skills")).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.removeRepo }))
  expect(screen.getByText(en.skillsBrowser.reposEmpty)).toBeInTheDocument()
})

/** Fetch a two-skill repo and return once its list is on screen. */
async function fetchTwo() {
  ;(fetchRepoSkills as jest.Mock).mockResolvedValue({
    scanId: "scan-9",
    skills: [
      {
        dirName: "web-design",
        relPath: "skills/web-design",
        skillMd: "---\nname: web-design\n---\n",
      },
      { dirName: "react", relPath: "skills/react", skillMd: "---\nname: react\n---\n" },
    ],
  })
  await userEvent.type(screen.getByPlaceholderText(en.skillsBrowser.sourcePlaceholder), "o/r")
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.fetchSkills }))
  await screen.findByText("web-design")
}

it("keeps the fetched repo when the install fails, so Retry has something to install from", async () => {
  ;(installRepoSkills as jest.Mock).mockRejectedValueOnce(new Error("disk full"))
  const refresh = renderAdd()
  await fetchTwo()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.installSelected(2) }))
  await waitFor(() => expect(installRepoSkills).toHaveBeenCalled())
  // `refresh` follows the settled run.
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  // Disposing of the scan here made Retry in the panel fail on an unknown scan.
  expect(cleanupRepoScan).not.toHaveBeenCalledWith("scan-9")
  expect(screen.getByText("web-design")).toBeInTheDocument()
  expect(
    screen.getByRole("button", { name: en.skillsBrowser.installSelected(2) })
  ).toBeInTheDocument()
})

it("keeps a picked folder when its import fails", async () => {
  ;(installSkillFromDir as jest.Mock).mockRejectedValueOnce(new Error("disk full"))
  ;(pickFolder as jest.Mock).mockResolvedValue("/tmp/my-skill")
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  const refresh = renderAdd()
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.pickFolder }))
  await userEvent.click(await screen.findByRole("button", { name: en.skillsBrowser.importNow }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(screen.getByText("/tmp/my-skill")).toBeInTheDocument()
})

it("keeps what was typed when creating the skill fails", async () => {
  ;(createSkill as jest.Mock).mockRejectedValueOnce(new Error("exists"))
  const refresh = renderAdd()
  await userEvent.type(screen.getByLabelText(en.skillsBrowser.nameLabel), "my-skill")
  await userEvent.click(screen.getByRole("button", { name: en.skillsBrowser.createNow }))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(screen.getByLabelText(en.skillsBrowser.nameLabel)).toHaveValue("my-skill")
})

it("shows the skills CLI its own targets, and refuses to run with none", async () => {
  renderAdd()
  await userEvent.type(screen.getByPlaceholderText(en.skillsBrowser.sourcePlaceholder), "o/r")
  await userEvent.click(screen.getByText(en.skillsBrowser.advancedTitle))
  const advanced = within(screen.getByText(en.skillsBrowser.advancedTitle).closest("details")!)
  // Only the agents the CLI has a flag for — "Shared" would map to nothing.
  expect(advanced.getAllByRole("checkbox")).toHaveLength(3)
  await userEvent.click(advanced.getByRole("checkbox", { name: "Claude Code" }))
  await userEvent.click(advanced.getByRole("checkbox", { name: "Codex" }))
  const button = advanced.getByRole("button", { name: en.skillsBrowser.useNpx })
  // With no -a flag the CLI installs into every agent it finds.
  expect(button).toBeDisabled()
  expect(button).toHaveAccessibleDescription(en.skillsBrowser.npxNoTarget)
  await userEvent.click(advanced.getByRole("checkbox", { name: "OpenCode" }))
  await userEvent.click(button)
  await waitFor(() => expect(runCommand).toHaveBeenCalled())
  expect((runCommand as jest.Mock).mock.calls[0][0].args).toEqual(
    expect.arrayContaining(["-a", "opencode"])
  )
})
