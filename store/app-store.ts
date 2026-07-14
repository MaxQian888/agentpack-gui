import { create } from "zustand"
import type {
  AgentTarget,
  CliInstallManager,
  McpTarget,
  OS,
  Paths,
  Plan,
} from "@/lib/agentpack/types"
import type { Profile } from "@/lib/agentpack/profile"
import { findPreset } from "@/lib/agentpack/presets"
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
  dryRun: boolean
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
  profiles: Profile[]
  currentProfileId: string | null

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
  setPaths: (p: Paths) => void
  toggleDryRun: () => void
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
  applyPreset: (presetId: string) => void
  loadPlan: (plan: Plan) => void
  resetPlan: () => void

  setProfiles: (profiles: Profile[]) => void
  /** Snapshot the current plan as a new profile; returns it so callers persist. */
  saveCurrentAsProfile: (name: string) => Profile
  applyProfile: (id: string) => void
  deleteProfile: (id: string) => void
  renameProfile: (id: string, name: string) => void
}

export const useAppStore = create<State>((set, get) => ({
  plan: emptyPlan("mac"),
  dryRun: false,
  osOverride: null,
  paths: null,
  panelOpen: false,
  onboardingOpen: false,
  tourActive: false,
  detections: {},
  latestVersions: {},
  cliManagers: {},
  runtimeOwned: {},
  profiles: [],
  currentProfileId: null,

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
  setPaths: (p) => set((s) => ({ paths: p, plan: { ...s.plan, os: s.osOverride ?? p.os } })),
  toggleDryRun: () => set((s) => ({ dryRun: !s.dryRun })),
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
  applyPreset: (presetId) =>
    set((s) => {
      const p = findPreset(presetId)
      if (!p) return { plan: emptyPlan(s.plan.os) }
      return {
        plan: {
          ...emptyPlan(s.plan.os),
          clis: p.clis as Plan["clis"],
          skills: p.skills.map((id) => ({ id, targets: ["claude", "codex"] as AgentTarget[] })),
          mcps: p.mcps.map((id) => ({ id, targets: ["claude"] as McpTarget[] })),
        },
      }
    }),
  loadPlan: (plan) => set({ plan }),
  resetPlan: () => set((s) => ({ plan: emptyPlan(s.plan.os) })),

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
