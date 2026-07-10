import {
  mergeClaudeSkillOverride,
  mergeOpencodeSkillPermission,
  parseClaudeSkillOverrides,
  parseOpencodeSkillPermissions,
} from "./skill-config"

describe("mergeClaudeSkillOverride", () => {
  it("creates skillOverrides in an empty settings file", () => {
    const out = mergeClaudeSkillOverride("", "find-docs", "off")
    expect(JSON.parse(out)).toEqual({ skillOverrides: { "find-docs": "off" } })
    expect(out.endsWith("\n")).toBe(true)
  })

  it("preserves unrelated keys and other overrides", () => {
    const existing = JSON.stringify({
      env: { FOO: "bar" },
      skillOverrides: { other: "name-only" },
    })
    const out = JSON.parse(mergeClaudeSkillOverride(existing, "x", "user-invocable-only"))
    expect(out.env).toEqual({ FOO: "bar" })
    expect(out.skillOverrides).toEqual({ other: "name-only", x: "user-invocable-only" })
  })

  it('deletes the key on "on" (the default) and prunes an empty object', () => {
    const existing = JSON.stringify({ skillOverrides: { x: "off" }, env: {} })
    const out = JSON.parse(mergeClaudeSkillOverride(existing, "x", "on"))
    expect(out.skillOverrides).toBeUndefined()
    expect(out.env).toEqual({})
    // null behaves the same as "on".
    const cleared = JSON.parse(
      mergeClaudeSkillOverride(
        JSON.stringify({ skillOverrides: { x: "off", y: "off" } }),
        "x",
        null
      )
    )
    expect(cleared.skillOverrides).toEqual({ y: "off" })
  })

  it("throws on malformed JSON instead of clobbering the file", () => {
    expect(() => mergeClaudeSkillOverride("{ not json", "x", "off")).toThrow(/not valid JSON/)
    expect(() => mergeClaudeSkillOverride("[1,2]", "x", "off")).toThrow(/not a JSON object/)
  })

  it("replaces a non-object skillOverrides value instead of crashing", () => {
    const out = JSON.parse(
      mergeClaudeSkillOverride(JSON.stringify({ skillOverrides: 42 }), "x", "off")
    )
    expect(out.skillOverrides).toEqual({ x: "off" })
  })
})

describe("parseClaudeSkillOverrides", () => {
  it("reads overrides and never throws", () => {
    expect(parseClaudeSkillOverrides(JSON.stringify({ skillOverrides: { a: "off" } }))).toEqual({
      a: "off",
    })
    expect(parseClaudeSkillOverrides("")).toEqual({})
    expect(parseClaudeSkillOverrides("{ bad")).toEqual({})
    expect(parseClaudeSkillOverrides(JSON.stringify({ skillOverrides: { a: 1 } }))).toEqual({})
  })
})

describe("mergeOpencodeSkillPermission", () => {
  it("creates permission.skill in an empty config", () => {
    const out = JSON.parse(mergeOpencodeSkillPermission("", "internal-docs", "deny"))
    expect(out).toEqual({ permission: { skill: { "internal-docs": "deny" } } })
  })

  it("preserves sibling permission keys and hand-written wildcards", () => {
    const existing = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      permission: { bash: "ask", skill: { "internal-*": "deny" } },
    })
    const out = JSON.parse(mergeOpencodeSkillPermission(existing, "x", "ask"))
    expect(out.$schema).toBe("https://opencode.ai/config.json")
    expect(out.permission.bash).toBe("ask")
    expect(out.permission.skill).toEqual({ "internal-*": "deny", x: "ask" })
  })

  it('deletes the key on "allow" and prunes empty objects', () => {
    const existing = JSON.stringify({ permission: { skill: { x: "deny" } } })
    const out = JSON.parse(mergeOpencodeSkillPermission(existing, "x", "allow"))
    expect(out.permission).toBeUndefined()
    // Sibling permission keys keep the permission object alive.
    const withSibling = JSON.stringify({ permission: { bash: "ask", skill: { x: "deny" } } })
    const out2 = JSON.parse(mergeOpencodeSkillPermission(withSibling, "x", null))
    expect(out2.permission).toEqual({ bash: "ask" })
  })

  it("throws on malformed JSON", () => {
    expect(() => mergeOpencodeSkillPermission("not json", "x", "deny")).toThrow(/not valid JSON/)
  })
})

describe("parseOpencodeSkillPermissions", () => {
  it("reads permissions and never throws", () => {
    expect(
      parseOpencodeSkillPermissions(JSON.stringify({ permission: { skill: { a: "deny" } } }))
    ).toEqual({ a: "deny" })
    expect(parseOpencodeSkillPermissions("")).toEqual({})
    expect(parseOpencodeSkillPermissions("{}")).toEqual({})
  })
})
