/**
 * One-click install flow (Tauri mode). Clicking Run must build the plan against
 * a FRESH scan of the current on-disk state, so already-installed items are
 * skipped instead of re-installed — the whole point of the header Run button
 * being "correct". Here `memory` is already configured on Claude while
 * `context7` is not; the reviewed plan must drop the former and keep the latter.
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
  // Only ~/.claude.json declares an MCP server (memory).
  readTextFile: jest.fn(async (p: string) =>
    p.includes(".claude.json") ? JSON.stringify({ mcpServers: { memory: {} } }) : ""
  ),
  listSkills: jest.fn(async () => [] as string[]),
  providerLoad: jest.fn(async () => []),
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
    onboarded: true,
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
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri/system", () => ({
  notify: jest.fn(async () => undefined),
  hostArch: jest.fn(async () => "x64"),
}))

import { render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { toast } from "sonner"
import { detectCli, detectRuntime, getPaths, readTextFile, listSkills } from "@/lib/tauri/commands"
import { useAppStore } from "@/store/app-store"
import { AppShell } from "./app-shell"
import { en } from "@/lib/i18n/en"

beforeEach(() => {
  useAppStore.setState({
    paths: null,
    osOverride: null,
    panelOpen: false,
    detections: {},
    latestVersions: {},
  })
  useAppStore.getState().resetPlan()
  jest.clearAllMocks()
  // Tests below make the reads fail; put the healthy machine back so the file
  // stays order-independent. Only ~/.claude.json declares a server (memory).
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.includes(".claude.json") ? JSON.stringify({ mcpServers: { memory: {} } }) : ""
  )
  ;(listSkills as jest.Mock).mockImplementation(async () => [] as string[])
})

const claudeMcpLabel = (id: "memory" | "context7") =>
  en.steps.addMcpClaude(en.catalog.mcp[id].title)

it("waits for the real Windows OS before detecting platform dependencies", async () => {
  useAppStore.setState({ osOverride: "mac" })
  ;(getPaths as jest.Mock).mockResolvedValueOnce({
    home: "C:\\Users\\tester",
    claudeSettings: "",
    claudeConfig: "",
    claudeSkillsDir: "",
    codexConfig: "",
    codexAuth: "",
    codexSkillsDir: "",
    opencodeConfig: "",
    opencodeSkillsDir: "",
    agentsSkillsDir: "",
    ccSwitchSettings: "",
    ccSwitchDb: "",
    ccConnectDir: "",
    ccConnectConfig: "",
    os: "win",
  })

  render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )

  await waitFor(() =>
    expect(detectRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ id: "windows-terminal", gui: true })
    )
  )
})

it("Run drops an already-installed MCP and keeps a missing one", async () => {
  render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )
  // Startup: paths resolve from the mocked getPaths.
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())

  // Select both servers for Claude — memory is already installed, context7 isn't.
  act(() => {
    useAppStore.getState().setMcp("memory", ["claude"])
    useAppStore.getState().setMcp("context7", ["claude"])
  })

  await userEvent.click(await screen.findByRole("button", { name: en.tray.review }))

  // The review panel shows the deduped plan: context7 add is present…
  await waitFor(() => expect(screen.getByText(claudeMcpLabel("context7"))).toBeInTheDocument())
  // …and the already-installed memory add was dropped.
  expect(screen.queryByText(claudeMcpLabel("memory"))).not.toBeInTheDocument()
})

/**
 * The dedup is only as good as the scan behind it. A failed read used to fall
 * back to "nothing is installed", which re-emits every MCP add — and
 * `claude mcp add` rejects a duplicate id, so a transient error turned into a
 * screenful of red. Prefer the last good scan; refuse to run without either.
 */
it("falls back to the last good scan when a fresh one fails", async () => {
  render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )
  // The startup scan succeeds and is remembered.
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())

  act(() => {
    useAppStore.getState().setMcp("memory", ["claude"])
    useAppStore.getState().setMcp("context7", ["claude"])
  })
  // Now every read fails, so runOneClick's own scan comes back empty-handed.
  ;(readTextFile as jest.Mock).mockRejectedValue(new Error("EBUSY"))
  ;(listSkills as jest.Mock).mockRejectedValue(new Error("EBUSY"))

  await userEvent.click(await screen.findByRole("button", { name: en.tray.review }))

  // Still deduped against the remembered scan: memory stays dropped.
  await waitFor(() => expect(screen.getByText(claudeMcpLabel("context7"))).toBeInTheDocument())
  expect(screen.queryByText(claudeMcpLabel("memory"))).not.toBeInTheDocument()
})

it("refuses to run at all when there is no readable scan to dedup against", async () => {
  // Broken from the very first read, so nothing good was ever remembered.
  ;(readTextFile as jest.Mock).mockRejectedValue(new Error("EACCES"))
  ;(listSkills as jest.Mock).mockRejectedValue(new Error("EACCES"))
  render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())
  act(() => {
    useAppStore.getState().setMcp("context7", ["claude"])
  })

  await userEvent.click(await screen.findByRole("button", { name: en.tray.review }))

  // No step list at all — better than a run that re-adds what's already there.
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.shell.scanFailed))
  expect(screen.queryByText(claudeMcpLabel("context7"))).not.toBeInTheDocument()
})

/**
 * The overview's Rescan is the only way to say "I changed something outside
 * this app, look again". It used to re-read the config files and nothing else,
 * while the tools readout, the CLI inventory and every upgrade finding on that
 * same page come from the CLI detections — so a CLI installed in a terminal a
 * minute earlier stayed invisible until the next launch.
 */
it("re-detects the CLIs as well as the config files on Rescan", async () => {
  render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )
  await waitFor(() => expect(useAppStore.getState().paths).not.toBeNull())
  await waitFor(() => expect(detectCli).toHaveBeenCalled())

  // Forget the startup pass; only what Rescan itself does should count.
  ;(detectCli as jest.Mock).mockClear()
  ;(readTextFile as jest.Mock).mockClear()

  await userEvent.click(screen.getByRole("button", { name: en.dashboard.refresh }))

  await waitFor(() => expect(detectCli).toHaveBeenCalled())
  await waitFor(() => expect(readTextFile).toHaveBeenCalled())
})
