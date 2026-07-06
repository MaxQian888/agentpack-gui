import { SOURCE_COLORS, modelColor, modelToSource } from "./display"

describe("modelToSource", () => {
  it("maps Claude models", () => {
    expect(modelToSource("claude-opus-4-8")).toBe("claude")
    expect(modelToSource("CLAUDE-sonnet")).toBe("claude")
  })
  it("maps OpenAI / Codex models", () => {
    expect(modelToSource("gpt-5.3-codex")).toBe("codex")
    expect(modelToSource("o3-mini")).toBe("codex")
    expect(modelToSource("codex")).toBe("codex")
  })
  it("falls back to opencode for anything else", () => {
    expect(modelToSource("deepseek-v4-pro")).toBe("opencode")
    expect(modelToSource("")).toBe("opencode")
  })
})

describe("modelColor", () => {
  it("returns the source color", () => {
    expect(modelColor("claude-opus-4-8")).toBe(SOURCE_COLORS.claude)
    expect(modelColor("gpt-5.3-codex")).toBe(SOURCE_COLORS.codex)
    expect(modelColor("mystery")).toBe(SOURCE_COLORS.opencode)
  })
})
