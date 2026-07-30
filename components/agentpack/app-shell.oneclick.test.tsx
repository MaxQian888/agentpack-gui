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
    onboarded: true,
    quickStartDismissed: true,
  })),
  saveSettings: jest.fn(async () => undefined),
  DEFAULT_SETTINGS: {
    autoCheckUpdates: false,
    skippedVersion: null,
    lastCheckAt: null,
    onboarded: false,
    quickStartDismissed: false,
  },
}))
jest.mock("@/lib/tauri/system", () => ({
  notify: jest.fn(async () => undefined),
  hostArch: jest.fn(async () => "x64"),
}))

import { render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { AppShell } from "./app-shell"
import { en } from "@/lib/i18n/en"

beforeEach(() => {
  useAppStore.setState({
    paths: null,
    panelOpen: false,
    dryRun: false,
    detections: {},
    latestVersions: {},
  })
  useAppStore.getState().resetPlan()
})

const claudeMcpLabel = (id: "memory" | "context7") =>
  en.steps.addMcpClaude(en.catalog.mcp[id].title)

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

  await userEvent.click(screen.getByRole("button", { name: en.shell.run }))

  // The review panel shows the deduped plan: context7 add is present…
  await waitFor(() => expect(screen.getByText(claudeMcpLabel("context7"))).toBeInTheDocument())
  // …and the already-installed memory add was dropped.
  expect(screen.queryByText(claudeMcpLabel("memory"))).not.toBeInTheDocument()
})
