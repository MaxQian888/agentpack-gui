import { findCli } from "./registry"
import { hasReleaseFor, pickReleaseAsset, type ReleaseAsset } from "./release"
import type { ReleaseSource } from "./types"

/** The asset set a Tauri app's release actually ships. */
const ASSETS: ReleaseAsset[] = [
  { name: "CC.Switch_3.4.1_x64-setup.exe", url: "https://x/win-x64.exe", size: 4 },
  { name: "CC.Switch_3.4.1_x64_en-US.msi", url: "https://x/win.msi", size: 5 },
  { name: "CC.Switch_3.4.1_aarch64.dmg", url: "https://x/mac-arm.dmg", size: 8 },
  { name: "CC.Switch_3.4.1_x64.dmg", url: "https://x/mac-x64.dmg", size: 9 },
  { name: "cc-switch_3.4.1_amd64.deb", url: "https://x/linux.deb", size: 6 },
  { name: "cc-switch_3.4.1_amd64.AppImage", url: "https://x/linux.AppImage", size: 7 },
  { name: "latest.json", url: "https://x/latest.json", size: 1 },
]

const ccSwitch = findCli("cc-switch")!.release!

describe("pickReleaseAsset (against the real cc-switch matcher)", () => {
  it("picks the architecture-specific macOS build, not just the first .dmg", () => {
    // The arm64 .dmg is listed FIRST, so a naive matcher would hand an Apple
    // Silicon build to an Intel Mac.
    expect(pickReleaseAsset(ccSwitch, ASSETS, "mac", "x64")?.url).toBe("https://x/mac-x64.dmg")
    expect(pickReleaseAsset(ccSwitch, ASSETS, "mac", "arm64")?.url).toBe("https://x/mac-arm.dmg")
  })

  it("prefers the AppImage on Linux — it needs no root and no apt", () => {
    expect(pickReleaseAsset(ccSwitch, ASSETS, "linux", "x64")?.url).toBe("https://x/linux.AppImage")
  })

  it("picks the Windows installer", () => {
    expect(pickReleaseAsset(ccSwitch, ASSETS, "win", "x64")?.url).toBe("https://x/win-x64.exe")
  })

  it("never picks a non-installer asset like latest.json", () => {
    for (const os of ["win", "mac", "linux"] as const) {
      const hit = pickReleaseAsset(ccSwitch, ASSETS, os, "x64")
      expect(hit?.name).not.toBe("latest.json")
    }
  })

  it("falls back to the generic pattern when no arch-specific asset matches", () => {
    const onlyGeneric: ReleaseAsset[] = [
      { name: "CC.Switch.dmg", url: "https://x/plain.dmg", size: 1 },
    ]
    expect(pickReleaseAsset(ccSwitch, onlyGeneric, "mac", "arm64")?.url).toBe("https://x/plain.dmg")
  })

  it("returns undefined rather than guessing when nothing matches", () => {
    const wrong: ReleaseAsset[] = [{ name: "source.tar.gz", url: "https://x/src", size: 1 }]
    expect(pickReleaseAsset(ccSwitch, wrong, "mac", "arm64")).toBeUndefined()
    expect(pickReleaseAsset(ccSwitch, [], "win", "x64")).toBeUndefined()
  })

  it("returns undefined for an OS the source declares nothing for", () => {
    const macOnly: ReleaseSource = { repo: "o/r", asset: { mac: { pattern: "\\.dmg$" } } }
    expect(pickReleaseAsset(macOnly, ASSETS, "linux", "x64")).toBeUndefined()
  })

  it("survives a malformed pattern instead of throwing mid-install", () => {
    const broken: ReleaseSource = {
      repo: "o/r",
      asset: { mac: { pattern: "\\.dmg$", arch: { arm64: "([unclosed" } } },
    }
    // The bad arch pattern is skipped and the generic one still resolves.
    expect(pickReleaseAsset(broken, ASSETS, "mac", "arm64")?.name).toBe(
      "CC.Switch_3.4.1_aarch64.dmg"
    )
  })
})

describe("hasReleaseFor", () => {
  it("is true for every platform cc-switch publishes for", () => {
    for (const os of ["win", "mac", "linux"] as const) {
      expect(hasReleaseFor(ccSwitch, os)).toBe(true)
    }
  })

  it("is false when a tool declares no release source at all", () => {
    expect(hasReleaseFor(undefined, "linux")).toBe(false)
    expect(hasReleaseFor({ repo: "o/r", asset: {} }, "linux")).toBe(false)
  })
})
