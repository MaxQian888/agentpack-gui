/**
 * Mirror presets for the network section. Labels are proper nouns (not
 * translated); the URL is the payload. `url: null` means "back to the default /
 * direct", which is how a preset chip clears the field.
 *
 * Every preset also carries a `probeUrl` — one small, always-present document
 * that proves the mirror is reachable *and* how fast it is. `probe.ts` races
 * these to pick the best one for this machine, and the install-failure recovery
 * ladder reuses that answer, so the ranking here is what makes "retry via a
 * mirror" pick something that actually works instead of guessing.
 */

export interface MirrorPreset {
  id: string
  label: string
  url: string | null
  /**
   * A cheap GET target that proves this mirror is up. Deliberately a tiny,
   * long-lived document: the probe runs on startup and in the first-run wizard,
   * so it must cost near-nothing even on a slow link.
   */
  probeUrl: string
}

const stripSlash = (u: string) => u.replace(/\/+$/, "")

// ── npm registries ───────────────────────────────────────────────────────────

const NPM_OFFICIAL = "https://registry.npmjs.org"

/**
 * `abbrev` is a ~1 KB, decade-old, dependency-free package every registry mirror
 * carries — the cheapest document that still proves a registry can serve real
 * package metadata (a bare registry root answers even when the package store
 * behind it is broken or unsynced).
 */
const NPM_PROBE_PACKAGE = "abbrev"

const npmMirror = (id: string, label: string, url: string | null): MirrorPreset => ({
  id,
  label,
  url,
  probeUrl: `${stripSlash(url ?? NPM_OFFICIAL)}/${NPM_PROBE_PACKAGE}`,
})

/** npm registries, official first so "reset" is always reachable. */
export const NPM_REGISTRY_PRESETS: readonly MirrorPreset[] = [
  npmMirror("official", "registry.npmjs.org", null),
  npmMirror("npmmirror", "npmmirror", "https://registry.npmmirror.com"),
  npmMirror("tencent", "Tencent", "https://mirrors.cloud.tencent.com/npm/"),
  npmMirror("huawei", "Huawei", "https://repo.huaweicloud.com/repository/npm/"),
]

// ── GitHub download mirrors ──────────────────────────────────────────────────

/**
 * A small, stable file served from raw.githubusercontent.com. Every gh-proxy
 * style mirror fronts raw.githubusercontent the same way it fronts codeload, so
 * probing this exercises the exact path a skill tarball or a release asset takes.
 */
const GH_PROBE_TARGET = "https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore"

const ghMirror = (id: string, label: string, prefix: string | null): MirrorPreset => ({
  id,
  label,
  url: prefix,
  probeUrl: `${prefix ?? ""}${GH_PROBE_TARGET}`,
})

/**
 * Prefixes prepended to GitHub downloads (`lib/skills/github.ts` tarballs and
 * `download.rs` release assets) for networks where github.com is unreachable.
 * Several alternatives on purpose: these public proxies rate-limit and go down
 * often, so the recovery ladder needs somewhere to fall back to.
 */
export const GH_MIRROR_PRESETS: readonly MirrorPreset[] = [
  ghMirror("direct", "github.com", null),
  ghMirror("gh-proxy", "gh-proxy.com", "https://gh-proxy.com/"),
  ghMirror("ghfast", "ghfast.top", "https://ghfast.top/"),
  ghMirror("ghproxy-net", "ghproxy.net", "https://ghproxy.net/"),
]

// ── PyPI indexes ─────────────────────────────────────────────────────────────

const PYPI_OFFICIAL = "https://pypi.org/simple"

/** `pip`'s own simple-index page — present on every PyPI mirror by definition. */
const PYPI_PROBE_PACKAGE = "pip"

const pypiIndex = (id: string, label: string, url: string | null): MirrorPreset => ({
  id,
  label,
  url,
  probeUrl: `${stripSlash(url ?? PYPI_OFFICIAL)}/${PYPI_PROBE_PACKAGE}/`,
})

/**
 * PyPI indexes, applied as `UV_DEFAULT_INDEX` / `PIP_INDEX_URL`. This is the
 * link `uv` and every uvx-launched MCP server (the `fetch` server, for one)
 * depend on, and it has no home in the UI until now.
 */
export const PYPI_INDEX_PRESETS: readonly MirrorPreset[] = [
  pypiIndex("official", "pypi.org", null),
  pypiIndex("tsinghua", "TUNA", "https://pypi.tuna.tsinghua.edu.cn/simple"),
  pypiIndex("aliyun", "Aliyun", "https://mirrors.aliyun.com/pypi/simple"),
  pypiIndex("ustc", "USTC", "https://mirrors.ustc.edu.cn/pypi/simple"),
]

// ── Homebrew ─────────────────────────────────────────────────────────────────

/**
 * Homebrew needs TWO endpoints redirected, not one — the formula API and the
 * bottle (pre-built binary) store — so it gets its own shape rather than being
 * bent into `MirrorPreset`. Both map to environment variables, which is why this
 * can be applied for a single retry without touching the user's machine.
 */
export interface BrewMirror {
  id: string
  label: string
  /** `HOMEBREW_API_DOMAIN`, or null for Homebrew's default. */
  apiDomain: string | null
  /** `HOMEBREW_BOTTLE_DOMAIN`, or null for Homebrew's default. */
  bottleDomain: string | null
  probeUrl: string
}

const BREW_OFFICIAL_API = "https://formulae.brew.sh/api"

/** A single small formula document — the first thing `brew install` fetches. */
const BREW_PROBE_FORMULA = "wget.json"

const brewMirror = (
  id: string,
  label: string,
  apiDomain: string | null,
  bottleDomain: string | null
): BrewMirror => ({
  id,
  label,
  apiDomain,
  bottleDomain,
  probeUrl: `${stripSlash(apiDomain ?? BREW_OFFICIAL_API)}/formula/${BREW_PROBE_FORMULA}`,
})

/**
 * Homebrew mirrors. `brew install --cask cc-switch` failing to pull a bottle is
 * the single most common macOS install failure on a restricted network, and
 * these two env vars are the documented fix.
 */
export const BREW_MIRROR_PRESETS: readonly BrewMirror[] = [
  brewMirror("official", "formulae.brew.sh", null, null),
  brewMirror(
    "tsinghua",
    "TUNA",
    "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api",
    "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
  ),
  brewMirror(
    "ustc",
    "USTC",
    "https://mirrors.ustc.edu.cn/homebrew-bottles/api",
    "https://mirrors.ustc.edu.cn/homebrew-bottles"
  ),
]

/** The env vars a brew mirror applies as. Empty for the official (default) entry. */
export function brewMirrorEnv(mirror: BrewMirror | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!mirror) return out
  if (mirror.apiDomain) out["HOMEBREW_API_DOMAIN"] = mirror.apiDomain
  if (mirror.bottleDomain) out["HOMEBREW_BOTTLE_DOMAIN"] = mirror.bottleDomain
  return out
}

/** The preset matching `url`, ignoring a trailing slash difference, or undefined. */
export function matchPreset(
  presets: readonly MirrorPreset[],
  url: string | null | undefined
): MirrorPreset | undefined {
  const strip = (u: string | null | undefined) => (u ?? "").trim().replace(/\/+$/, "")
  const target = strip(url)
  return presets.find((p) => strip(p.url) === target)
}
