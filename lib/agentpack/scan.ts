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
 * List user-scope Claude Code MCP server ids from `~/.claude.json`.
 *
 * Reads the top-level `mcpServers` object directly — the same place
 * `claude mcp add --scope user` writes and `claude mcp remove --scope user`
 * deletes, so it stays in lockstep with what the dashboard installs/removes.
 * Replaces the old `claude mcp list` scan, which health-checked every server
 * (~45s, and could hang forever on an unreachable one). Defensive: malformed /
 * empty input degrades to an empty list, never throws.
 */
export function parseClaudeMcpConfig(json: string): string[] {
  if (!json.trim()) return []
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return []
  }
  const servers = data["mcpServers"]
  if (!servers || typeof servers !== "object") return []
  return Object.keys(servers as Record<string, unknown>)
}

/**
 * List OpenCode MCP server ids from `~/.config/opencode/opencode.json`.
 *
 * Reads the top-level `mcp` object keys — the same place `mergeOpencodeMcp`
 * writes and `deleteOpencodeMcpEntry` prunes, so it stays in lockstep with what
 * this app installs/removes for OpenCode. Defensive: malformed / empty input
 * degrades to an empty list, never throws.
 */
export function parseOpencodeMcpConfig(json: string): string[] {
  if (!json.trim()) return []
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return []
  }
  const servers = data["mcp"]
  if (!servers || typeof servers !== "object") return []
  return Object.keys(servers as Record<string, unknown>)
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
