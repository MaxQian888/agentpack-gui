import { estimateTokens, HIGHLIGHT_FIELDS, invocation, skillCost, toolList } from "./meta"

describe("skillCost", () => {
  it("counts bytes, lines and estimates tokens", () => {
    const c = skillCost("abcd\nefgh")
    expect(c.bytes).toBe(9)
    expect(c.lines).toBe(2)
    expect(c.tokens).toBe(Math.ceil(9 / 4))
  })

  it("treats empty text as zero everything", () => {
    expect(skillCost("")).toEqual({ bytes: 0, lines: 0, tokens: 0 })
  })

  it("counts UTF-8 bytes, not code units", () => {
    expect(skillCost("é").bytes).toBe(2)
  })

  it("counts astral characters (surrogate pairs) as 4 bytes", () => {
    expect(skillCost("😀").bytes).toBe(4)
  })
})

describe("estimateTokens", () => {
  it("uses the ~4-chars-per-token heuristic, rounding up", () => {
    expect(estimateTokens("12345")).toBe(2)
  })
})

describe("toolList", () => {
  it("splits on spaces and commas, trimming blanks", () => {
    expect(toolList("Read, Grep  Write")).toEqual(["Read", "Grep", "Write"])
  })

  it("returns [] for undefined or whitespace", () => {
    expect(toolList(undefined)).toEqual([])
    expect(toolList("   ")).toEqual([])
  })
})

describe("invocation", () => {
  it("defaults to both model- and user-invocable", () => {
    expect(invocation({})).toEqual({ model: true, user: true })
  })

  it("disable-model-invocation:true blocks auto-load", () => {
    expect(invocation({ "disable-model-invocation": "true" }).model).toBe(false)
  })

  it("user-invocable:false hides it from the / menu", () => {
    expect(invocation({ "user-invocable": "false" }).user).toBe(false)
  })
})

it("HIGHLIGHT_FIELDS surfaces the key metadata rows", () => {
  expect(HIGHLIGHT_FIELDS).toContain("when_to_use")
  expect(HIGHLIGHT_FIELDS).toContain("paths")
})
