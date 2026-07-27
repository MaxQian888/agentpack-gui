jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))
jest.mock("@tauri-apps/plugin-os", () => ({
  platform: jest.fn(),
  type: jest.fn(),
  version: jest.fn(),
  arch: jest.fn(),
}))

import { isTauri } from "@/lib/tauri"
import { arch, platform, type, version } from "@tauri-apps/plugin-os"
import { detectOs, osSummary } from "./os"

const mockedIsTauri = isTauri as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockedIsTauri.mockReturnValue(true)
})

describe("detectOs", () => {
  it("returns null in web mode without touching the plugin", async () => {
    mockedIsTauri.mockReturnValue(false)
    expect(await detectOs()).toBeNull()
    expect(platform).not.toHaveBeenCalled()
  })

  it.each([
    ["macos", "mac"],
    ["windows", "win"],
    ["linux", "linux"],
  ] as const)("maps %s to %s", async (reported, expected) => {
    ;(platform as jest.Mock).mockReturnValue(reported)
    expect(await detectOs()).toBe(expected)
  })

  it("folds the other unix targets in with linux", async () => {
    ;(platform as jest.Mock).mockReturnValue("freebsd")
    expect(await detectOs()).toBe("linux")
  })

  it("returns null rather than throwing when the plugin is unavailable", async () => {
    ;(platform as jest.Mock).mockImplementation(() => {
      throw new Error("plugin not initialized")
    })
    expect(await detectOs()).toBeNull()
  })
})

describe("osSummary", () => {
  it("renders a friendly OS name with version and arch", async () => {
    ;(type as jest.Mock).mockReturnValue("macos")
    ;(version as jest.Mock).mockReturnValue("15.3.0")
    ;(arch as jest.Mock).mockReturnValue("aarch64")
    expect(await osSummary()).toBe("macOS 15.3.0 · aarch64")
  })

  it("falls back to the raw type for an OS it has no label for", async () => {
    ;(type as jest.Mock).mockReturnValue("android")
    ;(version as jest.Mock).mockReturnValue("14")
    ;(arch as jest.Mock).mockReturnValue("aarch64")
    expect(await osSummary()).toBe("Android 14 · aarch64")
  })

  it("returns null in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    expect(await osSummary()).toBeNull()
  })
})
