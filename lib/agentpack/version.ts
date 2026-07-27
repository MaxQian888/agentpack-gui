/**
 * Pure, browser-safe semver helpers for the CLI "upgrade available?" check.
 *
 * `--version` output is noisy (e.g. "1.2.3 (Claude Code)", "codex-cli 0.5.0"),
 * so we extract the first `x.y.z` token and compare numerically. Pre-release and
 * build metadata are intentionally ignored — major.minor.patch is enough to
 * decide whether a newer published version exists.
 */

const SEMVER_RE = /\d+\.\d+\.\d+/

/** Pull the first `x.y.z` version token out of a raw string, or undefined. */
export function extractSemver(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return raw.match(SEMVER_RE)?.[0]
}

function parts(version: string | undefined): [number, number, number] | undefined {
  const v = extractSemver(version)
  if (!v) return undefined
  const [major, minor, patch] = v.split(".").map(Number)
  return [major, minor, patch]
}

/**
 * The major version number in a raw `--version` string ("v24.1.0" => 24), or
 * undefined when nothing parseable is there. Used to check a package's declared
 * `engines.node` floor before handing the install to npm.
 */
export function majorVersion(raw: string | undefined): number | undefined {
  return parts(raw)?.[0]
}

/**
 * True only when `latest` is strictly newer than `installed`. Returns false when
 * either version is missing/unparseable, so a failed lookup never shows Upgrade.
 */
export function isUpgradeAvailable(
  installed: string | undefined,
  latest: string | undefined
): boolean {
  const a = parts(installed)
  const b = parts(latest)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true
    if (b[i] < a[i]) return false
  }
  return false
}
