/**
 * Skill install-path helpers shared by the installed browser and the bundled
 * catalog. Kept separate from `browse.ts` (pure grouping logic) so it can depend
 * on the agentpack `Paths` shape without dragging that type into browse.
 */
import type { Paths } from "@/lib/agentpack/types"
import type { SkillSource } from "./types"

/** The skills root directory for a given source (all four are detected paths). */
export function skillsDirFor(paths: Paths, source: SkillSource): string {
  switch (source) {
    case "claude":
      return paths.claudeSkillsDir
    case "codex":
      return paths.codexSkillsDir
    case "opencode":
      return paths.opencodeSkillsDir
    case "agents":
      return paths.agentsSkillsDir
  }
}

/** Absolute path a skill dir installs to under a source (`<root>/<dirName>`). */
export function skillDestPath(paths: Paths, source: SkillSource, dirName: string): string {
  return `${skillsDirFor(paths, source)}/${dirName}`
}
