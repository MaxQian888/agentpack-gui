import { CLI_TOOLS, MCP_SERVERS, SKILLS } from "./registry"
import { MCP_TARGETS, type AgentTarget, type McpTarget, type Plan } from "./types"

/**
 * A one-click selection bundle. Holds only registry ids; display text lives in
 * the i18n catalog (`catalog.presets[id]`). "everything" is computed from the
 * registry so it stays correct as the catalog grows.
 */
export interface Preset {
  id: string
  clis: string[]
  skills: string[]
  mcps: string[]
}

export const PRESETS: readonly Preset[] = [
  {
    id: "minimal",
    clis: ["claude-code"],
    skills: [],
    mcps: ["memory"],
  },
  {
    id: "recommended",
    clis: ["claude-code", "codex", "cc-switch"],
    skills: [],
    mcps: ["memory", "context7", "sequential-thinking", "fetch", "github"],
  },
  {
    id: "everything",
    clis: CLI_TOOLS.map((c) => c.id),
    skills: SKILLS.map((s) => s.id),
    mcps: MCP_SERVERS.map((m) => m.id),
  },
]

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}

/**
 * Tool id → the agent whose config surface hosts skills and MCP servers.
 * cc-switch and cc-connect are companions and map to nothing.
 *
 * A desktop app maps to the same surface as its CLI, because it reads the same
 * files. Without this a desktop-only selection fell through to the "no agent at
 * all" fallback and configured Claude only, leaving the Codex app with nothing.
 */
const AGENT_OF: Readonly<Record<string, McpTarget>> = {
  "claude-code": "claude",
  "claude-desktop": "claude",
  codex: "codex",
  "codex-app": "codex",
  opencode: "opencode",
}

/** Which form of the agents to install. Chosen on the wizard's first step. */
export type Surface = "gui" | "cli" | "both"

/** The desktop app that replaces each agent CLI, and vice versa. */
const DESKTOP_OF: Readonly<Record<string, string>> = {
  "claude-code": "claude-desktop",
  codex: "codex-app",
}

/**
 * Rewrite a bundle's tool list for the surface the user picked.
 *
 * The bundles say *which agents* to set up; this says *what form* they take, so
 * the two questions stay separate — a bundle doesn't need a GUI and a CLI
 * variant. Only the agents have two forms: cc-switch, cc-connect and OpenCode
 * pass through untouched (OpenCode is a TUI and ships no desktop app).
 *
 * Order is preserved, and each id appears once, so "both" reads as
 * claude-code, claude-desktop, codex, codex-app rather than an interleaving
 * that depends on the bundle's original order.
 */
export function applySurface(clis: readonly string[], surface: Surface): string[] {
  const out: string[] = []
  const add = (id: string) => {
    if (!out.includes(id)) out.push(id)
  }
  for (const id of clis) {
    // An id that's already a desktop app resolves back to its CLI first, so
    // re-applying a surface to an existing selection is idempotent rather than
    // additive.
    const cli = Object.keys(DESKTOP_OF).find((k) => DESKTOP_OF[k] === id) ?? id
    const desktop = DESKTOP_OF[cli]
    if (!desktop) {
      add(cli)
      continue
    }
    if (surface !== "gui") add(cli)
    if (surface !== "cli") add(desktop)
  }
  return out
}

/**
 * Which agents a bundle's MCP servers should be configured for: exactly the agent
 * CLIs this selection sets up. Picking a bundle with Codex in it now configures
 * Codex too, instead of writing Claude-only config for a Codex the user asked for.
 *
 * Falls back to Claude Code when the selection contains no agent CLI at all — a
 * chosen server has to land somewhere, and Claude is the primary target. The
 * per-server target toggles in the MCP section stay the way to deviate from this.
 */
export function mcpTargetsFor(clis: readonly string[]): McpTarget[] {
  const picked = new Set(clis.map((id) => AGENT_OF[id]).filter((tg): tg is McpTarget => !!tg))
  const targets = MCP_TARGETS.filter((tg) => picked.has(tg))
  return targets.length > 0 ? targets : ["claude"]
}

/**
 * Same for skills, minus OpenCode: `Plan.skills` targets are `AgentTarget`, so the
 * onboarding plan only fills the claude/codex skill roots (the Skills section
 * installs into all four). An OpenCode-only selection therefore falls back to
 * Claude rather than dropping the skill silently.
 */
export function skillTargetsFor(clis: readonly string[]): AgentTarget[] {
  const targets = mcpTargetsFor(clis).filter((tg): tg is AgentTarget => tg !== "opencode")
  return targets.length > 0 ? targets : ["claude"]
}

/** What a bundle resolves to for a given surface: ids plus where each one lands. */
export interface PresetSelection {
  clis: string[]
  skills: { id: string; targets: AgentTarget[] }[]
  mcps: { id: string; targets: McpTarget[] }[]
}

/**
 * Resolve a bundle id + surface into the exact selection it installs.
 *
 * Pure, so the welcome wizard can *show* what Install is about to do without
 * mutating the shared plan first — a preview that had to write to the store
 * would apply the bundle to someone who then pressed Back. The store's
 * `applyPreset` is the only writer, and it calls this, so the list the user
 * reads and the plan that runs can't drift.
 *
 * Null for an unknown id, which the store turns into an empty selection.
 */
export function presetSelection(presetId: string, surface?: Surface): PresetSelection | null {
  const found = findPreset(presetId)
  if (!found) return null
  // Resolve the surface up front so every derivation below — targets, and the
  // caller's kept install methods — sees the tools that will actually be installed.
  const clis = surface ? applySurface(found.clis, surface) : [...found.clis]
  return {
    clis,
    // Targets follow the bundle's own CLIs, so a bundle that installs Codex
    // configures Codex too instead of writing Claude-only config.
    skills: found.skills.map((id) => ({ id, targets: skillTargetsFor(clis) })),
    mcps: found.mcps.map((id) => ({ id, targets: mcpTargetsFor(clis) })),
  }
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false
  const sb = new Set(b)
  return a.every((x) => sb.has(x))
}

/**
 * Which preset the plan's selection exactly matches (by id sets), else "custom" —
 * drives the highlighted chip in the quick-install dialog and the Presets page.
 * Only ids are compared, so it stays true even though the plan also carries
 * per-item targets, install-method choices and network config.
 */
export function matchPreset(plan: Plan): string {
  for (const p of PRESETS) {
    if (
      sameSet(plan.clis, p.clis) &&
      sameSet(
        plan.skills.map((s) => s.id),
        p.skills
      ) &&
      sameSet(
        plan.mcps.map((m) => m.id),
        p.mcps
      )
    ) {
      return p.id
    }
  }
  return "custom"
}
