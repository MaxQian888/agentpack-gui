import { normalizeNoProxy, normalizeProxyUrl } from "./proxy"

/**
 * Auto-discovery of the proxy this machine is already using. Pure merge/rank
 * logic over four snapshots, with every side effect injected (mirrors
 * `lib/agentpack/mcp-health.ts`) so the whole thing unit-tests offline:
 *
 *  1. `env`    — the proxy variables agentpack's own process inherited.
 *  2. `system` — the OS proxy panel (scutil / Internet Settings / gsettings).
 *  3. `npm` / `git` — what the user configured into those tools earlier.
 *  4. `port`   — a localhost TCP probe of the ports the common proxy apps use.
 *
 * The port sweep is what makes this useful in practice: a Clash / Surge user
 * typically has no proxy env var and no OS panel entry at all, just a listener
 * on 127.0.0.1.
 */

/** Proxy env vars visible to the agentpack process (mirrors Rust `ProxyEnvSnapshot`). */
export interface ProxyEnvSnapshot {
  httpProxy: string | null
  httpsProxy: string | null
  allProxy: string | null
  noProxy: string | null
}

/** One proxy endpoint the OS advertises. */
export interface SystemProxyEntry {
  scheme: "http" | "https" | "socks"
  host: string
  port: number
}

/** The OS proxy panel's state (mirrors Rust `SystemProxySnapshot`). */
export interface SystemProxySnapshot {
  entries: SystemProxyEntry[]
  /** PAC script URL, if the machine uses automatic configuration. */
  pacUrl: string | null
  /** Hosts the OS excludes from proxying. */
  bypass: string[]
}

/** Proxy-related config already set in npm / git (mirrors Rust `ToolProxySnapshot`). */
export interface ToolProxySnapshot {
  npmProxy: string | null
  npmHttpsProxy: string | null
  npmNoProxy: string | null
  npmRegistry: string | null
  gitHttpProxy: string | null
  gitHttpsProxy: string | null
}

export type ProxySource = "env" | "system" | "npm" | "git" | "port"

/** One discovered proxy the user can adopt with a click. */
export interface ProxyCandidate {
  /** Stable key (`source:detail`), also the React list key. */
  id: string
  /** Highest-priority source this URL was found in. */
  source: ProxySource
  /** Canonical proxy URL. */
  url: string
  /** Where exactly it came from: env var name, app name, or config key. */
  detail: string
  /** True when a TCP connect to the endpoint succeeded (port sweep only). */
  reachable?: boolean
}

/**
 * Local ports the popular proxy clients listen on. Probed in parallel against
 * 127.0.0.1 only — nothing leaves the machine. `scheme` marks the SOCKS-only
 * ports so the UI can route them to ALL_PROXY instead of HTTP(S)_PROXY.
 */
export const WELL_KNOWN_PROXY_PORTS: readonly {
  port: number
  app: string
  scheme: "http" | "socks5"
}[] = [
  { port: 7890, app: "Clash / Clash for Windows", scheme: "http" },
  { port: 7897, app: "Clash Verge / Mihomo Party", scheme: "http" },
  { port: 33210, app: "Clash Verge Rev", scheme: "http" },
  { port: 1087, app: "ClashX / Shadowsocks", scheme: "http" },
  { port: 6152, app: "Surge", scheme: "http" },
  { port: 8889, app: "Surge (alt)", scheme: "http" },
  { port: 10809, app: "v2rayN", scheme: "http" },
  { port: 20171, app: "Quantumult X / sing-box", scheme: "http" },
  { port: 3128, app: "Squid", scheme: "http" },
  { port: 8080, app: "HTTP proxy", scheme: "http" },
  { port: 8888, app: "Charles / Fiddler", scheme: "http" },
  { port: 1080, app: "SOCKS5", scheme: "socks5" },
]

/**
 * Endpoints a connectivity test aims at: the API the agents talk to, the
 * registry their installs come from, and the host skills are downloaded from —
 * i.e. the three things that actually break on a restricted network.
 */
export const PROXY_TEST_URLS: readonly { id: string; url: string }[] = [
  { id: "anthropic", url: "https://api.anthropic.com/v1/models" },
  { id: "npm", url: "https://registry.npmjs.org/" },
  { id: "github", url: "https://codeload.github.com/" },
]

/** Side effects discovery needs, injected so the merge logic stays pure. */
export interface DiscoveryProbes {
  envSnapshot: () => Promise<ProxyEnvSnapshot>
  systemSnapshot: () => Promise<SystemProxySnapshot>
  toolSnapshot: () => Promise<ToolProxySnapshot>
  /** Whether something listens on 127.0.0.1:port. */
  probePort: (port: number) => Promise<boolean>
}

export interface DiscoveryResult {
  candidates: ProxyCandidate[]
  /**
   * PAC URL the OS advertises. agentpack can't evaluate a PAC script, so this is
   * surfaced as a note ("your machine uses automatic configuration") rather than
   * an adoptable candidate.
   */
  pacUrl: string | null
  /** Best-guess bypass list, so adopting a candidate can fill NO_PROXY too. */
  noProxy: string | null
}

/** Lower rank wins when the same URL shows up in several places. */
const RANK: Record<ProxySource, number> = { env: 0, system: 1, npm: 2, git: 3, port: 4 }

function candidate(
  source: ProxySource,
  detail: string,
  raw: string | null | undefined,
  reachable?: boolean
): ProxyCandidate | null {
  const parsed = normalizeProxyUrl(raw)
  if (!parsed) return null
  return {
    id: `${source}:${detail}`,
    source,
    url: parsed.url,
    detail,
    ...(reachable !== undefined && { reachable }),
  }
}

export function candidatesFromEnv(snap: ProxyEnvSnapshot): ProxyCandidate[] {
  return [
    candidate("env", "HTTPS_PROXY", snap.httpsProxy),
    candidate("env", "HTTP_PROXY", snap.httpProxy),
    candidate("env", "ALL_PROXY", snap.allProxy),
  ].filter((c): c is ProxyCandidate => !!c)
}

export function candidatesFromSystem(snap: SystemProxySnapshot): ProxyCandidate[] {
  return snap.entries
    .map((e) => {
      const scheme = e.scheme === "socks" ? "socks5" : e.scheme
      return candidate("system", e.scheme, `${scheme}://${e.host}:${e.port}`)
    })
    .filter((c): c is ProxyCandidate => !!c)
}

export function candidatesFromTools(snap: ToolProxySnapshot): ProxyCandidate[] {
  return [
    candidate("npm", "https-proxy", snap.npmHttpsProxy),
    candidate("npm", "proxy", snap.npmProxy),
    candidate("git", "http.proxy", snap.gitHttpProxy),
    candidate("git", "https.proxy", snap.gitHttpsProxy),
  ].filter((c): c is ProxyCandidate => !!c)
}

/** Turn the reachable results of the port sweep into candidates. */
export function candidatesFromPorts(open: readonly number[]): ProxyCandidate[] {
  const openSet = new Set(open)
  return WELL_KNOWN_PROXY_PORTS.filter((p) => openSet.has(p.port))
    .map((p) => candidate("port", p.app, `${p.scheme}://127.0.0.1:${p.port}`, true))
    .filter((c): c is ProxyCandidate => !!c)
}

/**
 * Collapse duplicates by URL, keeping the highest-priority source and appending
 * the other places it was seen to `detail` (so a Clash user sees
 * "HTTPS_PROXY · Clash / Clash for Windows" on one row instead of two rows).
 */
export function dedupeCandidates(list: readonly ProxyCandidate[]): ProxyCandidate[] {
  const byUrl = new Map<string, ProxyCandidate>()
  for (const c of [...list].sort((a, b) => RANK[a.source] - RANK[b.source])) {
    const seen = byUrl.get(c.url)
    if (!seen) {
      byUrl.set(c.url, { ...c })
      continue
    }
    if (!seen.detail.split(" · ").includes(c.detail)) seen.detail = `${seen.detail} · ${c.detail}`
    if (c.reachable) seen.reachable = true
  }
  return [...byUrl.values()]
}

/**
 * Run every discovery source and return ranked, deduplicated candidates. A
 * failing source (no `scutil`, no npm on PATH, an IPC error) contributes nothing
 * instead of failing the whole scan.
 */
export async function discoverProxies(probes: DiscoveryProbes): Promise<DiscoveryResult> {
  const emptyEnv: ProxyEnvSnapshot = {
    httpProxy: null,
    httpsProxy: null,
    allProxy: null,
    noProxy: null,
  }
  const emptySystem: SystemProxySnapshot = { entries: [], pacUrl: null, bypass: [] }
  const emptyTools: ToolProxySnapshot = {
    npmProxy: null,
    npmHttpsProxy: null,
    npmNoProxy: null,
    npmRegistry: null,
    gitHttpProxy: null,
    gitHttpsProxy: null,
  }
  const [env, system, tools, openPorts] = await Promise.all([
    probes.envSnapshot().catch(() => emptyEnv),
    probes.systemSnapshot().catch(() => emptySystem),
    probes.toolSnapshot().catch(() => emptyTools),
    Promise.all(
      WELL_KNOWN_PROXY_PORTS.map((p) =>
        probes
          .probePort(p.port)
          .then((open) => (open ? p.port : null))
          .catch(() => null)
      )
    ),
  ])

  const candidates = dedupeCandidates([
    ...candidatesFromEnv(env),
    ...candidatesFromSystem(system),
    ...candidatesFromTools(tools),
    ...candidatesFromPorts(openPorts.filter((p): p is number => p !== null)),
  ])

  const noProxy =
    normalizeNoProxy(env.noProxy) ??
    normalizeNoProxy(system.bypass.join(",")) ??
    normalizeNoProxy(tools.npmNoProxy) ??
    null

  return { candidates, pacUrl: system.pacUrl, noProxy }
}
