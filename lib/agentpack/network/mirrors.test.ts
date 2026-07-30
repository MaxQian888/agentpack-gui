import {
  BREW_MIRROR_PRESETS,
  GH_MIRROR_PRESETS,
  NPM_REGISTRY_PRESETS,
  PYPI_INDEX_PRESETS,
  brewMirrorEnv,
  matchPreset,
} from "./mirrors"

it("offers a reset-to-default preset first in every list", () => {
  expect(NPM_REGISTRY_PRESETS[0]).toMatchObject({ id: "official", url: null })
  expect(GH_MIRROR_PRESETS[0]).toMatchObject({ id: "direct", url: null })
  expect(PYPI_INDEX_PRESETS[0]).toMatchObject({ id: "official", url: null })
  expect(BREW_MIRROR_PRESETS[0]).toMatchObject({ id: "official", apiDomain: null })
})

it("matches a preset ignoring trailing-slash differences", () => {
  expect(matchPreset(NPM_REGISTRY_PRESETS, "https://registry.npmmirror.com/")?.id).toBe("npmmirror")
  expect(matchPreset(GH_MIRROR_PRESETS, "https://gh-proxy.com")?.id).toBe("gh-proxy")
  expect(matchPreset(PYPI_INDEX_PRESETS, "https://mirrors.aliyun.com/pypi/simple/")?.id).toBe(
    "aliyun"
  )
})

it("treats empty / null as the default preset, and unknown URLs as no match", () => {
  expect(matchPreset(NPM_REGISTRY_PRESETS, null)?.id).toBe("official")
  expect(matchPreset(NPM_REGISTRY_PRESETS, "  ")?.id).toBe("official")
  expect(matchPreset(NPM_REGISTRY_PRESETS, "https://example.com")).toBeUndefined()
})

describe("probe URLs", () => {
  // Every preset must be probeable, or ranking silently drops it and the
  // recovery ladder can never choose it.
  it("gives every preset an https probe target", () => {
    const all = [
      ...NPM_REGISTRY_PRESETS,
      ...GH_MIRROR_PRESETS,
      ...PYPI_INDEX_PRESETS,
      ...BREW_MIRROR_PRESETS,
    ]
    for (const preset of all) {
      expect(preset.probeUrl.startsWith("https://")).toBe(true)
    }
  })

  it("points a registry probe at a real package document, not the bare root", () => {
    expect(matchPreset(NPM_REGISTRY_PRESETS, null)?.probeUrl).toBe(
      "https://registry.npmjs.org/abbrev"
    )
    // A trailing slash in the configured URL must not double up.
    expect(
      matchPreset(NPM_REGISTRY_PRESETS, "https://mirrors.cloud.tencent.com/npm/")?.probeUrl
    ).toBe("https://mirrors.cloud.tencent.com/npm/abbrev")
  })

  it("routes a GitHub mirror probe through the mirror prefix", () => {
    const direct = matchPreset(GH_MIRROR_PRESETS, null)!
    const proxied = matchPreset(GH_MIRROR_PRESETS, "https://gh-proxy.com/")!
    expect(proxied.probeUrl).toBe(`https://gh-proxy.com/${direct.probeUrl}`)
  })
})

describe("brewMirrorEnv", () => {
  it("maps a mirror to the two Homebrew domain variables", () => {
    const tuna = BREW_MIRROR_PRESETS.find((m) => m.id === "tsinghua")
    expect(brewMirrorEnv(tuna)).toEqual({
      HOMEBREW_API_DOMAIN: "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api",
      HOMEBREW_BOTTLE_DOMAIN: "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles",
    })
  })

  it("writes nothing for the official entry or no entry at all", () => {
    expect(brewMirrorEnv(BREW_MIRROR_PRESETS[0])).toEqual({})
    expect(brewMirrorEnv(undefined)).toEqual({})
  })
})
