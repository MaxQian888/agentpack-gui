import { findCli } from "./registry"
import { hasReleaseFor, pickReleaseAsset, releaseSourceLabel, type ReleaseAsset } from "./release"
import type { GithubReleaseSource, ManifestReleaseSource } from "./types"

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

const ccSwitchRelease = findCli("cc-switch")!.release!
// Narrowed once, so every case below reads plainly — and if cc-switch ever moves
// off GitHub Releases, this line says so instead of a wall of type errors.
if (ccSwitchRelease.kind !== "github") throw new Error("cc-switch should use a GitHub release")
const ccSwitch: GithubReleaseSource = ccSwitchRelease

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
    const macOnly: GithubReleaseSource = {
      kind: "github",
      repo: "o/r",
      asset: { mac: { pattern: "\\.dmg$" } },
    }
    expect(pickReleaseAsset(macOnly, ASSETS, "linux", "x64")).toBeUndefined()
  })

  it("survives a malformed pattern instead of throwing mid-install", () => {
    const broken: GithubReleaseSource = {
      kind: "github",
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

  it("reads the right field for a manifest source", () => {
    const source: ManifestReleaseSource = {
      kind: "manifest",
      manifest: { mac: "https://v.example/RELEASES.json" },
    }
    expect(hasReleaseFor(source, "mac")).toBe(true)
    expect(hasReleaseFor(source, "win")).toBe(false)
  })

  it("is false when a tool declares no release source at all", () => {
    expect(hasReleaseFor(undefined, "linux")).toBe(false)
    expect(hasReleaseFor({ kind: "github", repo: "o/r", asset: {} }, "linux")).toBe(false)
  })
})

describe("releaseSourceLabel", () => {
  it("names the repo for a GitHub release", () => {
    expect(releaseSourceLabel(ccSwitch, "mac")).toBe("farion1231/cc-switch")
  })

  it("names the host for a manifest, not the whole URL", () => {
    const source: ManifestReleaseSource = {
      kind: "manifest",
      manifest: { mac: "https://downloads.claude.ai/releases/darwin/universal/RELEASES.json" },
    }
    expect(releaseSourceLabel(source, "mac")).toBe("downloads.claude.ai")
  })

  it("is empty for an OS with no manifest, rather than throwing", () => {
    expect(releaseSourceLabel({ kind: "manifest", manifest: {} }, "linux")).toBe("")
  })
})

describe("the desktop apps as registered", () => {
  it("resolves Claude for macOS from the manifest, not a documented download link", () => {
    // Those links exist but answer 403 to any non-browser client, so a direct
    // URL here would be an install that can never succeed.
    const release = findCli("claude-desktop")!.release!
    expect(release.kind).toBe("manifest")
    expect(hasReleaseFor(release, "mac")).toBe(true)
  })

  it("detects the desktop apps by bundle name — they put nothing on PATH", () => {
    for (const id of ["claude-desktop", "codex-app"] as const) {
      const tool = findCli(id)!
      expect(tool.gui).toBe(true)
      expect(tool.appBundles?.length).toBeTruthy()
      expect(tool.appBundles?.every((b) => b.name.trim())).toBe(true)
    }
  })

  it("finds the Codex app under the ChatGPT bundle it was merged into", () => {
    // Since July 2026 the Codex app IS the ChatGPT desktop app. Looking only for
    // `Codex.app` reported an up-to-date Mac as having no Codex app at all.
    const tool = findCli("codex-app")!
    const names = tool.appBundles!.map((b) => b.name)
    expect(names).toContain("ChatGPT")
    // The pre-merge bundle is still out there and must keep matching.
    expect(names).toContain("Codex")
    expect(names.indexOf("ChatGPT")).toBeLessThan(names.indexOf("Codex"))
  })

  it("only counts a ChatGPT bundle that actually carries Codex", () => {
    // A ChatGPT install from before the merge is a chat client with no agent in
    // it; claiming it as the Codex app would hide the install button from
    // someone who has no Codex. The legacy Codex bundle needs no such proof.
    const bundles = findCli("codex-app")!.appBundles!
    const chatgpt = bundles.find((b) => b.name === "ChatGPT")!
    expect(chatgpt.requires?.length).toBeTruthy()
    expect(chatgpt.requires).toContain("Contents/Resources/codex")
    expect(bundles.find((b) => b.name === "Codex")!.requires).toBeUndefined()
  })

  it("installs the Codex app from the cask that replaced the discontinued one", () => {
    // Homebrew deprecated `codex-app` ("discontinued upstream", disabled
    // 2027-07-12) and points at `chatgpt`. Installing the old one now fails.
    const tool = findCli("codex-app")!
    expect(tool.install.mac?.args).toContain("chatgpt")
    expect(tool.install.mac?.args).not.toContain("codex-app")
    expect(tool.uninstall?.mac?.args).toContain("chatgpt")
  })

  it("offers no automated Windows install for the Codex app", () => {
    // `OpenAI.Codex` on winget is the CLI, not the app — so this must stay null
    // and fall through to the manual note rather than installing the wrong thing.
    const tool = findCli("codex-app")!
    expect(tool.install.win).toBeNull()
    expect(tool.manualNote).toContain("chatgpt.com/download")
  })
})
