import { parse, stringify } from "smol-toml"
import type { Command, McpServer } from "../types"

/**
 * Build the `claude mcp add ...` command for a server (Claude Code).
 * stdio  -> `claude mcp add <id> --scope user [--env K=V] -- npx -y <pkg> [extra]`
 * http   -> `claude mcp add --transport http <id> <url> [--header "Authorization: Bearer <key>"]`
 */
export function buildClaudeMcpCommand(server: McpServer, key: string | undefined): Command {
  const hasKey = !!key && key.trim().length > 0

  if (server.transport === "http") {
    const args = ["mcp", "add", "--transport", "http", server.id, server.url ?? ""]
    if (hasKey) args.push("--header", `Authorization: Bearer ${key}`)
    return { file: "claude", args }
  }

  const args = ["mcp", "add", server.id, "--scope", "user"]
  if (hasKey && server.keyEnv) args.push("--env", `${server.keyEnv}=${key}`)
  args.push("--", "npx", "-y", server.npmPackage ?? "")
  if (server.extraArgs) args.push(...server.extraArgs)
  return { file: "claude", args }
}

/** A single `[mcp_servers.<id>]` table value for Codex's config.toml. */
export type CodexMcpEntry = Record<string, unknown>

/**
 * Build the Codex `mcp_servers.<id>` table entry. When a key is provided for a
 * stdio server it is written into an `env` table; for http servers the key's
 * env-var name is referenced via `bearer_token_env_var` (token stays in env).
 */
export function buildCodexMcpEntry(server: McpServer, key: string | undefined): CodexMcpEntry {
  const hasKey = !!key && key.trim().length > 0

  if (server.transport === "http") {
    const entry: CodexMcpEntry = { url: server.url ?? "" }
    if (server.keyEnv) entry["bearer_token_env_var"] = server.keyEnv
    return entry
  }

  const args = ["-y", server.npmPackage ?? "", ...(server.extraArgs ?? [])]
  const entry: CodexMcpEntry = { command: "npx", args }
  if (hasKey && server.keyEnv) entry["env"] = { [server.keyEnv]: key }
  return entry
}

/**
 * Merge one MCP entry into an existing config.toml text, returning new TOML.
 * Idempotent: re-merging the same id overwrites that table only, leaving the
 * rest of the file's data intact.
 */
export function mergeCodexMcp(existingToml: string, id: string, entry: CodexMcpEntry): string {
  const data = (existingToml.trim() ? parse(existingToml) : {}) as Record<string, unknown>
  const servers = (data["mcp_servers"] as Record<string, unknown>) ?? {}
  servers[id] = entry
  data["mcp_servers"] = servers
  return stringify(data)
}
