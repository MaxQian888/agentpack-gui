import { PROXY_ENV_KEYS, proxyEnvVars, shellExportLines, type ShellFlavor } from "../network/proxy"
import type { Command, ProxyConfig } from "../types"

/** `npm config set registry <url>` */
export function npmRegistryCommand(url: string): Command {
  return { file: "npm", args: ["config", "set", "registry", url] }
}

/**
 * Apply env-var changes to a Claude Code settings.json text. Claude reads its
 * `env` block on every session, which is where the proxy/TLS variables live
 * (the relay credentials are owned by the provider list — see
 * `ccswitch/sync.ts`). A `null` value removes the key; everything else in the
 * file is preserved verbatim.
 */
export function mergeClaudeEnv(existingJson: string, vars: Record<string, string | null>): string {
  const data = (existingJson.trim() ? JSON.parse(existingJson) : {}) as Record<string, unknown>
  const env = (data["env"] as Record<string, string>) ?? {}
  for (const [key, value] of Object.entries(vars)) {
    if (value === null) delete env[key]
    else env[key] = value
  }
  data["env"] = env
  return JSON.stringify(data, null, 2) + "\n"
}

// ── Proxy ────────────────────────────────────────────────────────────────────

/** Write the proxy / TLS variables into Claude Code's `env` block. */
export function mergeClaudeProxy(existingJson: string, cfg: ProxyConfig): string {
  return mergeClaudeEnv(existingJson, proxyEnvVars(cfg))
}

/** Remove every proxy / TLS variable agentpack may have written. */
export function deleteClaudeProxy(existingJson: string): string {
  if (!existingJson.trim()) return existingJson
  return mergeClaudeEnv(
    existingJson,
    Object.fromEntries(PROXY_ENV_KEYS.map((k) => [k, null] as const))
  )
}

/**
 * npm's proxy keys. npm has no ALL_PROXY equivalent, so a SOCKS-only setup
 * yields no npm commands (the UI warns about that separately).
 */
export function npmProxyCommands(cfg: ProxyConfig): Command[] {
  const vars = proxyEnvVars(cfg)
  const out: Command[] = []
  const set = (key: string, value: string) =>
    out.push({ file: "npm", args: ["config", "set", key, value] })
  if (vars["HTTP_PROXY"]) set("proxy", vars["HTTP_PROXY"])
  if (vars["HTTPS_PROXY"]) set("https-proxy", vars["HTTPS_PROXY"])
  if (vars["NO_PROXY"]) set("noproxy", vars["NO_PROXY"])
  return out
}

/** Inverse of `npmProxyCommands` — always all three, so no stale key survives. */
export function npmProxyClearCommands(): Command[] {
  return ["proxy", "https-proxy", "noproxy"].map((key) => ({
    file: "npm",
    args: ["config", "delete", key],
  }))
}

/** git's global proxy keys (git has no bypass-list equivalent). */
export function gitProxyCommands(cfg: ProxyConfig): Command[] {
  const vars = proxyEnvVars(cfg)
  const out: Command[] = []
  const set = (key: string, value: string) =>
    out.push({ file: "git", args: ["config", "--global", key, value] })
  if (vars["HTTP_PROXY"]) set("http.proxy", vars["HTTP_PROXY"])
  if (vars["HTTPS_PROXY"]) set("https.proxy", vars["HTTPS_PROXY"])
  return out
}

/**
 * Inverse of `gitProxyCommands`. `--unset` exits 5 when the key isn't there, so
 * these run as verify-only steps (a missing key is nothing to report).
 */
export function gitProxyClearCommands(): Command[] {
  return ["http.proxy", "https.proxy"].map((key) => ({
    file: "git",
    args: ["config", "--global", "--unset", key],
  }))
}

/** Fences around the export block agentpack owns inside the user's shell rc. */
export const SHELL_BLOCK_START = "# >>> agentpack proxy >>>"
export const SHELL_BLOCK_END = "# <<< agentpack proxy <<<"

const BLOCK_RE = new RegExp(`\\n*${SHELL_BLOCK_START}[\\s\\S]*?${SHELL_BLOCK_END}\\n?`, "g")

/**
 * Replace (or append) agentpack's export block in a shell profile. Fenced with
 * markers so re-applying updates the block in place instead of stacking a new
 * copy on every run, and so `deleteShellProxyBlock` can lift out exactly what we
 * put there — everything the user wrote themselves is untouched.
 */
export function mergeShellProxyBlock(
  existing: string,
  cfg: ProxyConfig,
  flavor: ShellFlavor = "posix"
): string {
  const body = shellExportLines(cfg, flavor)
  const without = deleteShellProxyBlock(existing)
  if (body.length === 0) return without
  const block = [SHELL_BLOCK_START, ...body, SHELL_BLOCK_END].join("\n")
  return without.trim() ? `${without.replace(/\n+$/, "")}\n\n${block}\n` : `${block}\n`
}

/** Remove agentpack's export block, leaving the rest of the profile as it was. */
export function deleteShellProxyBlock(existing: string): string {
  if (!existing.includes(SHELL_BLOCK_START)) return existing
  const out = existing.replace(BLOCK_RE, "\n")
  return out.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n")
}

/**
 * Windows has no shell rc to edit, so the user-scope environment is set with
 * `setx` instead — persistent, and picked up by every terminal opened after.
 */
export function winProxyCommands(cfg: ProxyConfig): Command[] {
  return Object.entries(proxyEnvVars(cfg)).map(([key, value]) => ({
    file: "setx",
    args: [key, value],
  }))
}

/** Inverse of `winProxyCommands`: `setx KEY ""` clears a user-scope variable. */
export function winProxyClearCommands(): Command[] {
  return PROXY_ENV_KEYS.map((key) => ({ file: "setx", args: [key, ""] }))
}
