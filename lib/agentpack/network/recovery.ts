import type { Command, ProxyConfig } from "../types"
import { proxyEnvVars } from "./proxy"

/**
 * What to do when an install dies on the network.
 *
 * Two pure pieces, both unit-testable with no IPC:
 *  1. `classifyFailure` — was this a network problem at all? Only a `network`
 *     verdict may trigger a retry; a declined UAC prompt or a missing binary
 *     must keep behaving exactly as it does today.
 *  2. `remediesFor` — the ordered ladder of *rewritten commands* to try. Every
 *     remedy is a command-line flag or a per-spawn environment variable and
 *     NOTHING ELSE: no `npm config set`, no shell rc edit, no settings.json
 *     write. A retry must never leave a trace on the user's machine — if one
 *     works, the runner offers to make it permanent and the user decides.
 *
 * Fallbacks that aren't a rewrite of the same command (scoop instead of winget,
 * a GitHub Release instead of a package manager) are not modelled here. They ride
 * on the step itself as `CommandStep.fallbacks`, so they get dry-run preview and
 * step reporting for free.
 */

export type FailureClass = "network" | "permission" | "notFound" | "other"

/**
 * Substrings and codes that mean "the network let us down", collected per tool
 * because each surfaces failure in its own dialect.
 *
 * winget is matched on MESSAGE TEXT, not exit code, on purpose: its download
 * failures have moved between hex codes across releases, whereas the phrasing
 * ("Failed when downloading installer") has been stable. The two `0x8007…`
 * entries are WinINet's own, long-standing name-resolution / connect errors.
 */
const NETWORK_PATTERNS: readonly RegExp[] = [
  // ── npm / pnpm / node ──
  /\bETIMEDOUT\b/i,
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bENETUNREACH\b/i,
  /\bERR_SOCKET_TIMEOUT\b/i,
  /network request to .* failed/i,
  /request to https?:\/\/\S+ failed/i,
  /\bFETCH_ERROR\b/i,
  // ── winget ──
  /failed when downloading installer/i,
  /installer hash does not match/i,
  /0x80072ee7/i, // ERROR_INTERNET_NAME_NOT_RESOLVED
  /0x80072efd/i, // ERROR_INTERNET_CANNOT_CONNECT
  // ── curl (brew, the official install scripts) ──
  /curl:\s*\(\s*(6|7|28|35|56)\s*\)/i,
  /could not resolve host/i,
  /failed to (?:download|connect)/i,
  /operation timed out/i,
  // ── PowerShell / .NET ──
  /the remote name could not be resolved/i,
  /unable to connect to the remote server/i,
  /a connection with the server could not be established/i,
  // ── generic transport ──
  /connection (?:reset|refused|timed out)/i,
  /\btimed out\b/i,
  /network is unreachable/i,
  /proxy(?:.*)(?:refused|unreachable)/i,
  /\bTLS\b.*\b(?:handshake|failed)\b/i,
  /certificate (?:verify failed|has expired|is not valid)/i,
  /SSL (?:certificate|routines|error)/i,
]

/** Failures that are about rights, not reachability — retrying can't help. */
const PERMISSION_PATTERNS: readonly RegExp[] = [
  /access is denied/i,
  /\bEACCES\b/i,
  /\bEPERM\b/i,
  /permission denied/i,
  /requires? (?:elevation|administrator)/i,
  /operation not permitted/i,
]

/** The binary isn't there at all — the runner already has a dedicated hint. */
const NOT_FOUND_PATTERNS: readonly RegExp[] = [
  /command not found/i,
  /is not recognized as an internal or external command/i,
  /no such file or directory/i,
]

const matchesAny = (text: string, patterns: readonly RegExp[]) => patterns.some((p) => p.test(text))

/**
 * Decide what kind of failure this was from the command's own output.
 *
 * Ordered most-specific first: a missing binary and a rights problem both often
 * mention words that also appear in transport errors, and misreading either as
 * "network" would send the ladder off retrying something that cannot work.
 */
export function classifyFailure(
  output: readonly string[],
  exitCode: number | null = null
): FailureClass {
  const text = output.join("\n")
  if (matchesAny(text, NOT_FOUND_PATTERNS)) return "notFound"
  if (matchesAny(text, PERMISSION_PATTERNS)) return "permission"
  if (matchesAny(text, NETWORK_PATTERNS)) return "network"
  // Nothing recognisable in the output. An exit code alone is far too weak a
  // signal to start rewriting commands, so this stays "other" and fails plainly.
  void exitCode
  return "other"
}

/** The patterns behind each verdict, so nothing outside this file re-spells them. */
const PATTERNS_FOR: Partial<Record<FailureClass, readonly RegExp[]>> = {
  notFound: NOT_FOUND_PATTERNS,
  permission: PERMISSION_PATTERNS,
  network: NETWORK_PATTERNS,
}

/**
 * The output line that produced a verdict — what the tool actually said.
 *
 * Exact rather than approximate: none of the patterns above spans a newline
 * (`.` does not match one, and none contains `\n`), so a whole-text match is
 * always reproducible on a single line. `undefined` for `other`, which has no
 * patterns, and for the case a line search somehow can't reproduce — the
 * caller renders no quote rather than an invented one.
 */
export function failureEvidence(output: readonly string[], cls: FailureClass): string | undefined {
  const patterns = PATTERNS_FOR[cls]
  if (!patterns) return undefined
  return output.find((line) => matchesAny(line, patterns))?.trim() || undefined
}

/** How a working remedy could be made permanent, if the user opts in. */
export type PersistHint = { kind: "npmRegistry"; url: string } | { kind: "proxy"; url: string }

/** One rewritten attempt: same intent, different route. */
export interface Remedy {
  /** Stable id, also the React key and the telemetry-ish label in reports. */
  id: string
  /** What to show in the run log, e.g. `npmmirror` or `127.0.0.1:7890`. */
  label: string
  command: Command
  /** Extra environment for this spawn only. */
  env?: Record<string, string>
  persist?: PersistHint
}

/**
 * What the ladder is allowed to reach for, resolved from one `NetworkProbeResult`
 * so every remedy points at something already measured as reachable.
 */
export interface RecoveryContext {
  /** Fastest working proxy, or null when none was found (or none is needed). */
  proxyUrl: string | null
  /** Bypass list to pair with the proxy. */
  noProxy?: string
  /** Fastest working npm registry, or null to leave the registry alone. */
  npmRegistry: string | null
  /** Fastest working PyPI index, or null. */
  pypiIndex: string | null
  /** `HOMEBREW_API_DOMAIN` / `HOMEBREW_BOTTLE_DOMAIN` for the fastest brew mirror. */
  brewEnv?: Record<string, string>
}

/**
 * Proxy variables for one spawn. Emitted in both cases because the tools that
 * matter here disagree: curl and several Python stacks read only the lowercase
 * spelling, npm and git read either.
 *
 * A SOCKS proxy goes to `ALL_PROXY` only — that's the variable curl and git
 * honour for it, and writing a `socks5://` URL into `HTTPS_PROXY` would just
 * confuse the HTTP-only clients.
 */
function proxySpawnEnv(url: string, noProxy?: string): Record<string, string> {
  const socks = /^socks/i.test(url)
  const cfg: ProxyConfig = {
    mode: "manual",
    targets: [],
    ...(socks ? { allUrl: url } : { httpUrl: url, httpsUrl: url }),
    ...(noProxy ? { noProxy } : {}),
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(proxyEnvVars(cfg))) {
    out[key] = value
    out[key.toLowerCase()] = value
  }
  return out
}

/** npm verbs that actually fetch from a registry — the only ones a mirror helps. */
const NPM_FETCHING_VERBS = new Set(["install", "i", "add", "update", "up", "exec"])

const isNpmFamily = (cmd: Command) => cmd.file === "npm" || cmd.file === "pnpm"
const isNpxFamily = (cmd: Command) => cmd.file === "npx"
const isBun = (cmd: Command) => cmd.file === "bun"
const isBrew = (cmd: Command) => cmd.file === "brew"
const isUv = (cmd: Command) => cmd.file === "uv" || cmd.file === "uvx"

/** A `bash -c "curl … | sh"` / `powershell -c "irm … | iex"` official installer. */
function isScriptInstaller(cmd: Command): boolean {
  if (!["bash", "sh", "powershell", "pwsh"].includes(cmd.file)) return false
  const joined = cmd.args.join(" ")
  return /\b(curl|wget|irm|iwr|Invoke-(?:RestMethod|WebRequest))\b/i.test(joined)
}

/** Append `--registry=<url>` without disturbing the existing argument order. */
function withRegistryFlag(cmd: Command, registry: string): Command {
  return { file: cmd.file, args: [...cmd.args, `--registry=${registry}`] }
}

/** Short, readable host for a run-log label. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * The ordered ladder for a failed command. Empty when nothing here can help —
 * which is the right answer for `claude mcp add` (a config write, not a
 * download) and, deliberately, for winget.
 *
 * **winget gets no remedies on purpose.** Its downloader goes through
 * WinINet/WinHTTP, which reads the *system* proxy and ignores `HTTPS_PROXY`
 * entirely, so injecting proxy variables would produce a retry that looks like
 * it should work and reliably doesn't. winget's real recovery is to stop using
 * winget — scoop, or a GitHub Release fetched by our own proxy-aware
 * downloader — and that lives in `CommandStep.fallbacks`.
 */
export function remediesFor(cmd: Command, ctx: RecoveryContext): Remedy[] {
  const remedies: Remedy[] = []
  const proxy = ctx.proxyUrl
  const proxyEnv = proxy ? proxySpawnEnv(proxy, ctx.noProxy) : undefined
  const proxyLabel = proxy ? hostLabel(proxy) : ""
  const proxyPersist: PersistHint | undefined = proxy ? { kind: "proxy", url: proxy } : undefined

  const addProxyOnly = () => {
    if (!proxy || !proxyEnv) return
    remedies.push({
      id: "proxy",
      label: proxyLabel,
      command: cmd,
      env: proxyEnv,
      persist: proxyPersist,
    })
  }

  if (isNpmFamily(cmd)) {
    if (!NPM_FETCHING_VERBS.has(cmd.args[0] ?? "")) return []
    const registry = ctx.npmRegistry
    if (registry) {
      const mirrored = withRegistryFlag(cmd, registry)
      const persist: PersistHint = { kind: "npmRegistry", url: registry }
      remedies.push({
        id: "npm-registry",
        label: hostLabel(registry),
        command: mirrored,
        persist,
      })
      if (proxyEnv) {
        remedies.push({
          id: "npm-registry+proxy",
          label: `${hostLabel(registry)} + ${proxyLabel}`,
          command: mirrored,
          env: proxyEnv,
          persist,
        })
      }
    }
    addProxyOnly()
    return remedies
  }

  if (isNpxFamily(cmd)) {
    // npx takes no `--registry` of its own; `npm_config_registry` is the
    // documented way to point the package it fetches at another registry.
    const registry = ctx.npmRegistry
    if (registry) {
      remedies.push({
        id: "npx-registry",
        label: hostLabel(registry),
        command: cmd,
        env: { npm_config_registry: registry },
        persist: { kind: "npmRegistry", url: registry },
      })
    }
    addProxyOnly()
    return remedies
  }

  if (isBun(cmd)) {
    const registry = ctx.npmRegistry
    if (registry) {
      remedies.push({
        id: "bun-registry",
        label: hostLabel(registry),
        command: cmd,
        env: { BUN_CONFIG_REGISTRY: registry },
      })
    }
    addProxyOnly()
    return remedies
  }

  if (isBrew(cmd)) {
    const brewEnv = ctx.brewEnv
    if (brewEnv && Object.keys(brewEnv).length > 0) {
      const label = hostLabel(brewEnv["HOMEBREW_API_DOMAIN"] ?? brewEnv["HOMEBREW_BOTTLE_DOMAIN"])
      remedies.push({ id: "brew-mirror", label, command: cmd, env: brewEnv })
      if (proxyEnv) {
        remedies.push({
          id: "brew-mirror+proxy",
          label: `${label} + ${proxyLabel}`,
          command: cmd,
          env: { ...brewEnv, ...proxyEnv },
        })
      }
    }
    addProxyOnly()
    return remedies
  }

  if (isUv(cmd)) {
    const index = ctx.pypiIndex
    if (index) {
      remedies.push({
        id: "uv-index",
        label: hostLabel(index),
        command: cmd,
        env: { UV_DEFAULT_INDEX: index, PIP_INDEX_URL: index },
      })
    }
    addProxyOnly()
    return remedies
  }

  if (isScriptInstaller(cmd)) {
    // curl reads these directly. Windows PowerShell 5.1's `irm` goes through the
    // system proxy instead, so this helps on pwsh 7 and on any curl inside the
    // script but is not a guarantee there — the tool's other install methods are
    // the real fallback, and they're attached to the step.
    addProxyOnly()
    return remedies
  }

  return remedies
}
