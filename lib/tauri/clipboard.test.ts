jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))
jest.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: jest.fn(),
  readText: jest.fn(),
}))

import { isTauri } from "@/lib/tauri"
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager"
import { copyText, readTextFromClipboard } from "./clipboard"

const mockedIsTauri = isTauri as jest.Mock

/** Swap `navigator.clipboard`, which jsdom doesn't provide. */
function setNavigatorClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedIsTauri.mockReturnValue(true)
  ;(writeText as jest.Mock).mockResolvedValue(undefined)
  ;(readText as jest.Mock).mockResolvedValue("from plugin")
})

describe("copyText", () => {
  it("uses the plugin under Tauri, never navigator.clipboard", async () => {
    const navWrite = jest.fn()
    setNavigatorClipboard({ writeText: navWrite })
    expect(await copyText("secret")).toBe(true)
    expect(writeText).toHaveBeenCalledWith("secret")
    expect(navWrite).not.toHaveBeenCalled()
  })

  it("falls back to navigator.clipboard in web mode", async () => {
    mockedIsTauri.mockReturnValue(false)
    const navWrite = jest.fn().mockResolvedValue(undefined)
    setNavigatorClipboard({ writeText: navWrite })
    expect(await copyText("hello")).toBe(true)
    expect(navWrite).toHaveBeenCalledWith("hello")
    expect(writeText).not.toHaveBeenCalled()
  })

  it("reports failure instead of throwing when the plugin rejects", async () => {
    ;(writeText as jest.Mock).mockRejectedValue(new Error("no clipboard"))
    expect(await copyText("x")).toBe(false)
  })

  it("reports failure when the web API is missing entirely", async () => {
    mockedIsTauri.mockReturnValue(false)
    setNavigatorClipboard(undefined)
    expect(await copyText("x")).toBe(false)
  })
})

describe("readTextFromClipboard", () => {
  it("reads through the plugin under Tauri", async () => {
    expect(await readTextFromClipboard()).toBe("from plugin")
  })

  it("returns null when reading fails", async () => {
    ;(readText as jest.Mock).mockRejectedValue(new Error("denied"))
    expect(await readTextFromClipboard()).toBeNull()
  })

  it("returns null when the web API is missing", async () => {
    mockedIsTauri.mockReturnValue(false)
    setNavigatorClipboard(undefined)
    expect(await readTextFromClipboard()).toBeNull()
  })
})
