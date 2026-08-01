import { create } from "zustand"
import type {
  AgentTarget,
  CliInstallManager,
  McpTarget,
  OS,
  Paths,
  Plan,
  ProxyConfig,
} from "@/lib/agentpack/types"
import { DEFAULT_PROXY } from "@/lib/agentpack/network/proxy"
import {
  isDefaultBrew,
  isDefaultMirror,
  pickMirror,
  type NetworkProbeResult,
} from "@/lib/agentpack/network/probe"
import { brewMirrorEnv } from "@/lib/agentpack/network/mirrors"
import type { RecoveryContext } from "@/lib/agentpack/network/recovery"
import type { Profile } from "@/lib/agentpack/profile"
import type { ActivityRecord } from "@/lib/agentpack/activity"
import {
  mcpTargetsFor,
  presetSelection,
  skillTargetsFor,
  type Surface,
} from "@/lib/agentpack/presets"
import type { UpdateInfo } from "@/lib/tauri/updater"
import { type AppSettings, DEFAULT_SETTINGS } from "@/lib/tauri/settings"

/** Stable-ish local id for a profile (no Date import needed at module scope). */
function newProfileId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const emptyPlan = (os: OS): Plan => ({
  os,
  clis: [],
  skills: [],
  mcps: [],
  mcpKeys: {},
  network: {},
})

/**
 * The parts of a plan that survive switching bundles or clearing the selection.
 * A bundle only describes WHAT to install; the network config (proxy, npm mirror,
 * relay endpoint) and the MCP API keys are the user's own environment, set up in
 * other sections and often already applied to disk and to this process. Wiping
 * them with the selection silently dropped the mirror/proxy from the very run
 * that needed it, and left the proxy card reading "off" while the proxy it wrote
 * was still live.
 */
const keptOnReselect = (plan: Plan): Pick<Plan, "network" | "mcpKeys"> => ({
  network: plan.network,
  mcpKeys: plan.mcpKeys,
})

export type Detection = { installed: boolean; version?: string }

/** Lifecycle of the app self-update flow (About section + header badge). */
export type UpdateState =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "error"

interface State {
  plan: Plan
  /**
   * Preview is no longer a mode. It used to be a global switch in the title bar,
   * which meant every write in the app had to remember to ask about it and the
   * user had to remember it was on — so it is now a button inside the review
   * panel, scoped to the one run it previews. See `useRunner.previewPending`.
   */
  osOverride: OS | null
  paths: Paths | null
  panelOpen: boolean
  /** First-run welcome wizard visibility (opened on a fresh install, or manually from About). */
  onboardingOpen: boolean
  /** Guided product tour (spotlight walkthrough of each section) active state. */
  tourActive: boolean
  detections: Record<string, Detection>
  latestVersions: Record<string, string>
  /** How each installed CLI was installed (npm vs native), for in-place upgrades. */
  cliManagers: Record<string, CliInstallManager>
  /**
   * Whether each installed runtime is owned by the OS package manager (winget/
   * brew) its update/reinstall uses. Absent id => unknown (still probing, or the
   * runtime self-updates) — the UI keeps the normal actions until it's a
   * confirmed `false`, then swaps them for a download link.
   */
  runtimeOwned: Record<string, boolean>
  /**
   * What one measured pass learned about this machine's network: which proxies
   * work, whether the direct route works at all, and which mirrors are fastest.
   *
   * Held centrally because three surfaces need the same answer — the Network
   * section, the first-run wizard's self-check, and the install-failure recovery
   * ladder — and each running its own scan would let them disagree about what
   * works. null until the startup probe lands (or when not running under Tauri).
   */
  networkProbe: NetworkProbeResult | null
  /** True while the probe is in flight, so the UI can show it working. */
  networkProbing: boolean
  profiles: Profile[]
  currentProfileId: string | null
  /**
   * What this app has done to this machine, newest first. Hydrated once at
   * startup and replaced after each real run; the file on disk is the truth.
   */
  activity: ActivityRecord[]

  // App self-update + persisted settings.
  appVersion: string | null
  updateState: UpdateState
  updateInfo: UpdateInfo | null
  downloadProgress: number
  settings: AppSettings

  effectiveOS: () => OS
  /** True when a not-skipped update is available or downloaded (drives the badge). */
  hasUpdate: () => boolean
  setAppVersion: (version: string | null) => void
  setUpdateState: (state: UpdateState) => void
  setUpdateInfo: (info: UpdateInfo | null) => void
  setDownloadProgress: (pct: number) => void
  setSettings: (patch: Partial<AppSettings>) => void
  installedClis: () => Set<string>
  setDetections: (d: Record<string, Detection>) => void
  setDetection: (id: string, d: Detection) => void
  setLatestVersion: (id: string, version: string) => void
  setCliManager: (id: string, manager: CliInstallManager) => void
  setRuntimeOwned: (id: string, owned: boolean) => void
  setNetworkProbe: (result: NetworkProbeResult | null) => void
  setNetworkProbing: (probing: boolean) => void
  /**
   * The mirrors + proxy an install failure should retry through, derived from
   * the last probe. Undefined when nothing has been measured yet, which is what
   * keeps the runner's recovery inert instead of guessing at URLs.
   */
  recoveryContext: () => RecoveryContext | undefined
  setPaths: (p: Paths) => void
  setOsOverride: (os: OS | null) => void
  setPanelOpen: (open: boolean) => void
  setOnboardingOpen: (open: boolean) => void
  setTourActive: (active: boolean) => void

  setClis: (clis: Plan["clis"]) => void
  toggleCli: (id: Plan["clis"][number]) => void
  /** Choose which install method a CLI uses (undefined => back to the default). */
  setCliMethod: (id: string, methodId: string | undefined) => void
  setSkill: (id: string, targets: AgentTarget[]) => void
  setMcp: (id: string, targets: McpTarget[]) => void
  setMcpKey: (id: string, key: string) => void
  setNetwork: (patch: Partial<Plan["network"]>) => void
  /** Merge into `plan.network.proxy`, seeding the default config on first touch. */
  setProxy: (patch: Partial<ProxyConfig>) => void
  /** Replace the selection with a bundle's, keeping network config + MCP keys. */
  /**
   * Load a bundle's selection. `surface` decides whether its agents arrive as
   * desktop apps, terminal CLIs, or both — the bundle itself says only *which*
   * agents, so it needs no GUI variant.
   */
  applyPreset: (presetId: string, surface?: Surface) => void
  loadPlan: (plan: Plan) => void
  /** Clear the selection (CLIs / skills / MCP), keeping network config + MCP keys. */
  resetPlan: () => void
  /**
   * Re-point every selected skill / MCP server at the agent CLIs the plan now
   * installs. Called only by the quick-install dialog: that's the one surface
   * where the CLI list and the skill / MCP list are authored together, so a stale
   * target there would write config for an agent the user just unticked. The MCP
   * section's per-server toggles are deliberate and are never retargeted.
   */
  syncTargetsToClis: () => void

  setActivity: (activity: ActivityRecord[]) => void

  setProfiles: (profiles: Profile[]) => void
  /** Snapshot the current plan as a new profile; returns it so callers persist. */
  saveCurrentAsProfile: (name: string) => Profile
  applyProfile: (id: string) => void
  deleteProfile: (id: string) => void
  renameProfile: (id: string, name: string) => void
}

export const useAppStore = create<State>((set, get) => ({
  plan: emptyPlan("mac"),
  osOverride: null,
  paths: null,
  panelOpen: false,
  onboardingOpen: false,
  tourActive: false,
  detections: {},
  latestVersions: {},
  cliManagers: {},
  runtimeOwned: {},
  networkProbe: null,
  networkProbing: false,
  profiles: [],
  currentProfileId: null,
  activity: [],

  appVersion: null,
  updateState: "idle",
  updateInfo: null,
  downloadProgress: 0,
  settings: { ...DEFAULT_SETTINGS },

  effectiveOS: () => get().osOverride ?? get().paths?.os ?? "mac",
  hasUpdate: () => {
    const s = get()
    if (s.updateState !== "available" && s.updateState !== "ready") return false
    return !!s.updateInfo && s.updateInfo.version !== s.settings.skippedVersion
  },
  setAppVersion: (version) => set({ appVersion: version }),
  setUpdateState: (updateState) => set({ updateState }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setDownloadProgress: (downloadProgress) => set({ downloadProgress }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  installedClis: () =>
    new Set(
      Object.entries(get().detections)
        .filter(([, d]) => d.installed)
        .map(([id]) => id)
    ),
  setDetections: (d) => set({ detections: d }),
  setDetection: (id, d) => set((s) => ({ detections: { ...s.detections, [id]: d } })),
  setLatestVersion: (id, version) =>
    set((s) => ({ latestVersions: { ...s.latestVersions, [id]: version } })),
  setCliManager: (id, manager) =>
    set((s) => ({ cliManagers: { ...s.cliManagers, [id]: manager } })),
  setRuntimeOwned: (id, owned) =>
    set((s) => ({ runtimeOwned: { ...s.runtimeOwned, [id]: owned } })),
  setNetworkProbe: (networkProbe) => set({ networkProbe }),
  setNetworkProbing: (networkProbing) => set({ networkProbing }),
  recoveryContext: () => {
    const probe = get().networkProbe
    if (!probe) return undefined
    // "repair" mode: this is only ever consulted after something already failed,
    // so the fastest working mirror wins even when it isn't the official one.
    const npm = pickMirror(probe.npm, "repair", isDefaultMirror)
    const pypi = pickMirror(probe.pypi, "repair", isDefaultMirror)
    const brew = pickMirror(probe.brew, "repair", isDefaultBrew)
    const ctx: RecoveryContext = {
      proxyUrl: probe.bestProxy?.url ?? null,
      npmRegistry: npm?.preset.url ?? null,
      pypiIndex: pypi?.preset.url ?? null,
      brewEnv: brewMirrorEnv(brew?.preset),
    }
    const noProxy = get().plan.network.proxy?.noProxy
    if (noProxy) ctx.noProxy = noProxy
    // Nothing measured as usable — return undefined rather than a context full of
    // nulls, so the runner stays inert instead of "retrying" with no change.
    if (!ctx.proxyUrl && !ctx.npmRegistry && !ctx.pypiIndex && !Object.keys(ctx.brewEnv!).length) {
      return undefined
    }
    return ctx
  },
  setPaths: (p) => set((s) => ({ paths: p, plan: { ...s.plan, os: s.osOverride ?? p.os } })),
  setOsOverride: (os) =>
    set((s) => ({ osOverride: os, plan: { ...s.plan, os: os ?? s.paths?.os ?? "mac" } })),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setOnboardingOpen: (open) => set({ onboardingOpen: open }),
  setTourActive: (active) => set({ tourActive: active }),

  setClis: (clis) => set((s) => ({ plan: { ...s.plan, clis } })),
  toggleCli: (id) =>
    set((s) => {
      const removing = s.plan.clis.includes(id)
      const clis = removing ? s.plan.clis.filter((c) => c !== id) : [...s.plan.clis, id]
      // Drop a stale method choice when the CLI is deselected.
      const cliMethods = { ...(s.plan.cliMethods ?? {}) }
      if (removing) delete cliMethods[id]
      return { plan: { ...s.plan, clis, cliMethods } }
    }),
  setCliMethod: (id, methodId) =>
    set((s) => {
      const cliMethods = { ...(s.plan.cliMethods ?? {}) }
      if (methodId) cliMethods[id] = methodId
      else delete cliMethods[id]
      return { plan: { ...s.plan, cliMethods } }
    }),
  setSkill: (id, targets) =>
    set((s) => {
      const skills = s.plan.skills.filter((x) => x.id !== id)
      if (targets.length) skills.push({ id, targets })
      return { plan: { ...s.plan, skills } }
    }),
  setMcp: (id, targets) =>
    set((s) => {
      const mcps = s.plan.mcps.filter((x) => x.id !== id)
      if (targets.length) mcps.push({ id, targets })
      return { plan: { ...s.plan, mcps } }
    }),
  setMcpKey: (id, key) =>
    set((s) => ({ plan: { ...s.plan, mcpKeys: { ...s.plan.mcpKeys, [id]: key } } })),
  setNetwork: (patch) =>
    set((s) => ({ plan: { ...s.plan, network: { ...s.plan.network, ...patch } } })),
  setProxy: (patch) =>
    set((s) => {
      const proxy = { ...DEFAULT_PROXY, ...s.plan.network.proxy, ...patch }
      return { plan: { ...s.plan, network: { ...s.plan.network, proxy } } }
    }),
  applyPreset: (presetId, surface) =>
    set((s) => {
      const base = { ...emptyPlan(s.plan.os), ...keptOnReselect(s.plan) }
      // Shared with the welcome wizard's "what this installs" list, so the
      // preview the user reads is derived from the same code as the plan.
      const picked = presetSelection(presetId, surface)
      if (!picked) return { plan: base }
      // Keep a deliberate install-channel choice (e.g. Claude Code via the native
      // script instead of npm) for every CLI the bundle still installs; drop the
      // rest, like toggleCli does when a CLI is deselected.
      const cliMethods = Object.fromEntries(
        Object.entries(s.plan.cliMethods ?? {}).filter(([id]) => picked.clis.includes(id))
      )
      return {
        plan: {
          ...base,
          clis: picked.clis as Plan["clis"],
          skills: picked.skills,
          mcps: picked.mcps,
          ...(Object.keys(cliMethods).length > 0 ? { cliMethods } : {}),
        },
      }
    }),
  loadPlan: (plan) => set({ plan }),
  resetPlan: () => set((s) => ({ plan: { ...emptyPlan(s.plan.os), ...keptOnReselect(s.plan) } })),
  syncTargetsToClis: () =>
    set((s) => ({
      plan: {
        ...s.plan,
        skills: s.plan.skills.map((x) => ({ ...x, targets: skillTargetsFor(s.plan.clis) })),
        mcps: s.plan.mcps.map((x) => ({ ...x, targets: mcpTargetsFor(s.plan.clis) })),
      },
    })),

  setActivity: (activity) => set({ activity }),

  setProfiles: (profiles) => set({ profiles }),
  saveCurrentAsProfile: (name) => {
    const profile: Profile = {
      id: newProfileId(),
      name,
      createdAt: Date.now(),
      plan: get().plan,
    }
    set((s) => ({ profiles: [profile, ...s.profiles], currentProfileId: profile.id }))
    return profile
  },
  applyProfile: (id) =>
    set((s) => {
      const p = s.profiles.find((x) => x.id === id)
      if (!p) return {}
      return { plan: p.plan, currentProfileId: id }
    }),
  deleteProfile: (id) =>
    set((s) => ({
      profiles: s.profiles.filter((p) => p.id !== id),
      currentProfileId: s.currentProfileId === id ? null : s.currentProfileId,
    })),
  renameProfile: (id, name) =>
    set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, name } : p)) })),
}))
