import type { ProxyConfig, ProxyTarget } from "../types"

/**
 * Pure proxy logic: parse/normalize proxy URLs, resolve a `ProxyConfig` into the
 * concrete environment variables each surface needs, and render the shell export
 * block. No IPC and no Tauri import, so all of it unit-tests directly.
 *
 * The env var names are the ones the agent CLIs actually document:
 *  - `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` — read by Claude Code (which
 *    documents NO SOCKS support), Codex and OpenCode.
 *  - `ALL_PROXY` — the SOCKS catch-all npm/git/curl honor; written only when the
 *    user fills it in, and flagged in the UI as invisible to Claude Code.
 *  - `NODE_EXTRA_CA_CERTS` / `NODE_TLS_REJECT_UNAUTHORIZED` and the
 *    `CLAUDE_CODE_CLIENT_*` mTLS trio — the TLS-inspection / client-certificate
 *    cases enterprise networks need.
 */

/** Proxy URL schemes we accept. Anything else is rejected as unparseable. */
const SCHEMES = ["http", "https", "socks", "socks4", "socks5", "socks5h"] as const

export type ProxyScheme = (typeof SCHEMES)[number]

/** A proxy URL broken into its parts, with a canonical string form. */
export interface ParsedProxy {
  /** Canonical `scheme://[user:pass@]host[:port]` — no path, no trailing slash. */
  url: string
  scheme: ProxyScheme
  /** Hostname without brackets (`::1`, not `[::1]`). */
  host: string
  port: number
  /** True when the URL already carries basic-auth credentials. */
  hasAuth: boolean
}

const DEFAULT_PORTS: Record<ProxyScheme, number> = {
  http: 80,
  https: 443,
  socks: 1080,
  socks4: 1080,
  socks5: 1080,
  socks5h: 1080,
}

/** A fresh, inert proxy config. `shell` is opt-in: it edits the user's shell rc. */
export const DEFAULT_PROXY: ProxyConfig = {
  mode: "off",
  targets: ["claude", "npm", "git"],
}

/**
 * Parse a user-typed proxy value. A bare `host:port` (what proxy apps show in
 * their UI) is accepted and assumed to be http. Returns null for anything that
 * isn't a usable proxy endpoint, so callers can treat "invalid" and "empty" alike.
 */
export function normalizeProxyUrl(raw: string | undefined | null): ParsedProxy | null {
  const text = (raw ?? "").trim()
  if (!text) return null
  const withScheme = /^[a-z0-9+.-]+:\/\//i.test(text) ? text : `http://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase() as ProxyScheme
  if (!SCHEMES.includes(scheme)) return null
  if (!url.hostname) return null
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[scheme]
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  const hasAuth = !!url.username
  // `url.host` keeps IPv6 brackets and drops a redundant default port; `host`
  // strips the brackets so it can be handed to a TCP connect as-is.
  const auth = hasAuth ? `${url.username}${url.password ? `:${url.password}` : ""}@` : ""
  return {
    url: `${scheme}://${auth}${url.host}`,
    scheme,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    hasAuth,
  }
}

/**
 * Inject basic-auth credentials into a proxy URL. A URL that already carries
 * credentials is left alone (an explicit URL beats the separate fields). The
 * WHATWG setters percent-encode the userinfo, so `p@ss` survives the round trip.
 */
export function withCredentials(url: string, username?: string, password?: string): string {
  const user = (username ?? "").trim()
  if (!user) return url
  const parsed = normalizeProxyUrl(url)
  if (!parsed || parsed.hasAuth) return parsed?.url ?? url
  const u = new URL(parsed.url)
  u.username = user
  if (password) u.password = password
  return `${u.protocol}//${u.username}${u.password ? `:${u.password}` : ""}@${u.host}`
}

/** Normalize a bypass list to the comma-separated form npm's `noproxy` expects. */
export function normalizeNoProxy(raw: string | undefined | null): string | undefined {
  const parts = (raw ?? "")
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.length ? parts.join(",") : undefined
}

/** The proxy URLs a config resolves to, credentials applied and cross-filled. */
export interface EffectiveProxy {
  http?: string
  https?: string
  all?: string
  noProxy?: string
}

/**
 * Resolve a config into the URLs to write. `https` falls back to the http entry
 * and vice versa, because a single-box proxy is by far the common case and both
 * CLIs and npm need each variable spelled out.
 *
 * `mode: "system"` resolves exactly like `manual` — picking it makes the UI
 * re-fill the fields from what discovery found on this machine, and the concrete
 * values are then written like any other, so the CLIs (which never read the OS
 * proxy panel themselves) actually see them.
 */
export function effectiveProxy(cfg: ProxyConfig | undefined): EffectiveProxy {
  if (!cfg || cfg.mode === "off") return {}
  const http = normalizeProxyUrl(cfg.httpUrl)
  const https = normalizeProxyUrl(cfg.httpsUrl)
  const all = normalizeProxyUrl(cfg.allUrl)
  const cred = (p: ParsedProxy | null) =>
    p ? withCredentials(p.url, cfg.username, cfg.password) : undefined
  const out: EffectiveProxy = {}
  const httpUrl = cred(http) ?? cred(https)
  const httpsUrl = cred(https) ?? cred(http)
  if (httpUrl) out.http = httpUrl
  if (httpsUrl) out.https = httpsUrl
  const allUrl = cred(all)
  if (allUrl) out.all = allUrl
  const noProxy = normalizeNoProxy(cfg.noProxy)
  if (noProxy) out.noProxy = noProxy
  return out
}

/** Whether this config would actually write anything. */
export function isProxyActive(cfg: ProxyConfig | undefined): boolean {
  if (!cfg || cfg.mode === "off") return false
  const eff = effectiveProxy(cfg)
  return !!(eff.http || eff.https || eff.all)
}

/**
 * Every env key agentpack may write for a proxy — the exact set the "clear"
 * path removes again, so no stale key can survive a round trip.
 */
export const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "CLAUDE_CODE_CLIENT_CERT",
  "CLAUDE_CODE_CLIENT_KEY",
  "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
] as const

/** The env vars to write for this config ({} when it's off or empty). */
export function proxyEnvVars(cfg: ProxyConfig | undefined): Record<string, string> {
  if (!cfg || cfg.mode === "off") return {}
  const eff = effectiveProxy(cfg)
  const out: Record<string, string> = {}
  if (eff.http) out["HTTP_PROXY"] = eff.http
  if (eff.https) out["HTTPS_PROXY"] = eff.https
  if (eff.all) out["ALL_PROXY"] = eff.all
  if (eff.noProxy) out["NO_PROXY"] = eff.noProxy
  const ca = cfg.caCertPath?.trim()
  if (ca) out["NODE_EXTRA_CA_CERTS"] = ca
  if (cfg.insecureTls) out["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
  const cert = cfg.clientCertPath?.trim()
  const key = cfg.clientKeyPath?.trim()
  if (cert) out["CLAUDE_CODE_CLIENT_CERT"] = cert
  if (key) out["CLAUDE_CODE_CLIENT_KEY"] = key
  const passphrase = cfg.clientKeyPassphrase
  if (cert && key && passphrase) out["CLAUDE_CODE_CLIENT_KEY_PASSPHRASE"] = passphrase
  return out
}

/**
 * True when a SOCKS proxy is configured for a target that can't use it. Claude
 * Code documents no SOCKS support, so writing `ALL_PROXY` into its settings is
 * harmless but misleading — the UI says so instead of pretending it works.
 */
export function socksUnsupported(cfg: ProxyConfig | undefined): boolean {
  if (!cfg || cfg.mode === "off") return false
  if (!cfg.targets.includes("claude")) return false
  const all = normalizeProxyUrl(cfg.allUrl)
  const others = [cfg.httpUrl, cfg.httpsUrl].map(normalizeProxyUrl).filter(Boolean)
  return !!all && all.scheme.startsWith("socks") && others.length === 0
}

/** Shell dialect of a profile file, which decides the export syntax. */
export type ShellFlavor = "posix" | "fish"

/** fish needs `set -gx`; everything else takes `export`. */
export function shellFlavor(profilePath: string): ShellFlavor {
  return /\.fish$/i.test(profilePath) ? "fish" : "posix"
}

/**
 * The export lines for a shell profile (also what the "copy" button hands to a
 * Codex / OpenCode user). Proxy variables are emitted in both cases: plenty of
 * tools (curl, some Python stacks) read only the lowercase spelling.
 */
export function shellExportLines(
  cfg: ProxyConfig | undefined,
  flavor: ShellFlavor = "posix"
): string[] {
  const vars = proxyEnvVars(cfg)
  const line = (k: string, v: string) =>
    flavor === "fish" ? `set -gx ${k} ${JSON.stringify(v)}` : `export ${k}=${JSON.stringify(v)}`
  const lowerCased = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"])
  const out: string[] = []
  for (const [k, v] of Object.entries(vars)) {
    out.push(line(k, v))
    if (lowerCased.has(k)) out.push(line(k.toLowerCase(), v))
  }
  return out
}

/** Whether a target is selected (an absent/empty list means nothing is written). */
export function hasTarget(cfg: ProxyConfig | undefined, target: ProxyTarget): boolean {
  return !!cfg && cfg.targets.includes(target)
}
