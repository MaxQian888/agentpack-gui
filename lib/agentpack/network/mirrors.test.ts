import { GH_MIRROR_PRESETS, NPM_REGISTRY_PRESETS, matchPreset } from "./mirrors"

it("offers a reset-to-default preset first in both lists", () => {
  expect(NPM_REGISTRY_PRESETS[0]).toMatchObject({ id: "official", url: null })
  expect(GH_MIRROR_PRESETS[0]).toMatchObject({ id: "direct", url: null })
})

it("matches a preset ignoring trailing-slash differences", () => {
  expect(matchPreset(NPM_REGISTRY_PRESETS, "https://registry.npmmirror.com/")?.id).toBe("npmmirror")
  expect(matchPreset(GH_MIRROR_PRESETS, "https://gh-proxy.com")?.id).toBe("gh-proxy")
})

it("treats empty / null as the default preset, and unknown URLs as no match", () => {
  expect(matchPreset(NPM_REGISTRY_PRESETS, null)?.id).toBe("official")
  expect(matchPreset(NPM_REGISTRY_PRESETS, "  ")?.id).toBe("official")
  expect(matchPreset(NPM_REGISTRY_PRESETS, "https://example.com")).toBeUndefined()
})
