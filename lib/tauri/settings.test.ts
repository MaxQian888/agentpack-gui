jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn() }))
jest.mock("@tauri-apps/plugin-store", () => ({ load: jest.fn() }))

import { isTauri } from "@/lib/tauri"
import { load } from "@tauri-apps/plugin-store"
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings"

const mockedIsTauri = isTauri as jest.Mock
const mockedLoad = load as jest.Mock

function storeMock(saved?: unknown) {
  return {
    get: jest.fn().mockResolvedValue(saved),
    set: jest.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  mockedIsTauri.mockReturnValue(true)
})

describe("loadSettings", () => {
  it("returns defaults in web mode without touching the store", async () => {
    mockedIsTauri.mockReturnValue(false)
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS)
    expect(mockedLoad).not.toHaveBeenCalled()
  })

  it("merges persisted values over the defaults", async () => {
    mockedLoad.mockResolvedValue(storeMock({ autoCheckUpdates: false, skippedVersion: "9.9.9" }))
    expect(await loadSettings()).toEqual({
      autoCheckUpdates: false,
      skippedVersion: "9.9.9",
      lastCheckAt: null,
      onboarded: false,
      quickStartDismissed: false,
    })
  })

  it("falls back to defaults when the store throws", async () => {
    mockedLoad.mockRejectedValue(new Error("no store"))
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe("saveSettings", () => {
  it("returns the merged value in web mode without persisting", async () => {
    mockedIsTauri.mockReturnValue(false)
    expect(await saveSettings({ autoCheckUpdates: false })).toEqual({
      ...DEFAULT_SETTINGS,
      autoCheckUpdates: false,
    })
    expect(mockedLoad).not.toHaveBeenCalled()
  })

  it("persists the merged settings under Tauri", async () => {
    const store = storeMock(undefined)
    mockedLoad.mockResolvedValue(store)
    const result = await saveSettings({ skippedVersion: "1.2.3" })
    expect(result.skippedVersion).toBe("1.2.3")
    expect(store.set).toHaveBeenCalledWith("app", {
      ...DEFAULT_SETTINGS,
      skippedVersion: "1.2.3",
    })
  })

  it("still returns the merged value when persisting fails", async () => {
    const store = storeMock(undefined)
    store.set.mockRejectedValue(new Error("write failed"))
    mockedLoad.mockResolvedValue(store)
    expect(await saveSettings({ lastCheckAt: 42 })).toMatchObject({ lastCheckAt: 42 })
  })
})
