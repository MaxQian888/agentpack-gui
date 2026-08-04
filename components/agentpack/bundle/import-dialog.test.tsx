// `run` now resolves with the reports of the run the user APPLIED, and with []
// when they dismissed the review panel instead. The default stands in for
// "reviewed and applied"; the dismissal case gets its own test below.
const applied = [{ id: "s", label: "s", status: "done", output: [] }]
const run = jest.fn<Promise<unknown[]>, [StepDescriptor[]]>(async () => applied)
jest.mock("../run/runner-context", () => ({ useRunnerCtx: () => ({ run }) }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => true) }))
jest.mock("@/lib/tauri/commands", () => ({
  readTextFile: jest.fn(async () => ""),
  writeTextFile: jest.fn(async () => undefined),
  providerLoad: jest.fn(async () => []),
  isProcessRunning: jest.fn(async () => false),
}))
jest.mock("@/lib/tauri/dialog", () => ({ pickFile: jest.fn(async () => null) }))
jest.mock("@/lib/tauri/clipboard", () => ({ readTextFromClipboard: jest.fn(async () => null) }))
jest.mock("@/lib/tauri/settings", () => ({
  ...jest.requireActual("@/lib/tauri/settings"),
  saveSettings: jest.fn(async () => undefined),
}))

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { buildBundle, serializeBundle } from "@/lib/agentpack/bundle/format"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import { serializePlan } from "@/lib/agentpack/config"
import { BACKUP_SUFFIX } from "@/lib/agentpack/plan"
import type { Plan, Paths, StepDescriptor } from "@/lib/agentpack/types"
import { en } from "@/lib/i18n/en"
import { I18nProvider } from "@/lib/i18n/provider"
import { readTextFromClipboard } from "@/lib/tauri/clipboard"
import { isProcessRunning, providerLoad, readTextFile, writeTextFile } from "@/lib/tauri/commands"
import { pickFile } from "@/lib/tauri/dialog"
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/tauri/settings"
import { useAppStore } from "@/store/app-store"
import { ImportBundleDialog } from "./import-dialog"

const b = en.bundle

const base: Plan = { os: "mac", clis: [], skills: [], mcps: [], mcpKeys: {}, network: {} }

const LOCAL: Plan = {
  ...base,
  clis: ["claude-code"],
  mcps: [{ id: "context7", targets: ["claude"] }],
  mcpKeys: { context7: "local-key" },
}

const INCOMING: Plan = {
  ...base,
  clis: ["codex"],
  skills: [{ id: "rust", targets: ["codex"] }],
}

const PATHS = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  claudeConfig: "/h/.claude.json",
  codexConfig: "/h/.codex/config.toml",
  opencodeConfig: "/h/.config/opencode/opencode.json",
  ccConnectConfig: "/h/.cc-connect/config.toml",
  os: "mac",
} as unknown as Paths

function bundleText(over: Partial<Parameters<typeof buildBundle>[0]> = {}) {
  return serializeBundle(
    buildBundle(
      { createdAt: 1, app: { version: "1.0.0", os: "mac" }, plan: INCOMING, ...over },
      { includeSecrets: false }
    )
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  run.mockResolvedValue([])
  ;(isProcessRunning as jest.Mock).mockResolvedValue(false)
  useAppStore.setState({
    plan: LOCAL,
    paths: PATHS,
    profiles: [],
    settings: { ...DEFAULT_SETTINGS, providerBackend: "native" },
  })
  run.mockResolvedValue(applied)
})

async function openWith(text: string) {
  render(
    <I18nProvider>
      <ImportBundleDialog />
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: b.importOpen }))
  const area = await screen.findByRole("textbox", { name: b.importTitle })
  await userEvent.click(area)
  await userEvent.paste(text)
  return area
}

const clickImport = async () => {
  const buttons = screen.getAllByRole("button", { name: b.importOpen })
  await userEvent.click(buttons[buttons.length - 1])
}

/** The step descriptors handed to the runner by the last import. */
function steps(): StepDescriptor[] {
  return run.mock.calls.at(-1)![0]
}

it("previews a pasted bundle", async () => {
  await openWith(bundleText())
  expect(await screen.findByText(b.partPlan)).toBeInTheDocument()
  expect(screen.getByText("1.0.0")).toBeInTheDocument()
})

it("reports a file that is not a bundle at all", async () => {
  await openWith("{ not json")
  expect(await screen.findByText(en.errors.invalidJson)).toBeInTheDocument()
})

it("always issues the snapshot step first", async () => {
  await openWith(bundleText({ files: { codexConfig: 'model = "gpt-5"\n' } }))
  await screen.findByText(b.partFiles)
  await clickImport()
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(steps()[0].kind).toBe("snapshot")
  expect(steps().some((s) => s.id === "bundle-file-codexConfig")).toBe(true)
})

it("merges into the local plan by default", async () => {
  await openWith(bundleText())
  await screen.findByText(b.partPlan)
  await clickImport()
  await waitFor(() => expect(useAppStore.getState().plan.clis).toEqual(["claude-code", "codex"]))
})

it("replaces the local plan when the mode is switched", async () => {
  await openWith(bundleText())
  await screen.findByText(b.partPlan)
  await userEvent.click(screen.getByRole("button", { name: b.planReplace }))
  await clickImport()
  await waitFor(() => expect(useAppStore.getState().plan.clis).toEqual(["codex"]))
})

it("keeps the local mcp key the bundle redacted", async () => {
  await openWith(bundleText())
  await screen.findByText(b.partPlan)
  await clickImport()
  await waitFor(() => expect(useAppStore.getState().plan.mcpKeys.context7).toBe("local-key"))
})

it("imports a v1 plan file", async () => {
  await openWith(serializePlan(INCOMING))
  expect(await screen.findByText(b.legacyDetected)).toBeInTheDocument()
  await clickImport()
  await waitFor(() => expect(useAppStore.getState().plan.clis).toContain("codex"))
})

it("drops a deselected file from the steps", async () => {
  await openWith(
    bundleText({ files: { codexConfig: 'model = "gpt-5"\n', claudeSettings: '{"model":"opus"}' } })
  )
  await screen.findByText(b.partFiles)
  await userEvent.click(screen.getByLabelText("codexConfig"))
  await clickImport()
  await waitFor(() => expect(run).toHaveBeenCalled())
  const ids = steps().map((s) => s.id)
  expect(ids).toContain("bundle-file-claudeSettings")
  expect(ids).not.toContain("bundle-file-codexConfig")
})

it("disables Import once nothing is selected", async () => {
  await openWith(bundleText({ files: { codexConfig: 'model = "gpt-5"\n' } }))
  await screen.findByText(b.partFiles)
  await userEvent.click(screen.getByLabelText(b.partPlan))
  await userEvent.click(screen.getByLabelText("codexConfig"))
  const buttons = screen.getAllByRole("button", { name: b.importOpen })
  await waitFor(() => expect(buttons[buttons.length - 1]).toBeDisabled())
  expect(run).not.toHaveBeenCalled()
})

it("writes nothing to the store when a step failed", async () => {
  run.mockResolvedValue([{ id: "x", label: "x", status: "error", output: [] }])
  await openWith(bundleText())
  await screen.findByText(b.partPlan)
  await clickImport()
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(useAppStore.getState().plan.clis).toEqual(["claude-code"])
})

it("leaves the store alone when the review panel is dismissed without applying", async () => {
  // The store writes below (plan, profiles, settings) are ours, not the
  // runner's — so a run that never happened must not move them either.
  run.mockResolvedValueOnce([])
  await openWith(bundleText({ profiles: [{ id: "p", name: "P", createdAt: 0, plan: INCOMING }] }))
  await screen.findByText(b.partPlan)
  await clickImport()
  await waitFor(() => expect(toast.message).toHaveBeenCalledWith(b.dryRunSkipped))
  expect(run).toHaveBeenCalled()
  expect(useAppStore.getState().plan.clis).toEqual(["claude-code"])
  expect(useAppStore.getState().profiles).toEqual([])
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("writes profiles, keeping a sidecar backup of what was there first", async () => {
  const profile = { id: "p1", name: "Work", createdAt: 0, plan: INCOMING }
  ;(readTextFile as jest.Mock).mockResolvedValue('{"version":1,"profiles":[]}')
  await openWith(bundleText({ profiles: [profile] }))
  await screen.findByText(b.partProfiles)
  await clickImport()
  await waitFor(() => expect(useAppStore.getState().profiles).toHaveLength(1))
  const calls = (writeTextFile as jest.Mock).mock.calls
  expect(calls[0][0]).toBe(`/h/.agentpack/profiles.json${BACKUP_SUFFIX}`)
  expect(calls[1][0]).toBe("/h/.agentpack/profiles.json")
  expect(calls[1][1]).toContain("Work")
})

it("skips profiles entirely in skip mode", async () => {
  await openWith(bundleText({ profiles: [{ id: "p1", name: "W", createdAt: 0, plan: INCOMING }] }))
  await screen.findByText(b.partProfiles)
  await userEvent.click(screen.getByRole("button", { name: b.profilesSkip }))
  await clickImport()
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(useAppStore.getState().profiles).toEqual([])
})

it("applies app settings and persists them", async () => {
  await openWith(bundleText({ settings: { ...DEFAULT_SETTINGS, ghMirrorPrefix: "https://m/" } }))
  // Anchored: the pasted bundle sits in a textarea and also contains this key.
  expect(await screen.findByText(/^ghMirrorPrefix:/)).toBeInTheDocument()
  await clickImport()
  await waitFor(() => expect(saveSettings).toHaveBeenCalled())
  expect(useAppStore.getState().settings.ghMirrorPrefix).toBe("https://m/")
})

/** A provider-only bundle with one new entry and one clashing with the DB. */
const PROVIDER_BUNDLE = JSON.stringify({
  version: 2,
  createdAt: 1,
  app: { version: "1", os: "mac" },
  providers: [
    { app: "claude", name: "Fresh", settingsConfig: "{}" },
    { app: "claude", name: "Existing", settingsConfig: "{}" },
  ],
})

function withExistingProvider() {
  ;(providerLoad as jest.Mock).mockResolvedValue([
    { id: "e1", app_type: "claude", name: "Existing", settings_config: "{}", is_current: false },
  ])
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it("writes only the fresh providers by default", async () => {
  withExistingProvider()
  await openWith(PROVIDER_BUNDLE)
  await screen.findByText(b.diffProviders(1, 1))
  await clickImport()
  await waitFor(() => expect(run).toHaveBeenCalled())
  const providerSteps = steps().filter((s) => s.kind === "ccProvider")
  expect(providerSteps).toHaveLength(1)
  expect(providerSteps[0].payload).toEqual(expect.objectContaining({ backend: "native" }))
  expect(providerLoad).toHaveBeenCalledWith("native")
})

it("also replaces a conflicting provider once asked to", async () => {
  withExistingProvider()
  await openWith(PROVIDER_BUNDLE)
  await screen.findByText(b.diffProviders(1, 1))
  await userEvent.click(screen.getByLabelText(b.overwriteConflicts))
  await clickImport()
  await waitFor(() => expect(run).toHaveBeenCalled())
  expect(steps().filter((s) => s.kind === "ccProvider")).toHaveLength(2)
})

it("ignores a stale provider load after the imported backend changes", async () => {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, providerBackend: "native" },
  }))
  const stale = deferred<Provider[]>()
  let nativeLoads = 0
  ;(providerLoad as jest.Mock).mockImplementation((backend: string) => {
    if (backend === "ccswitch") return stale.promise
    nativeLoads += 1
    return Promise.resolve(
      nativeLoads === 1
        ? []
        : [
            {
              id: "native-existing",
              app_type: "claude",
              name: "Existing",
              settings_config: "{}",
              is_current: false,
            },
          ]
    )
  })
  const ccswitchBundle = JSON.parse(PROVIDER_BUNDLE)
  ccswitchBundle.settings = { ...DEFAULT_SETTINGS, providerBackend: "ccswitch" }
  const nativeBundle = JSON.parse(PROVIDER_BUNDLE)
  nativeBundle.settings = { ...DEFAULT_SETTINGS, providerBackend: "native" }

  const area = await openWith(PROVIDER_BUNDLE)
  fireEvent.change(area, { target: { value: JSON.stringify(ccswitchBundle) } })
  await waitFor(() => expect(providerLoad).toHaveBeenCalledWith("ccswitch"))
  fireEvent.change(area, { target: { value: JSON.stringify(nativeBundle) } })
  stale.resolve([])
  await waitFor(() => expect(providerLoad).toHaveBeenLastCalledWith("native"))
  expect(await screen.findByText(b.diffProviders(1, 1))).toBeInTheDocument()
})

it("loads a bundle from a chosen file and from the clipboard", async () => {
  ;(pickFile as jest.Mock).mockResolvedValue("/tmp/b.json")
  ;(readTextFile as jest.Mock).mockResolvedValue(bundleText())
  render(
    <I18nProvider>
      <ImportBundleDialog />
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: b.importOpen }))
  await userEvent.click(await screen.findByRole("button", { name: b.chooseFile }))
  expect(await screen.findByText(b.partPlan)).toBeInTheDocument()
  ;(readTextFromClipboard as jest.Mock).mockResolvedValue(bundleText())
  await userEvent.click(screen.getByRole("button", { name: b.pasteClipboard }))
  expect(await screen.findByText(b.partPlan)).toBeInTheDocument()
})

it("labels an identical file and flags one whose local copy is unreadable", async () => {
  ;(readTextFile as jest.Mock).mockImplementation(async (p: string) =>
    p.endsWith("config.toml") ? 'model = "gpt-5"\n' : "{ broken"
  )
  await openWith(
    bundleText({ files: { codexConfig: 'model = "gpt-5"\n', claudeSettings: '{"model":"opus"}' } })
  )
  await screen.findByText(b.partFiles)
  expect(await screen.findByText(b.fileSame)).toBeInTheDocument()
  expect(screen.getByText(b.fileLocalUnreadable)).toBeInTheDocument()
  // The unreadable one starts unchecked, so it can't silently wipe credentials.
  expect(screen.getByLabelText("claudeSettings")).not.toBeChecked()
})

it("surfaces a part it could not read", async () => {
  const broken = JSON.parse(bundleText())
  broken.plan.clis = ["not-a-cli"]
  await openWith(JSON.stringify(broken))
  expect(await screen.findByText(b.skippedParts("plan"))).toBeInTheDocument()
})

it("warns when the bundle carries live credentials", async () => {
  const text = serializeBundle(
    buildBundle(
      { createdAt: 1, app: { version: "1", os: "mac" }, plan: INCOMING },
      { includeSecrets: true }
    )
  )
  await openWith(text)
  expect(await screen.findByText(b.secretsPresent)).toBeInTheDocument()
})

it("disables provider import while cc-switch holds the database", async () => {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, providerBackend: "ccswitch" },
  }))
  ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  await openWith(bundleText({ providers: [] }))
  expect(await screen.findByText(b.ccSwitchRunning)).toBeInTheDocument()
  expect(screen.getByLabelText(b.partProviders)).toBeDisabled()
})
