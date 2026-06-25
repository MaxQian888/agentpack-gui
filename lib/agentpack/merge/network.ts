import { parse, stringify } from "smol-toml"
import type { Command, NetworkConfig } from "../types"

/** `npm config set registry <url>` */
export function npmRegistryCommand(url: string): Command {
  return { file: "npm", args: ["config", "set", "registry", url] }
}

/** Env var name the relay token is referenced through in Codex config. */
export const CODEX_RELAY_ENV = "AGENTPACK_API_KEY"

/**
 * Merge relay env vars into a Claude Code settings.json text. Claude Code reads
 * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN from its `env` block.
 */
export function mergeClaudeSettings(existingJson: string, net: NetworkConfig): string {
  const data = (existingJson.trim() ? JSON.parse(existingJson) : {}) as Record<string, unknown>
  const env = (data["env"] as Record<string, string>) ?? {}
  if (net.apiBaseUrl) env["ANTHROPIC_BASE_URL"] = net.apiBaseUrl
  if (net.apiToken) env["ANTHROPIC_AUTH_TOKEN"] = net.apiToken
  data["env"] = env
  return JSON.stringify(data, null, 2) + "\n"
}

/**
 * Merge a custom relay provider into Codex config.toml. The token itself is NOT
 * written to disk; it is referenced via an env var (CODEX_RELAY_ENV).
 */
export function mergeCodexProvider(existingToml: string, net: NetworkConfig): string {
  if (!net.apiBaseUrl) return existingToml
  const data = (existingToml.trim() ? parse(existingToml) : {}) as Record<string, unknown>
  const providers = (data["model_providers"] as Record<string, unknown>) ?? {}
  providers["agentpack"] = {
    name: "agentpack relay",
    base_url: net.apiBaseUrl,
    env_key: CODEX_RELAY_ENV,
    wire_api: "responses",
  }
  data["model_providers"] = providers
  data["model_provider"] = "agentpack"
  return stringify(data)
}
