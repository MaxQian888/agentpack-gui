import { normalizeLang, detectBrowserLang } from "./locale"

describe("normalizeLang", () => {
  it("returns undefined for empty input", () => {
    expect(normalizeLang(undefined)).toBeUndefined()
    expect(normalizeLang("")).toBeUndefined()
  })

  it("maps zh* to zh-CN and en* to en (case-insensitive)", () => {
    expect(normalizeLang("zh_CN.UTF-8")).toBe("zh-CN")
    expect(normalizeLang("ZH-tw")).toBe("zh-CN")
    expect(normalizeLang("en-US")).toBe("en")
  })

  it("returns undefined for unsupported locales", () => {
    expect(normalizeLang("fr-FR")).toBeUndefined()
  })
})

describe("detectBrowserLang", () => {
  const original = navigator.language

  afterEach(() => {
    Object.defineProperty(navigator, "language", { value: original, configurable: true })
  })

  it("uses navigator.language when recognized", () => {
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true })
    expect(detectBrowserLang()).toBe("zh-CN")
  })

  it("falls back to English for unknown locales", () => {
    Object.defineProperty(navigator, "language", { value: "fr-FR", configurable: true })
    expect(detectBrowserLang()).toBe("en")
  })
})
