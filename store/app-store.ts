import { create } from "zustand"
import type { AgentTarget, OS, Paths, Plan } from "@/lib/agentpack/types"
import type { Profile } from "@/lib/agentpack/profile"
import { findPreset } from "@/lib/agentpack/presets"

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

interface State {
  plan: Plan
  dryRun: boolean
  osOverride: OS | null
  paths: Paths | null
  panelOpen: boolean
  detections: Record<string, Detection>
  latestVersions: Record<string, string>
  profiles: Profile[]
  currentProfileId: string | null

  effectiveOS: () => OS
  installedClis: () => Set<string>
  setDetections: (d: Record<string, Detection>) => void
  setDetection: (id: string, d: Detection) => void
  setLatestVersion: (id: string, version: string) => void
  setPaths: (p: Paths) => void
  toggleDryRun: () => void
  setOsOverride: (os: OS | null) => void
  setPanelOpen: (open: boolean) => void

  setClis: (clis: Plan["clis"]) => void
  toggleCli: (id: Plan["clis"][number]) => void
  setSkill: (id: string, targets: AgentTarget[]) => void
  setMcp: (id: string, targets: AgentTarget[]) => void
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
  detections: {},
  latestVersions: {},
  profiles: [],
  currentProfileId: null,

  effectiveOS: () => get().osOverride ?? get().paths?.os ?? "mac",
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
  setPaths: (p) => set((s) => ({ paths: p, plan: { ...s.plan, os: s.osOverride ?? p.os } })),
  toggleDryRun: () => set((s) => ({ dryRun: !s.dryRun })),
  setOsOverride: (os) =>
    set((s) => ({ osOverride: os, plan: { ...s.plan, os: os ?? s.paths?.os ?? "mac" } })),
  setPanelOpen: (open) => set({ panelOpen: open }),

  setClis: (clis) => set((s) => ({ plan: { ...s.plan, clis } })),
  toggleCli: (id) =>
    set((s) => {
      const clis = s.plan.clis.includes(id)
        ? s.plan.clis.filter((c) => c !== id)
        : [...s.plan.clis, id]
      return { plan: { ...s.plan, clis } }
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
          mcps: p.mcps.map((id) => ({ id, targets: ["claude"] as AgentTarget[] })),
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
