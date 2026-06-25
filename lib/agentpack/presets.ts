import { CLI_TOOLS, MCP_SERVERS, SKILLS } from "./registry"

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
