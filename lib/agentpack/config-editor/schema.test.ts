import {
  fieldOptions,
  getConfigValue,
  isPathEditable,
  isProviderScoped,
  jsonFormat,
  PROVIDER_TOKEN,
  resolveFieldPath,
  setConfigValue,
  tomlFormat,
  type ConfigField,
} from "./schema"

describe("jsonFormat", () => {
  it("reads a blank file as an empty doc so a config can be created from the form", () => {
    expect(jsonFormat.parse("")).toEqual({})
    expect(jsonFormat.parse("   \n ")).toEqual({})
  })

  it("rejects a non-object root and a syntax error", () => {
    expect(jsonFormat.parse("[1,2]")).toBeNull()
    expect(jsonFormat.parse('"hello"')).toBeNull()
    expect(jsonFormat.parse("{bad")).toBeNull()
  })

  it("serializes with two-space indent and a trailing newline", () => {
    expect(jsonFormat.serialize({ a: 1 })).toBe('{\n  "a": 1\n}\n')
  })

  it("round-trips unknown keys", () => {
    const src = '{\n  "known": 1,\n  "vendorSpecific": { "deep": [1, 2] }\n}'
    const doc = jsonFormat.parse(src)!
    expect(jsonFormat.parse(jsonFormat.serialize(doc))).toEqual(doc)
  })
})

describe("tomlFormat", () => {
  it("reads a blank file as an empty doc", () => {
    expect(tomlFormat.parse("")).toEqual({})
  })

  it("rejects a syntax error", () => {
    expect(tomlFormat.parse("x = [[")).toBeNull()
    expect(tomlFormat.parse("not = ")).toBeNull()
  })

  it("round-trips unknown keys", () => {
    const doc = tomlFormat.parse('[unknown]\nkey = "value"\nn = 3\n')!
    expect(tomlFormat.parse(tomlFormat.serialize(doc))).toEqual(doc)
  })
})

describe("getConfigValue / setConfigValue", () => {
  it("reads a nested path and undefined for an absent segment", () => {
    const doc = { a: { b: { c: 1 } } }
    expect(getConfigValue(doc, ["a", "b", "c"])).toBe(1)
    expect(getConfigValue(doc, ["a", "nope", "c"])).toBeUndefined()
  })

  it("creates intermediate tables", () => {
    expect(setConfigValue({}, ["a", "b"], 1)).toEqual({ a: { b: 1 } })
  })

  it("does not mutate the input doc", () => {
    const doc = { a: { b: 1 } }
    setConfigValue(doc, ["a", "b"], 2)
    expect(doc).toEqual({ a: { b: 1 } })
  })

  it("deletes on an empty value and prunes the table it emptied", () => {
    expect(setConfigValue({ a: { b: 1 } }, ["a", "b"], undefined)).toEqual({})
    expect(setConfigValue({ a: { b: "x" } }, ["a", "b"], "")).toEqual({})
    expect(setConfigValue({ a: { b: ["x"] } }, ["a", "b"], [])).toEqual({})
  })

  it("treats an emptied map as absent so clearing env removes the block", () => {
    expect(setConfigValue({ env: { FOO: "bar" } }, ["env"], {})).toEqual({})
  })

  it("keeps siblings when pruning", () => {
    expect(setConfigValue({ a: { b: 1, c: 2 } }, ["a", "b"], undefined)).toEqual({ a: { c: 2 } })
  })
})

describe("resolveFieldPath", () => {
  const field: ConfigField = {
    path: ["speech", PROVIDER_TOKEN, "api_key"],
    key: "apiKey",
    type: "string",
  }

  it("substitutes the sibling provider value", () => {
    const doc = { speech: { provider: "openai" } }
    expect(resolveFieldPath(doc, field.path)).toEqual(["speech", "openai", "api_key"])
  })

  it("returns null when no provider is chosen yet", () => {
    expect(resolveFieldPath({ speech: {} }, field.path)).toBeNull()
    expect(resolveFieldPath({ speech: { provider: "" } }, field.path)).toBeNull()
  })

  it("passes a plain path through", () => {
    expect(resolveFieldPath({}, ["management", "port"])).toEqual(["management", "port"])
  })

  it("recognizes a provider-scoped field", () => {
    expect(isProviderScoped(field)).toBe(true)
    expect(isProviderScoped({ path: ["model"], key: "model", type: "string" })).toBe(false)
  })
})

describe("fieldOptions", () => {
  it("merges declared options, optionsFrom table keys and the on-disk value", () => {
    const field: ConfigField = {
      path: ["model_provider"],
      key: "codexProvider",
      type: "select",
      options: ["", "openai"],
      optionsFrom: ["model_providers"],
    }
    const doc = { model_providers: { custom: {}, corp: {} } }
    expect(fieldOptions(doc, field, "corp")).toEqual(["", "openai", "custom", "corp"])
  })

  it("keeps an on-disk value the declared enum does not list", () => {
    const field: ConfigField = {
      path: ["theme"],
      key: "claudeTheme",
      type: "select",
      options: ["", "light", "dark"],
    }
    expect(fieldOptions({}, field, "dark-daltonized")).toContain("dark-daltonized")
  })

  it("hoists the unset entry to the front and dedupes", () => {
    const field: ConfigField = {
      path: ["x"],
      key: "x",
      type: "select",
      options: ["a", "", "b"],
    }
    expect(fieldOptions({}, field, "a")).toEqual(["", "a", "b"])
  })
})

describe("isPathEditable", () => {
  it("allows an absent value and an absent ancestor", () => {
    expect(isPathEditable({}, ["model"], "string")).toBe(true)
    expect(isPathEditable({}, ["statusLine", "command"], "string")).toBe(true)
  })

  it("locks a field whose ancestor holds a non-table", () => {
    // Claude's statusLine is a union: a template string here blocks the object form.
    const doc = { statusLine: "${model}" }
    expect(isPathEditable(doc, ["statusLine", "command"], "string")).toBe(false)
    expect(isPathEditable(doc, ["statusLine", "type"], "select")).toBe(false)
  })

  it("unlocks the same field when the ancestor is a table", () => {
    const doc = { statusLine: { type: "command" } }
    expect(isPathEditable(doc, ["statusLine", "command"], "string")).toBe(true)
  })

  it("locks a select whose leaf holds a table", () => {
    // Codex approval_policy may be `{ granular = { … } }`.
    expect(
      isPathEditable({ approval_policy: { granular: {} } }, ["approval_policy"], "select")
    ).toBe(false)
    // OpenCode permission.bash may be a pattern→action map.
    expect(
      isPathEditable(
        { permission: { bash: { "git *": "allow" } } },
        ["permission", "bash"],
        "select"
      )
    ).toBe(false)
  })

  it("locks a string-list over a plain string and a number over an array", () => {
    expect(isPathEditable({ allow: "Bash(*)" }, ["allow"], "string-list")).toBe(false)
    expect(isPathEditable({ port: [1] }, ["port"], "number")).toBe(false)
  })

  it("accepts values that match the widget", () => {
    expect(isPathEditable({ allow: ["a", "b"] }, ["allow"], "string-list")).toBe(true)
    expect(isPathEditable({ allow: [] }, ["allow"], "string-list")).toBe(true)
    expect(isPathEditable({ env: { A: "1" } }, ["env"], "string-map")).toBe(true)
    expect(isPathEditable({ quiet: true }, ["quiet"], "boolean")).toBe(true)
    expect(isPathEditable({ port: 80 }, ["port"], "number")).toBe(true)
  })

  it("locks a string-map holding non-string values", () => {
    expect(isPathEditable({ env: { A: 1 } }, ["env"], "string-map")).toBe(false)
  })

  it("locks a boolean field holding a number", () => {
    expect(isPathEditable({ quiet: 1 }, ["quiet"], "boolean")).toBe(false)
  })
})
