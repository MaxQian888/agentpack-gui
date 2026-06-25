import { create } from "zustand"
import type { AgentTarget, OS, Paths, Plan } from "@/lib/agentpack/types"
import { findPreset } from "@/lib/agentpack/presets"

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

  effectiveOS: () => OS
  installedClis: () => Set<string>
  setDetections: (d: Record<string, Detection>) => void
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
}

export const useAppStore = create<State>((set, get) => ({
  plan: emptyPlan("mac"),
  dryRun: false,
  osOverride: null,
  paths: null,
  panelOpen: false,
  detections: {},

  effectiveOS: () => get().osOverride ?? get().paths?.os ?? "mac",
  installedClis: () =>
    new Set(
      Object.entries(get().detections)
        .filter(([, d]) => d.installed)
        .map(([id]) => id)
    ),
  setDetections: (d) => set({ detections: d }),
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
}))
