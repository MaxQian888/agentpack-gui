import { isTauri } from "./tauri"

describe("isTauri", () => {
  it("returns false in jsdom (no Tauri marker)", () => {
    expect(isTauri()).toBe(false)
  })

  it("returns true when __TAURI_INTERNALS__ is on window", () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    expect(isTauri()).toBe(true)
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })
})
