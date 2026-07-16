import { specFromClaudeRecord, specFromOpencodeRecord, type McpSpec } from "./merge/mcp"

/**
 * Parse pasted MCP config into normalized `{ id, spec }` servers, so a user can
 * import a server without hand-filling the custom form. Three input shapes are
 * accepted (what other MCP managers let you paste):
 *   1. a JSON `mcpServers` / `mcp` map (multiple servers),
 *   2. a single-server JSON object (`{command,args,env}` | `{url,headers}` | the
 *      OpenCode `{type,command:[…]}` shape),
 *   3. a `claude mcp add …` command line.
 * Pure — no Tauri, fully unit-tested. Errors are returned as codes the UI localizes.
 */

export interface ImportedServer {
  id: string
  spec: McpSpec
}

export type ImportErrorCode = "empty" | "parse" | "unsupported"
export type ImportResult = { servers: ImportedServer[] } | { error: ImportErrorCode }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Standard shape first, OpenCode shape as fallback — covers every paste source. */
function specFromLoose(rec: Record<string, unknown>): McpSpec | undefined {
  return specFromClaudeRecord(rec) ?? specFromOpencodeRecord(rec)
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

/** Best-effort id for a single-server paste that carries no id of its own. */
function deriveId(spec: McpSpec): string {
  if (spec.transport === "http") {
    try {
      const first = new URL(spec.url).hostname.split(".")[0]
      const s = slugify(first)
      if (s) return s
    } catch {
      // fall through
    }
    return "mcp-server"
  }
  const pkg = [...spec.args].reverse().find((a) => a && !a.startsWith("-"))
  const base = (pkg ?? spec.command).split("/").pop() ?? "mcp-server"
  return slugify(base.replace(/^@/, "").replace(/^server-/, "")) || "mcp-server"
}

/** Collect servers from a JSON map of id → entry. */
function fromMap(map: Record<string, unknown>): ImportedServer[] {
  const out: ImportedServer[] = []
  for (const [id, value] of Object.entries(map)) {
    if (!isRecord(value)) continue
    const spec = specFromLoose(value)
    if (spec) out.push({ id, spec })
  }
  return out
}

function fromJson(text: string): ImportResult | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(data)) return { error: "unsupported" }

  if (isRecord(data["mcpServers"])) {
    const servers = fromMap(data["mcpServers"])
    return servers.length ? { servers } : { error: "unsupported" }
  }
  if (isRecord(data["mcp"])) {
    const servers = fromMap(data["mcp"])
    return servers.length ? { servers } : { error: "unsupported" }
  }
  // A single server object: it carries the connection keys at the top level.
  if ("command" in data || "url" in data) {
    const spec = specFromLoose(data)
    return spec ? { servers: [{ id: deriveId(spec), spec }] } : { error: "unsupported" }
  }
  // Otherwise treat it as a bare id → entry map (every value an object).
  const values = Object.values(data)
  if (values.length > 0 && values.every(isRecord)) {
    const servers = fromMap(data)
    return servers.length ? { servers } : { error: "unsupported" }
  }
  return { error: "unsupported" }
}

/** Split a command line into tokens, honoring single / double quotes. */
function tokenize(input: string): string[] {
  const out: string[] = []
  let cur = ""
  let quote: string | null = null
  let started = false
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (started) {
        out.push(cur)
        cur = ""
        started = false
      }
      continue
    }
    cur += ch
    started = true
  }
  if (started) out.push(cur)
  return out
}

/**
 * Parse a `claude mcp add …` command line. Handles the two official forms:
 *   `claude mcp add --transport http <id> <url> [--header "K: V"]…`
 *   `claude mcp add <id> [--scope user] [--env K=V]… -- <command> <args…>`
 * Returns null when the text isn't a recognizable `… mcp add …` command.
 */
function fromCommand(text: string): ImportResult | null {
  const tokens = tokenize(text)
  const mcpIdx = tokens.indexOf("mcp")
  const addIdx = mcpIdx >= 0 ? tokens.indexOf("add", mcpIdx + 1) : -1
  if (addIdx < 0) return null
  const rest = tokens.slice(addIdx + 1)

  let transport: "stdio" | "http" = "stdio"
  const env: Record<string, string> = {}
  const headers: Record<string, string> = {}
  let id: string | undefined
  let url: string | undefined
  let command: string | undefined
  let args: string[] = []
  let positional = 0

  // claude's own flags (--transport / --scope / --env / --header) precede the
  // id and the command. Once the stdio command positional (or a `--`) is reached,
  // everything after is captured verbatim so its own flags (e.g. `-y`) survive.
  for (let i = 0; i < rest.length; i++) {
    const tk = rest[i]
    if (tk === "--") {
      const parts = rest.slice(i + 1)
      command = parts[0]
      args = parts.slice(1)
      break
    }
    if (tk === "--transport" || tk === "-t") {
      const v = rest[++i]
      if (v === "http" || v === "sse") transport = "http"
      continue
    }
    if (tk === "--scope" || tk === "-s") {
      i++
      continue
    }
    if (tk === "--env" || tk === "-e") {
      const kv = rest[++i] ?? ""
      const eq = kv.indexOf("=")
      if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1)
      continue
    }
    if (tk === "--header" || tk === "-H") {
      const hv = rest[++i] ?? ""
      const c = hv.indexOf(":")
      if (c > 0) headers[hv.slice(0, c).trim()] = hv.slice(c + 1).trim()
      continue
    }
    positional++
    if (positional === 1) {
      id = tk
      continue
    }
    if (transport === "http") {
      if (positional === 2) url = tk
      continue
    }
    // stdio: the second positional is the command; the rest are its args verbatim.
    command = tk
    args = rest.slice(i + 1)
    break
  }

  if (!id) return { error: "parse" }
  if (transport === "http") {
    if (!url) return { error: "parse" }
    return { servers: [{ id, spec: { transport: "http", url, headers } }] }
  }
  if (!command) return { error: "parse" }
  return { servers: [{ id, spec: { transport: "stdio", command, args, env } }] }
}

/** Parse pasted text into importable servers, or an error code. */
export function parseMcpImport(text: string): ImportResult {
  const trimmed = text.trim()
  if (!trimmed) return { error: "empty" }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return fromJson(trimmed) ?? { error: "parse" }
  }
  const cmd = fromCommand(trimmed)
  if (cmd) return cmd
  return fromJson(trimmed) ?? { error: "parse" }
}
