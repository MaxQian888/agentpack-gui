import { parse } from "smol-toml"
import { MCP_SERVERS, SKILLS } from "./registry"

/**
 * Reverse-scan layer: pure parsers that turn the *real* on-disk config files
 * back into structured state, so the dashboard can show what is actually
 * installed — including entries the user added by hand (outside agentpack's
 * registry). Each parser inverts a corresponding `merge/*` writer and is
 * defensive: malformed / empty input degrades to an empty result, never throws.
 */

/** Relay (custom API endpoint) state read from Claude settings.json. */
export interface ClaudeRelayState {
  baseUrl?: string
  hasToken: boolean
}

/** What a Codex config.toml currently declares. */
export interface CodexConfigState {
  mcpServers: string[]
  hasRelayProvider: boolean
}

/** Splitting scanned ids into ones agentpack knows vs. user-added extras. */
export interface ClassifiedIds {
  known: string[]
  custom: string[]
}

/** Read the relay env vars from Claude settings.json (inverts mergeClaudeSettings). */
export function parseClaudeRelay(json: string): ClaudeRelayState {
  if (!json.trim()) return { hasToken: false }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return { hasToken: false }
  }
  const env = (data["env"] as Record<string, unknown> | undefined) ?? {}
  const baseUrl =
    typeof env["ANTHROPIC_BASE_URL"] === "string" ? env["ANTHROPIC_BASE_URL"] : undefined
  return { baseUrl, hasToken: typeof env["ANTHROPIC_AUTH_TOKEN"] === "string" }
}

/** List declared MCP servers + relay provider from Codex config.toml. */
export function parseCodexConfig(toml: string): CodexConfigState {
  if (!toml.trim()) return { mcpServers: [], hasRelayProvider: false }
  let data: Record<string, unknown>
  try {
    data = parse(toml) as Record<string, unknown>
  } catch {
    return { mcpServers: [], hasRelayProvider: false }
  }
  const servers = (data["mcp_servers"] as Record<string, unknown> | undefined) ?? {}
  const providers = (data["model_providers"] as Record<string, unknown> | undefined) ?? {}
  return {
    mcpServers: Object.keys(servers),
    hasRelayProvider: "agentpack" in providers,
  }
}

/**
 * Parse `claude mcp list` stdout into server ids. Each entry looks like
 * `name: <command>` (and may be prefixed with status glyphs / ANSI); we take
 * the token before the first colon. Lines without a colon are ignored.
 */
export function parseClaudeMcpList(stdout: string): string[] {
  const ids: string[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    // Strip ANSI escapes and leading status glyphs / whitespace.
    const line = raw.replace(/\[[0-9;]*m/g, "").trim()
    if (!line) continue
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    const id = line
      .slice(0, colon)
      .replace(/^[^\w@-]+/, "")
      .trim()
    if (id && !/\s/.test(id)) ids.push(id)
  }
  return ids
}

/** Split ids into ones present in `registryIds` (known) and the rest (custom). */
export function classifyAgainstRegistry(
  ids: readonly string[],
  registryIds: readonly string[]
): ClassifiedIds {
  const known: string[] = []
  const custom: string[] = []
  const reg = new Set(registryIds)
  for (const id of ids) (reg.has(id) ? known : custom).push(id)
  return { known, custom }
}

/** Registry id sets, exposed so the dashboard can classify without re-deriving. */
export const MCP_REGISTRY_IDS: readonly string[] = MCP_SERVERS.map((m) => m.id)
export const SKILL_REGISTRY_IDS: readonly string[] = SKILLS.map((s) => s.id)
