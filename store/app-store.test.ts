import { useAppStore } from "./app-store"
import { DEFAULT_SETTINGS } from "@/lib/tauri/settings"

beforeEach(() => {
  useAppStore.setState({ osOverride: null, paths: null, profiles: [], currentProfileId: null })
  useAppStore.getState().resetPlan()
  // resetPlan deliberately preserves network config + MCP keys (they outlive a
  // bundle switch), so wipe those explicitly for a truly clean slate per test.
  useAppStore.setState((s) => ({ plan: { ...s.plan, network: {}, mcpKeys: {} } }))
})

it("setMcp adds then clears by empty targets", () => {
  useAppStore.getState().setMcp("context7", ["claude"])
  expect(useAppStore.getState().plan.mcps).toHaveLength(1)
  useAppStore.getState().setMcp("context7", [])
  expect(useAppStore.getState().plan.mcps).toHaveLength(0)
})

it("toggleCli adds and removes", () => {
  useAppStore.getState().toggleCli("codex")
  expect(useAppStore.getState().plan.clis).toContain("codex")
  useAppStore.getState().toggleCli("codex")
  expect(useAppStore.getState().plan.clis).not.toContain("codex")
})

it("setCliMethod sets/clears a method; deselecting the cli clears it", () => {
  const s = useAppStore.getState()
  s.toggleCli("claude-code")
  s.setCliMethod("claude-code", "native")
  expect(useAppStore.getState().plan.cliMethods).toEqual({ "claude-code": "native" })
  s.setCliMethod("claude-code", undefined)
  expect(useAppStore.getState().plan.cliMethods).toEqual({})
  // A stale method choice is dropped when the CLI is deselected.
  s.setCliMethod("claude-code", "bun")
  useAppStore.getState().toggleCli("claude-code")
  expect(useAppStore.getState().plan.cliMethods).toEqual({})
})

it("applyPreset recommended fills clis", () => {
  useAppStore.getState().applyPreset("recommended")
  expect(useAppStore.getState().plan.clis).toContain("cc-switch")
})

it("applyPreset targets every agent the bundle installs", () => {
  useAppStore.getState().applyPreset("recommended")
  // "recommended" installs Claude Code + Codex, so its MCP servers configure both.
  for (const m of useAppStore.getState().plan.mcps) {
    expect(m.targets).toEqual(["claude", "codex"])
  }
  useAppStore.getState().applyPreset("minimal")
  for (const m of useAppStore.getState().plan.mcps) {
    expect(m.targets).toEqual(["claude"])
  }
})

describe("network config and MCP keys survive re-selection", () => {
  beforeEach(() => {
    const s = useAppStore.getState()
    s.setNetwork({ npmRegistry: "https://registry.npmmirror.com" })
    s.setProxy({ mode: "manual", httpUrl: "http://127.0.0.1:7890" })
    s.setMcpKey("context7", "secret")
  })

  it("applyPreset keeps them", () => {
    useAppStore.getState().applyPreset("recommended")
    const { network, mcpKeys } = useAppStore.getState().plan
    expect(network.npmRegistry).toBe("https://registry.npmmirror.com")
    expect(network.proxy?.httpUrl).toBe("http://127.0.0.1:7890")
    expect(mcpKeys.context7).toBe("secret")
  })

  it("resetPlan clears the selection but keeps them", () => {
    useAppStore.getState().applyPreset("recommended")
    useAppStore.getState().resetPlan()
    const { clis, network, mcpKeys } = useAppStore.getState().plan
    expect(clis).toHaveLength(0)
    expect(network.npmRegistry).toBe("https://registry.npmmirror.com")
    expect(network.proxy?.httpUrl).toBe("http://127.0.0.1:7890")
    expect(mcpKeys.context7).toBe("secret")
  })
})

it("applyPreset keeps install-method choices only for CLIs it still installs", () => {
  const s = useAppStore.getState()
  s.setCliMethod("claude-code", "native")
  s.setCliMethod("opencode", "bun")
  // "recommended" installs claude-code but not opencode.
  s.applyPreset("recommended")
  expect(useAppStore.getState().plan.cliMethods).toEqual({ "claude-code": "native" })
})

it("syncTargetsToClis re-points selections at the currently chosen CLIs", () => {
  const s = useAppStore.getState()
  s.applyPreset("everything")
  expect(useAppStore.getState().plan.mcps[0].targets).toEqual(["claude", "codex", "opencode"])
  useAppStore.getState().toggleCli("opencode")
  useAppStore.getState().toggleCli("codex")
  useAppStore.getState().syncTargetsToClis()
  const { skills, mcps } = useAppStore.getState().plan
  for (const m of mcps) expect(m.targets).toEqual(["claude"])
  for (const sk of skills) expect(sk.targets).toEqual(["claude"])
})

it("osOverride changes effectiveOS + plan.os", () => {
  useAppStore.getState().setOsOverride("win")
  expect(useAppStore.getState().effectiveOS()).toBe("win")
  expect(useAppStore.getState().plan.os).toBe("win")
})

it("saveCurrentAsProfile snapshots the plan and marks it current", () => {
  useAppStore.getState().toggleCli("codex")
  const p = useAppStore.getState().saveCurrentAsProfile("Work")
  expect(p.name).toBe("Work")
  expect(p.plan.clis).toContain("codex")
  expect(useAppStore.getState().profiles).toHaveLength(1)
  expect(useAppStore.getState().currentProfileId).toBe(p.id)
})

it("applyProfile restores the saved plan; unknown id is a no-op", () => {
  useAppStore.getState().toggleCli("codex")
  const p = useAppStore.getState().saveCurrentAsProfile("Work")
  useAppStore.getState().resetPlan()
  expect(useAppStore.getState().plan.clis).not.toContain("codex")
  useAppStore.getState().applyProfile(p.id)
  expect(useAppStore.getState().plan.clis).toContain("codex")
  useAppStore.getState().applyProfile("missing")
  expect(useAppStore.getState().currentProfileId).toBe(p.id)
})

it("rename + delete mutate the profile list and clear current on delete", () => {
  const p = useAppStore.getState().saveCurrentAsProfile("Old")
  useAppStore.getState().renameProfile(p.id, "New")
  expect(useAppStore.getState().profiles[0].name).toBe("New")
  useAppStore.getState().deleteProfile(p.id)
  expect(useAppStore.getState().profiles).toHaveLength(0)
  expect(useAppStore.getState().currentProfileId).toBeNull()
})

it("setProfiles replaces the list", () => {
  useAppStore
    .getState()
    .setProfiles([{ id: "x", name: "X", createdAt: 0, plan: useAppStore.getState().plan }])
  expect(useAppStore.getState().profiles.map((p) => p.id)).toEqual(["x"])
})

describe("app updates", () => {
  const info = { version: "2.0.0", currentVersion: "1.0.0" }

  beforeEach(() => {
    useAppStore.setState({
      appVersion: null,
      updateState: "idle",
      updateInfo: null,
      downloadProgress: 0,
      settings: { ...DEFAULT_SETTINGS },
    })
  })

  it("update setters assign their fields; setSettings merges", () => {
    const s = useAppStore.getState()
    s.setAppVersion("1.2.3")
    s.setUpdateState("checking")
    s.setUpdateInfo(info)
    s.setDownloadProgress(55)
    s.setSettings({ autoCheckUpdates: false })

    const next = useAppStore.getState()
    expect(next.appVersion).toBe("1.2.3")
    expect(next.updateState).toBe("checking")
    expect(next.updateInfo).toEqual(info)
    expect(next.downloadProgress).toBe(55)
    expect(next.settings).toEqual({ ...DEFAULT_SETTINGS, autoCheckUpdates: false })
  })

  it("hasUpdate is false when idle", () => {
    expect(useAppStore.getState().hasUpdate()).toBe(false)
  })

  it("hasUpdate is false when available without update info", () => {
    useAppStore.getState().setUpdateState("available")
    expect(useAppStore.getState().hasUpdate()).toBe(false)
  })

  it("hasUpdate is true when available and not skipped", () => {
    const s = useAppStore.getState()
    s.setUpdateState("available")
    s.setUpdateInfo(info)
    expect(useAppStore.getState().hasUpdate()).toBe(true)
  })

  it("hasUpdate is true when the update is downloaded (ready)", () => {
    const s = useAppStore.getState()
    s.setUpdateState("ready")
    s.setUpdateInfo(info)
    expect(useAppStore.getState().hasUpdate()).toBe(true)
  })

  it("hasUpdate is false when the available version was skipped", () => {
    const s = useAppStore.getState()
    s.setUpdateState("available")
    s.setUpdateInfo(info)
    s.setSettings({ skippedVersion: "2.0.0" })
    expect(useAppStore.getState().hasUpdate()).toBe(false)
  })
})
