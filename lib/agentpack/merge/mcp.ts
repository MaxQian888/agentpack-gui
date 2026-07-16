import { parse, stringify } from "smol-toml"
import type { Command, McpServer } from "../types"

/**
 * Normalized MCP server config, the single intermediate shape all three targets
 * (Claude Code, Codex, OpenCode) are written from. The opinionated catalog
 * (`McpServer`) resolves into this via `resolveCatalogSpec`; user-defined custom
 * servers construct it directly — so a custom server can run any `command`
 * (uvx / python / a binary), carry arbitrary `env`, or use non-Authorization
 * `headers`, none of which `McpServer` can express.
 *
 * For http, `headers` are the inline headers Claude/OpenCode write, while
 * `bearerTokenEnvVar` names the env var Codex references (Codex never inlines a
 * token — it reads it from the environment).
 */
export type McpSpec =
  | { transport: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { transport: "http"; url: string; headers: Record<string, string>; bearerTokenEnvVar?: string }

/**
 * Resolve a catalog `McpServer` (+ optional API key) into an `McpSpec`, exactly
 * reproducing the historical behavior: stdio runs `npx -y <package> [extraArgs]`
 * with the key injected as `keyEnv`; http points at `url` with the key added as
 * an `Authorization: Bearer` header (inline) and `keyEnv` recorded as the Codex
 * bearer-token env var.
 */
export function resolveCatalogSpec(server: McpServer, key: string | undefined): McpSpec {
  const hasKey = !!key && key.trim().length > 0
  if (server.transport === "http") {
    return {
      transport: "http",
      url: server.url ?? "",
      headers: hasKey ? { Authorization: `Bearer ${key}` } : {},
      bearerTokenEnvVar: server.keyEnv,
    }
  }
  const args = ["-y", server.npmPackage ?? "", ...(server.extraArgs ?? [])]
  const env = hasKey && server.keyEnv ? { [server.keyEnv]: key! } : {}
  return { transport: "stdio", command: "npx", args, env }
}

// ---------------------------------------------------------------------------
// Claude Code — `claude mcp add ...` command
// ---------------------------------------------------------------------------

/**
 * Build the `claude mcp add ...` command for a resolved spec.
 * stdio -> `claude mcp add <id> --scope user [--env K=V ...] -- <command> ...args`
 * http  -> `claude mcp add --transport http <id> <url> [--header "K: V" ...]`
 */
export function buildClaudeMcpCommandFromSpec(id: string, spec: McpSpec): Command {
  if (spec.transport === "http") {
    const args = ["mcp", "add", "--transport", "http", id, spec.url]
    for (const [k, v] of Object.entries(spec.headers)) args.push("--header", `${k}: ${v}`)
    return { file: "claude", args }
  }
  const args = ["mcp", "add", id, "--scope", "user"]
  for (const [k, v] of Object.entries(spec.env)) args.push("--env", `${k}=${v}`)
  args.push("--", spec.command, ...spec.args)
  return { file: "claude", args }
}

/**
 * Build the `claude mcp add ...` command for a catalog server (Claude Code).
 * Thin façade over `resolveCatalogSpec` + `buildClaudeMcpCommandFromSpec`.
 */
export function buildClaudeMcpCommand(server: McpServer, key: string | undefined): Command {
  return buildClaudeMcpCommandFromSpec(server.id, resolveCatalogSpec(server, key))
}

/**
 * Build the `claude mcp remove <id>` command (Claude Code). Symmetric to
 * `buildClaudeMcpCommand`'s `--scope user`.
 */
export function buildClaudeMcpRemoveCommand(id: string): Command {
  return { file: "claude", args: ["mcp", "remove", id, "--scope", "user"] }
}

// ---------------------------------------------------------------------------
// Codex — `[mcp_servers.<id>]` table in config.toml
// ---------------------------------------------------------------------------

/** A single `[mcp_servers.<id>]` table value for Codex's config.toml. */
export type CodexMcpEntry = Record<string, unknown>

/**
 * Build the Codex `mcp_servers.<id>` table entry from a resolved spec. For stdio
 * the key lives in an `env` table; for http the token is referenced by name via
 * `bearer_token_env_var` (Codex reads it from the environment — it is never
 * written to disk, so inline http `headers` are dropped for this target).
 */
export function buildCodexMcpEntryFromSpec(spec: McpSpec): CodexMcpEntry {
  if (spec.transport === "http") {
    const entry: CodexMcpEntry = { url: spec.url }
    if (spec.bearerTokenEnvVar) entry["bearer_token_env_var"] = spec.bearerTokenEnvVar
    return entry
  }
  const entry: CodexMcpEntry = { command: spec.command, args: spec.args }
  if (Object.keys(spec.env).length > 0) entry["env"] = { ...spec.env }
  return entry
}

/** Build the Codex `mcp_servers.<id>` table entry for a catalog server. */
export function buildCodexMcpEntry(server: McpServer, key: string | undefined): CodexMcpEntry {
  return buildCodexMcpEntryFromSpec(resolveCatalogSpec(server, key))
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

/**
 * Remove one `mcp_servers.<id>` table from config.toml text. Inverse of
 * `mergeCodexMcp`; leaves the rest of the file intact and is a no-op when the
 * id (or the table) is absent.
 */
export function deleteCodexMcpEntry(existingToml: string, id: string): string {
  if (!existingToml.trim()) return existingToml
  const data = parse(existingToml) as Record<string, unknown>
  const servers = data["mcp_servers"] as Record<string, unknown> | undefined
  if (servers && id in servers) {
    delete servers[id]
    data["mcp_servers"] = servers
  }
  return stringify(data)
}

// ---------------------------------------------------------------------------
// OpenCode — `mcp.<id>` object in opencode.json
// ---------------------------------------------------------------------------

/** A single `mcp.<id>` object value for OpenCode's opencode.json. */
export type OpencodeMcpEntry = Record<string, unknown>

/**
 * Build the OpenCode `mcp.<id>` entry from a resolved spec. NOTE the OpenCode
 * shape deliberately differs from Codex: the top-level key is `mcp`; `type` is
 * `"local"` (stdio) / `"remote"` (http) with `enabled: true`; `command` is a
 * single array `[command, ...args]`; the env key is `environment` (not `env`);
 * and http uses inline `headers` (like Claude).
 */
export function buildOpencodeMcpEntryFromSpec(spec: McpSpec): OpencodeMcpEntry {
  if (spec.transport === "http") {
    const entry: OpencodeMcpEntry = { type: "remote", url: spec.url, enabled: true }
    if (Object.keys(spec.headers).length > 0) entry["headers"] = { ...spec.headers }
    return entry
  }
  const entry: OpencodeMcpEntry = {
    type: "local",
    command: [spec.command, ...spec.args],
    enabled: true,
  }
  if (Object.keys(spec.env).length > 0) entry["environment"] = { ...spec.env }
  return entry
}

/** Build the OpenCode `mcp.<id>` entry for a catalog server. */
export function buildOpencodeMcpEntry(
  server: McpServer,
  key: string | undefined
): OpencodeMcpEntry {
  return buildOpencodeMcpEntryFromSpec(resolveCatalogSpec(server, key))
}

/**
 * Parse a JSON object text, throwing (rather than silently rebuilding from `{}`)
 * on malformed input so a corrupt opencode.json is never clobbered — mirrors the
 * skill-config merges. An empty / whitespace-only file is treated as `{}`.
 */
function parseObject(json: string): Record<string, unknown> {
  if (!json.trim()) return {}
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error("opencode.json is not valid JSON; fix it before changing MCP config")
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("opencode.json is not a JSON object; fix it before changing MCP config")
  }
  return data as Record<string, unknown>
}

/**
 * Merge one MCP entry into an existing opencode.json text, returning new JSON.
 * Idempotent: re-merging the same id overwrites that entry only, leaving the
 * rest of the file's `mcp` object (and everything else) intact.
 */
export function mergeOpencodeMcp(
  existingJson: string,
  id: string,
  entry: OpencodeMcpEntry
): string {
  const data = parseObject(existingJson)
  const mcp =
    typeof data["mcp"] === "object" && data["mcp"] !== null && !Array.isArray(data["mcp"])
      ? { ...(data["mcp"] as Record<string, unknown>) }
      : {}
  mcp[id] = entry
  data["mcp"] = mcp
  return JSON.stringify(data, null, 2) + "\n"
}

/**
 * Remove one `mcp.<id>` entry from opencode.json text. Inverse of
 * `mergeOpencodeMcp`; prunes an emptied `mcp` object so the file stays as the
 * user wrote it, and is a no-op when the id (or `mcp`) is absent.
 */
export function deleteOpencodeMcpEntry(existingJson: string, id: string): string {
  if (!existingJson.trim()) return existingJson
  const data = parseObject(existingJson)
  const mcp =
    typeof data["mcp"] === "object" && data["mcp"] !== null && !Array.isArray(data["mcp"])
      ? { ...(data["mcp"] as Record<string, unknown>) }
      : {}
  if (id in mcp) delete mcp[id]
  if (Object.keys(mcp).length > 0) {
    data["mcp"] = mcp
  } else {
    delete data["mcp"]
  }
  return JSON.stringify(data, null, 2) + "\n"
}

// ---------------------------------------------------------------------------
// Reverse parsers — read one on-disk entry back into an `McpSpec` (edit prefill)
// ---------------------------------------------------------------------------
//
// All are defensive (used in UI reads): malformed / missing input yields
// `undefined`, never throws. Each inverts its corresponding writer above.

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asStringMap(value: unknown): Record<string, string> {
  const rec = asRecord(value)
  if (!rec) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(rec)) if (typeof v === "string") out[k] = v
  return out
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []
}

/**
 * Read a loose "standard" MCP entry record (the Claude / Cursor / VS Code
 * `mcpServers.<id>` shape: `{ command, args, env }` or `{ url, headers }`) into an
 * `McpSpec`. Shared by `parseClaudeMcpEntry` and the paste-importer so both agree
 * on how a pasted `mcpServers` block maps to the normalized shape. Returns
 * `undefined` when the record is neither stdio nor http.
 */
export function specFromClaudeRecord(rec: Record<string, unknown>): McpSpec | undefined {
  if (typeof rec["url"] === "string") {
    return { transport: "http", url: rec["url"], headers: asStringMap(rec["headers"]) }
  }
  if (typeof rec["command"] === "string") {
    return {
      transport: "stdio",
      command: rec["command"],
      args: asStringArray(rec["args"]),
      env: asStringMap(rec["env"]),
    }
  }
  return undefined
}

/** Read a Claude `~/.claude.json` `mcpServers.<id>` entry into an `McpSpec`. */
export function parseClaudeMcpEntry(json: string, id: string): McpSpec | undefined {
  let data: Record<string, unknown> | undefined
  try {
    data = asRecord(JSON.parse(json))
  } catch {
    return undefined
  }
  const rec = asRecord(asRecord(data?.["mcpServers"])?.[id])
  return rec ? specFromClaudeRecord(rec) : undefined
}

/** Read a Codex `config.toml` `mcp_servers.<id>` entry into an `McpSpec`. */
export function parseCodexMcpEntry(toml: string, id: string): McpSpec | undefined {
  let data: Record<string, unknown> | undefined
  try {
    data = toml.trim() ? (parse(toml) as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
  const entry = asRecord(data?.["mcp_servers"])?.[id]
  const rec = asRecord(entry)
  if (!rec) return undefined
  if (typeof rec["command"] === "string") {
    return {
      transport: "stdio",
      command: rec["command"],
      args: asStringArray(rec["args"]),
      env: asStringMap(rec["env"]),
    }
  }
  if (typeof rec["url"] === "string") {
    return {
      transport: "http",
      url: rec["url"],
      headers: {},
      bearerTokenEnvVar:
        typeof rec["bearer_token_env_var"] === "string" ? rec["bearer_token_env_var"] : undefined,
    }
  }
  return undefined
}

/**
 * Read a loose OpenCode `mcp.<id>` entry record (`{ type, command: [...],
 * environment }` / `{ type: "remote", url, headers }`) into an `McpSpec`. Shared
 * by `parseOpencodeMcpEntry` and the paste-importer so an `mcp` block pasted from
 * an opencode.json maps the same way. Returns `undefined` when it's neither.
 */
export function specFromOpencodeRecord(entry: Record<string, unknown>): McpSpec | undefined {
  if (entry["type"] === "remote" || typeof entry["url"] === "string") {
    return {
      transport: "http",
      url: typeof entry["url"] === "string" ? entry["url"] : "",
      headers: asStringMap(entry["headers"]),
    }
  }
  const command = asStringArray(entry["command"])
  if (command.length === 0) return undefined
  return {
    transport: "stdio",
    command: command[0],
    args: command.slice(1),
    env: asStringMap(entry["environment"]),
  }
}

/** Read an OpenCode `opencode.json` `mcp.<id>` entry into an `McpSpec`. */
export function parseOpencodeMcpEntry(json: string, id: string): McpSpec | undefined {
  let data: Record<string, unknown> | undefined
  try {
    data = asRecord(JSON.parse(json))
  } catch {
    return undefined
  }
  const entry = asRecord(asRecord(data?.["mcp"])?.[id])
  return entry ? specFromOpencodeRecord(entry) : undefined
}
