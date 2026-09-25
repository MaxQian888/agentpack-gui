/**
 * Escape-hatch install via the skills.sh CLI (`npx skills`). Unlike the built-in
 * GitHub direct install this needs Node on PATH, but it gets users the CLI's own
 * behaviors (symlink-canonical installs into `~/.agents/skills`, 40+ agents).
 */
import type { Command } from "@/lib/agentpack/types"
import type { SkillInstallTarget } from "./types"

/** Our source names → skills.sh CLI agent names. */
const CLI_AGENT: Partial<Record<SkillInstallTarget, string>> = {
  claude: "claude-code",
  codex: "codex",
  opencode: "opencode",
  // "agents" (the shared canonical dir) is where the CLI links FROM — it is not
  // an addressable agent, so it maps to no flag.
}

/**
 * The targets the CLI can be pointed at by flag — the only ones worth offering
 * beside its button. Offering `agents` or `pi` there would let someone pick a
 * target that maps to no flag, and no flag means every agent.
 */
export const NPX_TARGETS = Object.keys(CLI_AGENT) as SkillInstallTarget[]

/**
 * `npx -y skills add <source> -g -y [-a <agents...>]` — global scope, no
 * prompts. Without any mappable agent the `-a` flag is omitted and the CLI
 * installs for every agent it detects.
 */
export function npxSkillsAddCommand(source: string, targets: SkillInstallTarget[]): Command {
  const agents = targets.map((t) => CLI_AGENT[t]).filter((a): a is string => Boolean(a))
  const args = ["-y", "skills", "add", source, "-g", "-y"]
  if (agents.length > 0) args.push("-a", ...agents)
  return { file: "npx", args }
}
