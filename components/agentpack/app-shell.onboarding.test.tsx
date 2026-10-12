/**
 * First-run welcome wizard (Tauri mode). A newcomer with `onboarded: false`
 * gets greeted once; the wizard's answer is staged against a fresh scan — the
 * same deduped review the tray's button builds — and drawn inside the wizard.
 * Here `memory` is already on Claude and the other two core servers are not,
 * so the review keeps those and drops `memory`.
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
  providerLoad: jest.fn(async () => []),
  loginStatus: jest.fn(async () => ({
    claude: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "x" },
    codex: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "x" },
    opencode: { signedIn: false, mode: null, plan: null, expiresAt: null, source: "x" },
  })),
  launchAgentLogin: jest.fn(async () => undefined),
  httpGet: jest.fn(async () => ({ status: 200, latencyMs: 1, body: "{}", error: null })),
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
    gettingStartedDismissed: true,
  })),
  saveSettings: jest.fn(async () => undefined),
  DEFAULT_SETTINGS: {
    autoCheckUpdates: false,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    onboardingProgress: null,
    gettingStartedDismissed: false,
  },
}))
// Install now really executes; the executor is stubbed so nothing spawns.
jest.mock("@/lib/agentpack/runner", () => ({
  runSteps: jest.fn(
    async (
      steps: { id: string; label: string }[],
      o: { onUpdate: (r: unknown, i: number) => void }
    ) => {
      const reports = steps.map((s) => ({ id: s.id, label: s.label, status: "done", output: [] }))
      reports.forEach((r, i) => o.onUpdate(r, i))
      return reports
    }
  ),
}))
jest.mock("@/lib/tauri/activity", () => ({
  loadActivity: jest.fn(async () => []),
  appendActivity: jest.fn(async () => []),
}))
jest.mock("@/lib/tauri/system", () => ({
  notify: jest.fn(async () => undefined),
  hostArch: jest.fn(async () => "x64"),
}))

import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { loadSettings, saveSettings } from "@/lib/tauri/settings"
import { useAppStore } from "@/store/app-store"
import { AppShell } from "./app-shell"
import { en } from "@/lib/i18n/en"

const mockedLoad = loadSettings as jest.Mock
const mockedSave = saveSettings as jest.Mock
const w = en.welcome

beforeEach(() => {
  useAppStore.setState({
    paths: null,
    panelOpen: false,
    onboardingOpen: false,
    detections: {},
    latestVersions: {},
  })
  useAppStore.getState().resetPlan()
  mockedSave.mockClear()
})

const renderShell = () =>
  render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )

const claudeMcpLabel = (id: "memory" | "sequential-thinking") =>
  en.steps.addMcpClaude(en.catalog.mcp[id].title)

const wizardHeading = () => screen.queryByRole("heading", { name: w.title })

/** Agent → connect (the official subscription, by default) → review. */
const toReview = async () => {
  await userEvent.click(screen.getByRole("button", { name: w.continue }))
  await userEvent.click(screen.getByRole("button", { name: w.continue }))
}

const settingsWith = (patch: object) => ({
  autoCheckUpdates: false,
  skippedVersion: null,
  lastCheckAt: null,
  onboarded: false,
  onboardingProgress: null,
  gettingStartedDismissed: true,
  ...patch,
})

it("greets a first-time user with the welcome wizard", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
})

it("stays quiet for a returning user who is already onboarded", async () => {
  mockedLoad.mockResolvedValueOnce(settingsWith({ onboarded: true }))
  renderShell()
  // Once the effect has applied the persisted settings, the wizard decision is made.
  await waitFor(() => expect(useAppStore.getState().settings.onboarded).toBe(true))
  expect(wizardHeading()).not.toBeInTheDocument()
})

it("stages a deduped review inside the wizard, and records nothing yet", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())

  await toReview()

  // The review is in the wizard: a missing core server is added, the one
  // already on Claude is dropped, and Claude Code itself (installed, current)
  // isn't touched.
  expect(await screen.findByText(claudeMcpLabel("sequential-thinking"))).toBeInTheDocument()
  expect(screen.queryByText(claudeMcpLabel("memory"))).not.toBeInTheDocument()
  expect(useAppStore.getState().panelOpen).toBe(false)
  // Staging is not consent.
  expect(mockedSave).not.toHaveBeenCalledWith(expect.objectContaining({ onboarded: true }))
})

it("Install now marks onboarded, runs, and leaves the wizard on its result", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())
  await toReview()
  const install = await screen.findByRole("button", { name: w.installNow })
  await waitFor(() => expect(install).toBeEnabled())
  await userEvent.click(install)

  await waitFor(() =>
    expect(mockedSave).toHaveBeenCalledWith({
      onboarded: true,
      onboardingProgress: null,
      // What makes the checklist show this newcomer the whole path.
      startedWithWizard: true,
    })
  )
  expect(await screen.findByText(w.finishedIntro)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: w.done }))
  await waitFor(() => expect(wizardHeading()).not.toBeInTheDocument())
})

it("Maybe later marks onboarded without running anything", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())

  await userEvent.click(screen.getByRole("button", { name: w.later }))

  await waitFor(() =>
    expect(mockedSave).toHaveBeenCalledWith({ onboarded: true, onboardingProgress: null })
  )
  await waitFor(() => expect(wizardHeading()).not.toBeInTheDocument())
  expect(screen.queryByText(claudeMcpLabel("sequential-thinking"))).not.toBeInTheDocument()
})

/**
 * The distinction the whole persistence scheme exists for: closing the wizard by
 * accident used to be recorded as "onboarded", so someone who mis-clicked on the
 * first question was never guided again. Now it saves their place instead.
 */
it("Escape saves the user's place and does NOT mark them onboarded", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())

  await userEvent.click(screen.getByRole("radio", { name: new RegExp(`^${w.agentCodex}`) }))
  await userEvent.keyboard("{Escape}")

  await waitFor(() =>
    expect(mockedSave).toHaveBeenCalledWith({
      onboardingProgress: { step: "agent", agent: "codex", desktop: false, proxy: true },
    })
  )
  expect(mockedSave).not.toHaveBeenCalledWith(expect.objectContaining({ onboarded: true }))
})

it("resumes a suspended wizard with the answer it was left on", async () => {
  mockedLoad.mockResolvedValueOnce(
    settingsWith({ onboardingProgress: { step: "agent", agent: "both", desktop: true } })
  )
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
  expect(screen.getByRole("radio", { name: new RegExp(`^${w.agentBoth}`) })).toBeChecked()
})

/**
 * A faster mirror rides into the review as a step, and declining it restages
 * from the network config as it was before the wizard — not from whatever the
 * previous staging adopted.
 */
it("stages a suggested npm mirror as a step, and drops it again on request", async () => {
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())
  await waitFor(() => expect(useAppStore.getState().networkProbing).toBe(false))
  act(() =>
    useAppStore.getState().setNetworkProbe({
      proxies: [],
      bestProxy: null,
      directOk: true,
      npm: [
        {
          preset: { id: "npmmirror", label: "npmmirror", url: "https://m.example", probeUrl: "x" },
          result: { ok: true, status: 200, latencyMs: 20, reason: "ok" },
        },
        {
          preset: { id: "npmjs", label: "npmjs", url: null, probeUrl: "x" },
          result: { ok: false, reason: "timeout" },
        },
      ],
      gh: [],
      pypi: [],
      brew: [],
      pacUrl: null,
    })
  )

  await toReview()
  const mirrorStep = en.steps.npmRegistry("https://m.example")
  expect(await screen.findByText(mirrorStep)).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: w.mirrorDecline }))
  await screen.findByText(claudeMcpLabel("sequential-thinking"))
  expect(screen.queryByText(mirrorStep)).not.toBeInTheDocument()
  expect(useAppStore.getState().plan.network.npmRegistry).toBeUndefined()
})

/**
 * The account rides in the same review as the install: one Apply saves the
 * key, makes it the one Claude Code uses, and syncs its settings.
 */
it("stages an API key as provider steps in the same review as the install", async () => {
  mockedLoad.mockResolvedValueOnce(settingsWith({ providerBackend: "native" }))
  renderShell()
  await waitFor(() => expect(wizardHeading()).toBeInTheDocument())
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())

  await userEvent.click(screen.getByRole("button", { name: w.continue }))
  await userEvent.click(screen.getByRole("radio", { name: new RegExp(w.connectApiKey) }))
  await userEvent.type(screen.getByLabelText(`${w.agentClaude} ${w.fieldKey}`), "sk-ant")
  await userEvent.click(screen.getByRole("button", { name: w.continue }))

  expect(await screen.findByText(en.steps.providerAdd("Anthropic API"))).toBeInTheDocument()
  expect(screen.getByText(en.steps.syncClaude)).toBeInTheDocument()
  expect(screen.getByText(claudeMcpLabel("sequential-thinking"))).toBeInTheDocument()
})
