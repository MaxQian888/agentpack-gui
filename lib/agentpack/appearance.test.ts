import { DEFAULT_UI_SCALE, normalizeUiScale, UI_SCALES } from "./appearance"

describe("normalizeUiScale", () => {
  it("keeps a scale the stylesheet implements", () => {
    for (const scale of UI_SCALES) expect(normalizeUiScale(scale)).toBe(scale)
  })

  /**
   * A settings file edited by hand, or written by a later release with more
   * steps, must not put an unknown size on the document root.
   */
  it("falls back to the default for anything else", () => {
    expect(normalizeUiScale(133)).toBe(DEFAULT_UI_SCALE)
    expect(normalizeUiScale("110")).toBe(DEFAULT_UI_SCALE)
    expect(normalizeUiScale(undefined)).toBe(DEFAULT_UI_SCALE)
    expect(normalizeUiScale(null)).toBe(DEFAULT_UI_SCALE)
  })
})
