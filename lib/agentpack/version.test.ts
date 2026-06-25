import { extractSemver, isUpgradeAvailable } from "./version"

describe("extractSemver", () => {
  it("pulls a bare x.y.z token", () => {
    expect(extractSemver("1.2.3")).toBe("1.2.3")
  })

  it("strips surrounding tool text", () => {
    expect(extractSemver("1.2.3 (Claude Code)")).toBe("1.2.3")
    expect(extractSemver("codex-cli 0.5.0")).toBe("0.5.0")
  })

  it("ignores a leading v", () => {
    expect(extractSemver("v1.2.3")).toBe("1.2.3")
  })

  it("returns undefined when there is no version", () => {
    expect(extractSemver("not a version")).toBeUndefined()
    expect(extractSemver("")).toBeUndefined()
    expect(extractSemver(undefined)).toBeUndefined()
  })
})

describe("isUpgradeAvailable", () => {
  it("is true when latest is strictly newer", () => {
    expect(isUpgradeAvailable("1.2.3", "1.2.4")).toBe(true)
    expect(isUpgradeAvailable("1.2.3", "1.3.0")).toBe(true)
    expect(isUpgradeAvailable("1.2.3", "2.0.0")).toBe(true)
  })

  it("is false when versions match", () => {
    expect(isUpgradeAvailable("1.2.3", "1.2.3")).toBe(false)
  })

  it("is false when installed is newer than latest", () => {
    expect(isUpgradeAvailable("2.0.0", "1.9.9")).toBe(false)
  })

  it("tolerates noisy version strings on both sides", () => {
    expect(isUpgradeAvailable("1.2.3 (Claude Code)", "1.2.4")).toBe(true)
    expect(isUpgradeAvailable("v1.2.3", "1.2.3")).toBe(false)
  })

  it("is false when either version is missing or unparseable", () => {
    expect(isUpgradeAvailable(undefined, "1.2.3")).toBe(false)
    expect(isUpgradeAvailable("1.2.3", undefined)).toBe(false)
    expect(isUpgradeAvailable("1.2.3", "garbage")).toBe(false)
  })
})
