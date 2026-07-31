import type { BrewMirror, MirrorPreset } from "./mirrors"
import {
  BREW_MIRROR_PRESETS,
  GH_MIRROR_PRESETS,
  NPM_REGISTRY_PRESETS,
  PYPI_INDEX_PRESETS,
} from "./mirrors"
import { PROXY_TEST_URLS, type DiscoveryResult, type ProxyCandidate } from "./discovery"

/**
 * Turn "what proxies and mirrors exist" into "which of them actually work here,
 * fastest first". Discovery finds candidates; this measures them.
 *
 * Everything is pure over an injected `check` (the same shape as the Rust
 * `proxy_check` command), matching `discovery.ts` and `mcp-health.ts`, so the
 * whole ranking unit-tests offline with no IPC and no network.
 *
 * One `NetworkProbeResult` is the single source of truth for three consumers:
 * the Network section's UI, the first-run wizard's self-check, and the
 * install-failure recovery ladder — which is what stops them from each running
 * their own scan and disagreeing about what works.
 */

/** Outcome of one real request (mirrors Rust `ProxyCheckResult`). */
export interface CheckResult {
  ok: boolean
  status?: number
  latencyMs?: number
  reason: string
}

/** The probe primitive. `proxyUrl: null` measures the direct route. */
export type CheckFn = (
  proxyUrl: string | null,
  testUrl: string,
  timeoutMs?: number
) => Promise<CheckResult>

/**
 * Per-request budget. Deliberately tighter than `proxy_check`'s 8s default: this
 * runs on startup across ~15 endpoints at once, and a mirror that needs more
 * than 5s isn't one we'd recommend anyway.
 */
export const PROBE_TIMEOUT_MS = 5000

/** A mirror that measures this much slower than the default isn't worth it. */
const SLOWDOWN_FACTOR = 3

/** The endpoint proxies are raced against — the cheapest useful check. */
const PRIMARY_TEST_URL = PROXY_TEST_URLS[0].url

/** A probed proxy candidate. `result` is null when the probe itself blew up. */
export interface RankedProxy extends ProxyCandidate {
  result: CheckResult | null
}

/** A probed mirror preset. */
export interface RankedMirror {
  preset: MirrorPreset
  result: CheckResult | null
}

/** A probed Homebrew mirror (two domains, so it isn't a `MirrorPreset`). */
export interface RankedBrew {
  preset: BrewMirror
  result: CheckResult | null
}

/**
 * Order by (reachable, then latency). Ties — including "everything failed" —
 * return 0, and `Array.sort` is stable, so the input order survives. That
 * matters: the preset lists put the official/direct entry first, so a total
 * outage leaves us recommending the default rather than an arbitrary mirror.
 */
function compareResults(a: CheckResult | null, b: CheckResult | null): number {
  const aOk = a?.ok ?? false
  const bOk = b?.ok ?? false
  if (aOk !== bOk) return aOk ? -1 : 1
  if (!aOk) return 0
  return (a?.latencyMs ?? Number.POSITIVE_INFINITY) - (b?.latencyMs ?? Number.POSITIVE_INFINITY)
}

/** Run one check, turning a thrown IPC error into a plain failed result. */
async function measure(
  check: CheckFn,
  proxyUrl: string | null,
  testUrl: string
): Promise<CheckResult | null> {
  try {
    return await check(proxyUrl, testUrl, PROBE_TIMEOUT_MS)
  } catch {
    return null
  }
}

/**
 * Measure every discovered proxy against the primary endpoint, in parallel,
 * fastest working one first. A candidate that fails stays in the list — the UI
 * shows *why* it failed, which is more useful than hiding it.
 */
export async function rankProxies(
  candidates: readonly ProxyCandidate[],
  check: CheckFn,
  testUrl: string = PRIMARY_TEST_URL
): Promise<RankedProxy[]> {
  const probed = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      result: await measure(check, candidate.url, testUrl),
    }))
  )
  return probed.sort((a, b) => compareResults(a.result, b.result))
}

/**
 * Measure every mirror in a preset list, through `proxyUrl` when one is in play
 * (a mirror has to be reachable by the same route the install will take).
 */
export async function rankMirrors(
  presets: readonly MirrorPreset[],
  check: CheckFn,
  proxyUrl: string | null = null
): Promise<RankedMirror[]> {
  const probed = await Promise.all(
    presets.map(async (preset) => ({
      preset,
      result: await measure(check, proxyUrl, preset.probeUrl),
    }))
  )
  return probed.sort((a, b) => compareResults(a.result, b.result))
}

/** `rankMirrors` for the Homebrew list, which carries two domains per entry. */
export async function rankBrewMirrors(
  presets: readonly BrewMirror[],
  check: CheckFn,
  proxyUrl: string | null = null
): Promise<RankedBrew[]> {
  const probed = await Promise.all(
    presets.map(async (preset) => ({
      preset,
      result: await measure(check, proxyUrl, preset.probeUrl),
    }))
  )
  return probed.sort((a, b) => compareResults(a.result, b.result))
}

/**
 * Which mirror to actually use, and the two modes differ on purpose:
 *
 *  - `"repair"` — the fastest reachable one. Used by the recovery ladder, which
 *    only runs *after* an install already failed, so "different from the
 *    default" is the entire point.
 *  - `"suggest"` — what to propose to a user who hasn't hit a failure. Keeps the
 *    default unless it's actually broken or more than `SLOWDOWN_FACTOR` slower,
 *    so a working setup is never silently swapped out from under them.
 *
 * Returns undefined when nothing was reachable — the caller must not invent a
 * recommendation out of a list of failures.
 */
export function pickMirror<T extends { result: CheckResult | null }>(
  ranked: readonly T[],
  mode: "repair" | "suggest",
  isDefault: (entry: T) => boolean
): T | undefined {
  const best = ranked.find((entry) => entry.result?.ok)
  if (!best) return undefined
  if (mode === "repair") return best

  const fallback = ranked.find(isDefault)
  if (!fallback?.result?.ok) return best
  const defaultLatency = fallback.result.latencyMs ?? Number.POSITIVE_INFINITY
  const bestLatency = best.result?.latencyMs ?? Number.POSITIVE_INFINITY
  return defaultLatency > bestLatency * SLOWDOWN_FACTOR ? best : fallback
}

/** Whether a ranked entry is the list's "official / direct" default. */
export const isDefaultMirror = (entry: RankedMirror) => entry.preset.url === null
export const isDefaultBrew = (entry: RankedBrew) => entry.preset.apiDomain === null

/** Everything one pass learned about this machine's network. */
export interface NetworkProbeResult {
  /** Every discovered proxy with its measured outcome, best first. */
  proxies: RankedProxy[]
  /** The fastest proxy that actually worked, or null when none did. */
  bestProxy: RankedProxy | null
  /** True when the primary endpoint is reachable with no proxy at all. */
  directOk: boolean
  npm: RankedMirror[]
  gh: RankedMirror[]
  pypi: RankedMirror[]
  brew: RankedBrew[]
  /** PAC note carried through from discovery (agentpack can't evaluate a PAC). */
  pacUrl: string | null
}

/**
 * Whether a measured probe has anything to propose — a proxy the machine needs,
 * or a mirror faster than the default it would otherwise use.
 *
 * Lives here rather than in the wizard step because two callers have to agree:
 * the step renders "nothing to do" from it, and the wizard skips the step
 * entirely when it's false. A healthy machine shouldn't be made to read a page
 * of green ticks and press Continue.
 *
 * Not yet measured (`null`) counts as nothing to propose — the wizard moves on
 * rather than blocking on a probe that may still be in flight.
 */
export function probeSuggestsChange(probe: NetworkProbeResult | null): boolean {
  if (!probe) return false
  const needsProxy = !probe.directOk && !!probe.bestProxy
  const npm = pickMirror(probe.npm, "suggest", isDefaultMirror)
  const gh = pickMirror(probe.gh, "suggest", isDefaultMirror)
  return needsProxy || !!npm?.preset.url || !!gh?.preset.url
}

export interface ProbeOptions {
  check: CheckFn
  /** Preset lists, overridable so tests don't probe the real catalog. */
  npmPresets?: readonly MirrorPreset[]
  ghPresets?: readonly MirrorPreset[]
  pypiPresets?: readonly MirrorPreset[]
  brewPresets?: readonly BrewMirror[]
}

/**
 * Two phases, and the order is load-bearing: rank the proxies first, then probe
 * the mirrors *through the winning route*. Probing mirrors directly while the
 * machine can only reach the internet via a proxy would mark every mirror dead
 * and produce a recommendation that can't work.
 *
 * The direct route is measured too, always — "you don't need a proxy at all" is
 * the most useful answer this can give, and the wizard leads with it.
 */
export async function probeNetwork(
  discovery: DiscoveryResult,
  opts: ProbeOptions
): Promise<NetworkProbeResult> {
  const { check } = opts
  const [proxies, direct] = await Promise.all([
    rankProxies(discovery.candidates, check),
    measure(check, null, PRIMARY_TEST_URL),
  ])
  const bestProxy = proxies.find((p) => p.result?.ok) ?? null
  const directOk = direct?.ok ?? false

  // Route mirror probes the way an install would go: direct when that works
  // (no reason to tunnel), otherwise through the best proxy we just proved.
  const route = directOk ? null : (bestProxy?.url ?? null)

  const [npm, gh, pypi, brew] = await Promise.all([
    rankMirrors(opts.npmPresets ?? NPM_REGISTRY_PRESETS, check, route),
    rankMirrors(opts.ghPresets ?? GH_MIRROR_PRESETS, check, route),
    rankMirrors(opts.pypiPresets ?? PYPI_INDEX_PRESETS, check, route),
    rankBrewMirrors(opts.brewPresets ?? BREW_MIRROR_PRESETS, check, route),
  ])

  return { proxies, bestProxy, directOk, npm, gh, pypi, brew, pacUrl: discovery.pacUrl }
}
