import type { Arch, OS, ReleaseSource } from "./types"

/**
 * Picking the right file out of a GitHub release.
 *
 * Kept pure and separate from the download so it can be unit-tested against real
 * asset lists: this is the part that silently breaks when an upstream project
 * renames its installers, and a wrong pick means downloading an Intel build onto
 * an Apple-Silicon machine or a .deb onto Fedora.
 */

/** One asset as the GitHub API reports it (mirrors Rust `ReleaseAsset`). */
export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface ReleaseInfo {
  tag: string
  assets: ReleaseAsset[]
}

/**
 * The asset to install for this OS + architecture, or undefined when the release
 * carries nothing usable here.
 *
 * The architecture-specific pattern is tried first and the generic one only as a
 * fallback, so a release that ships both `…_x64.dmg` and `…_aarch64.dmg` never
 * resolves to whichever happened to be listed first.
 */
export function pickReleaseAsset(
  source: ReleaseSource,
  assets: readonly ReleaseAsset[],
  os: OS,
  arch: Arch
): ReleaseAsset | undefined {
  const match = source.asset[os]
  if (!match) return undefined
  const patterns = [match.arch?.[arch], match.pattern].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  )
  for (const pattern of patterns) {
    let re: RegExp
    try {
      re = new RegExp(pattern, "i")
    } catch {
      continue // a malformed pattern shouldn't take the whole install down
    }
    const hit = assets.find((a) => re.test(a.name))
    if (hit) return hit
  }
  return undefined
}

/** Whether a tool can be installed from a release on this OS at all. */
export function hasReleaseFor(source: ReleaseSource | undefined, os: OS): boolean {
  return !!source?.asset[os]
}
