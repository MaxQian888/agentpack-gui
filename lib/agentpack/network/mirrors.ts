/**
 * Mirror presets for the network section. Labels are proper nouns (not
 * translated); the URL is the payload. `url: null` means "back to the default /
 * direct", which is how a preset chip clears the field.
 */

export interface MirrorPreset {
  id: string
  label: string
  url: string | null
}

/** npm registries, official first so "reset" is always reachable. */
export const NPM_REGISTRY_PRESETS: readonly MirrorPreset[] = [
  { id: "official", label: "registry.npmjs.org", url: null },
  { id: "npmmirror", label: "npmmirror", url: "https://registry.npmmirror.com" },
  { id: "tencent", label: "Tencent", url: "https://mirrors.cloud.tencent.com/npm/" },
  { id: "huawei", label: "Huawei", url: "https://repo.huaweicloud.com/repository/npm/" },
]

/**
 * Prefixes prepended to GitHub tarball downloads (`lib/skills/github.ts`) for
 * networks where codeload.github.com is unreachable.
 */
export const GH_MIRROR_PRESETS: readonly MirrorPreset[] = [
  { id: "direct", label: "github.com", url: null },
  { id: "gh-proxy", label: "gh-proxy.com", url: "https://gh-proxy.com/" },
  { id: "ghfast", label: "ghfast.top", url: "https://ghfast.top/" },
]

/** The preset matching `url`, ignoring a trailing slash difference, or undefined. */
export function matchPreset(
  presets: readonly MirrorPreset[],
  url: string | null | undefined
): MirrorPreset | undefined {
  const strip = (u: string | null | undefined) => (u ?? "").trim().replace(/\/+$/, "")
  const target = strip(url)
  return presets.find((p) => strip(p.url) === target)
}
