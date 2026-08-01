/**
 * First-run welcome wizard (Tauri mode). A newcomer with `onboarded: false`
 * gets greeted once; installing from the wizard applies the chosen preset, marks
 * them onboarded (persisted), and runs the same deduped one-click install as the
 * header. Here `memory` is already on Claude and `context7` is not, so the
 * reviewed plan keeps the latter and drops the former.
 */
jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  getPaths: jest.fn(async () => ({
    home: "/h",
    claudeSettings: "/h/.claude/settings.json",
    claudeConfig: "/h/.claude.json",
    claudeSkillsDir: "/h/.claude/skills",
    codexConfig: "/h/.codex/config.toml",
    codexAuth: "/h/.codex/auth.json",
    codexSkillsDir: "/h/.codex/skills",
    opencodeConfig: "/h/.config/opencode/opencode.json",
    opencodeSkillsDir: "/h/.config/opencode/skills",
    agentsSkillsDir: "/h/.agents/skills",
    ccSwitchSettings: "/h/.cc-switch/settings.json",
    ccSwitchDb: "/h/.cc-switch/cc-switch.db",
    ccConnectDir: "/h/.cc-connect",
    ccConnectConfig: "/h/.cc-connect/config.toml",
    os: "mac",
  })),
  detectCli: jest.fn(async (bin: string) => ({
    installed: bin === "claude",
    version: bin === "claude" ? "1.0.0" : undefined,
  })),
  detectRuntime: jest.fn(async () => ({ installed: true, version: "1.0.0" })),
  latestVersion: jest.fn(async () => "1.0.0"),
  npmOwns: jest.fn(async () => true),
  pkgManagerOwns: jest.fn(async () => true),
  readTextFile: jest.fn(async (p: string) =>
    p.includes(".claude.json") ? JSON.stringify({ mcpServers: { memory: {} } }) : ""
  ),
  listSkills: jest.fn(async () => [] as string[]),
  ccLoadProviders: jest.fn(async () => []),
  pathExists: jest.fn(async () => false),
  historyListSessions: jest.fn(async () => ({ sessions: [], errors: [] })),
}))
jest.mock("@/lib/tauri/updater", () => ({
  checkForUpdate: jest.fn(async () => null),
  getAppVersion: jest.fn(async () => "1.0.0"),
}))
jest.mock("@/lib/tauri/settings", () => ({
  loadSettings: jest.fn(async () => ({
    autoCheckUpdates: false,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    onboardingProgress: null,
    quickStartDismissed: true,
  })),
  saveSettings: jest.fn(async () => undefined),
  DEFAULT_SETTINGS: {
    autoCheckUpdates: false,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    onboardingProgress: null,
    quickStartDismissed: false,
  },
}))
jest.mock("@/lib/tauri/system", () => ({
  notify: jest.fn(async () => undefined),
  hostArch: jest.fn(async () => "x64"),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { loadSettings, saveSettings } from "@/lib/tauri/settings"
import { useAppStore } from "@/store/app-store"
import { AppShell } from "./app-shell"
import { en } from "@/lib/i18n/en"

const mockedLoad = loadSettings as jest.Mock
const mockedSave = saveSettings as jest.Mock

beforeEach(() => {
  useAppStore.setState({
    paths: null,
    panelOpen: false,
    onboardingOpen: false,
    detections: {},
    latestVersions: {},
  })
  useAppStore.getState().resetPlan()
})

const renderShell = () =>
  render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )

const claudeMcpLabel = (id: "memory" | "context7") =>
  en.steps.addMcpClaude(en.catalog.mcp[id].title)

const wizardHeading = () => screen.queryByRole("heading", { name: en.welcome.title })

it("greets a first-time user with the welcome wizard", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
})

it("stays quiet for a returning user who is already onboarded", async () => {
  mockedLoad.mockResolvedValueOnce({
    autoCheckUpdates: false,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: true,
    onboardingProgress: null,
    quickStartDismissed: true,
  })
  renderShell()
  // Once the effect has applied the persisted settings, the wizard decision is made.
  await waitFor(() => expect(useAppStore.getState().settings.onboarded).toBe(true))
  expect(wizardHeading()).not.toBeInTheDocument()
})

it("installing the recommended bundle marks onboarded and runs a deduped plan", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())

  // The wizard is three steps now — intro, network self-check, install.
  await userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))
  await userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))
  await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))

  // Onboarded flag is persisted so the wizard won't nag next launch…
  await waitFor(() =>
    expect(mockedSave).toHaveBeenCalledWith({ onboarded: true, onboardingProgress: null })
  )
  // …the wizard closes…
  await waitFor(() => expect(wizardHeading()).not.toBeInTheDocument())
  // …and the reviewed plan reflects the chosen preset, deduped: context7 is added,
  // the already-installed memory server is dropped.
  await waitFor(() => expect(screen.getByText(claudeMcpLabel("context7"))).toBeInTheDocument())
  expect(screen.queryByText(claudeMcpLabel("memory"))).not.toBeInTheDocument()
})

/**
 * The key has to be written AFTER applyPreset — applyPreset rebuilds the plan
 * from the bundle, so anything set ahead of it is thrown away.
 */
it("carries an API key typed in the wizard into the plan that runs", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))
  await userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))
  await userEvent.type(screen.getByLabelText("context7 CONTEXT7_API_KEY"), "ctx-key")
  await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))

  await waitFor(() => expect(useAppStore.getState().plan.mcpKeys.context7).toBe("ctx-key"))
})

/**
 * Same ordering trap as the keys: applyPreset rebuilds the plan from the bundle,
 * so the skill selection has to be written after it — and in both directions,
 * because the user may have unticked one the bundle had chosen.
 */
it("carries a skill ticked in the wizard into the plan that runs", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))
  await userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))
  await userEvent.click(screen.getByLabelText(en.catalog.skills.rust.title))
  await userEvent.click(screen.getByRole("button", { name: en.welcome.install }))

  await waitFor(() => {
    const skills = useAppStore.getState().plan.skills
    expect(skills.map((s) => s.id)).toEqual(["rust"])
    // Targeted at the agents this surface installs, not left empty.
    expect(skills[0]!.targets.length).toBeGreaterThan(0)
  })
})

it("Maybe later marks onboarded without running anything", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: en.welcome.later }))

  await waitFor(() =>
    expect(mockedSave).toHaveBeenCalledWith({ onboarded: true, onboardingProgress: null })
  )
  await waitFor(() => expect(wizardHeading()).not.toBeInTheDocument())
  // No install was triggered — the review panel never appears.
  expect(screen.queryByText(claudeMcpLabel("context7"))).not.toBeInTheDocument()
})

/**
 * The distinction the whole persistence scheme exists for: closing the wizard by
 * accident used to be recorded as "onboarded", so someone who mis-clicked on the
 * first question was never guided again. Now it saves their place instead.
 */
it("Escape saves the user's place and does NOT mark them onboarded", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: en.welcome.continue }))
  await userEvent.keyboard("{Escape}")

  await waitFor(() =>
    expect(mockedSave).toHaveBeenCalledWith({
      onboardingProgress: { step: "bundle", preset: "recommended", surface: "gui" },
    })
  )
  expect(mockedSave).not.toHaveBeenCalledWith(expect.objectContaining({ onboarded: true }))
})

it("resumes a suspended wizard on the step it was left on", async () => {
  mockedLoad.mockResolvedValueOnce({
    autoCheckUpdates: false,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    onboardingProgress: { step: "bundle", preset: "everything", surface: "cli" },
    quickStartDismissed: true,
  })
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
  // Straight to the bundle question, with the bundle they had already picked.
  expect(screen.getByText(en.welcome.presetLabel)).toBeInTheDocument()
  expect(screen.getByRole("radio", { name: /everything/i })).toBeChecked()
})
