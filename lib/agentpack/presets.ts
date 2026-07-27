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
 * CLI id → the agent whose config surface hosts skills and MCP servers. Only the
 * three agent CLIs host anything: cc-switch and cc-connect are companions and map
 * to nothing.
 */
const AGENT_OF: Readonly<Record<string, McpTarget>> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
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
