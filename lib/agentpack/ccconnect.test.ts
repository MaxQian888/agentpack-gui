import {
  CC_CONNECT_BRIDGE_PORT,
  CC_CONNECT_MANAGEMENT_PORT,
  CC_CONNECT_WEBHOOK_PORT,
  CONFIG_SECTIONS,
  PROVIDER_TOKEN,
  dashboardUrl,
  defaultConfigToml,
  getConfigValue,
  isProviderScoped,
  isSectionEnabled,
  parseBridgePort,
  parseConfigDoc,
  parseManagementPort,
  parseManagementToken,
  parseWebhookPort,
  resolveFieldPath,
  serializeConfigDoc,
  setConfigValue,
} from "./ccconnect"

describe("section ports", () => {
  it("management defaults to 9820 on empty / unparseable / missing / mis-tabled", () => {
    expect(parseManagementPort("")).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(parseManagementPort("this is [not toml")).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(parseManagementPort("[management]\nenabled = true\n")).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(parseManagementPort("[server]\nport = 8080\n")).toBe(CC_CONNECT_MANAGEMENT_PORT)
  })

  it("management reads a custom port from [management]", () => {
    expect(parseManagementPort('[management]\nport = 8080\ntoken = "x"\n')).toBe(8080)
  })

  it("rejects non-integer and out-of-range ports", () => {
    expect(parseManagementPort('[management]\nport = "9820"\n')).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(parseManagementPort("[management]\nport = 9820.5\n")).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(parseManagementPort("[management]\nport = 0\n")).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(parseManagementPort("[management]\nport = 70000\n")).toBe(CC_CONNECT_MANAGEMENT_PORT)
  })

  it("reads management, bridge and webhook ports independently", () => {
    const toml = "[management]\nport = 1\n[bridge]\nport = 2\n[webhook]\nport = 3\n"
    expect(parseManagementPort(toml)).toBe(1)
    expect(parseBridgePort(toml)).toBe(2)
    expect(parseWebhookPort(toml)).toBe(3)
  })

  it("bridge and webhook fall back to their documented defaults", () => {
    expect(parseBridgePort("")).toBe(CC_CONNECT_BRIDGE_PORT)
    expect(parseWebhookPort("nope [")).toBe(CC_CONNECT_WEBHOOK_PORT)
  })
})

describe("isSectionEnabled / parseManagementToken", () => {
  it("reports enabled only when enabled = true (defaults to disabled)", () => {
    expect(isSectionEnabled("", "management")).toBe(false)
    expect(isSectionEnabled("[management]\nport = 9820\n", "management")).toBe(false)
    expect(isSectionEnabled("[management]\nenabled = false\n", "management")).toBe(false)
    expect(isSectionEnabled("[management]\nenabled = true\n", "management")).toBe(true)
    expect(isSectionEnabled("[bridge]\nenabled = true\n", "bridge")).toBe(true)
  })

  it("returns the management token when set, else undefined", () => {
    expect(parseManagementToken("[management]\nenabled = true\n")).toBeUndefined()
    expect(parseManagementToken('[management]\ntoken = ""\n')).toBeUndefined()
    expect(parseManagementToken('[management]\ntoken = "abc"\n')).toBe("abc")
  })
})

describe("dashboardUrl", () => {
  it("targets localhost and appends an (encoded) token when present", () => {
    expect(dashboardUrl(9820)).toBe("http://localhost:9820")
    expect(dashboardUrl(8080)).toBe("http://localhost:8080")
    expect(dashboardUrl(9820, "sec ret")).toBe("http://localhost:9820/?token=sec%20ret")
  })
})

describe("config document round-trip", () => {
  it("parses, edits and serializes while preserving unknown keys", () => {
    const toml = [
      'language = "zh"',
      "[management]",
      "port = 9820",
      "[[projects]]",
      'name = "demo"',
      "[projects.agent]",
      'type = "claudecode"',
    ].join("\n")
    const doc = parseConfigDoc(toml)!
    const edited = setConfigValue(doc, ["management", "port"], 9999)
    const reparsed = parseConfigDoc(serializeConfigDoc(edited))!
    expect(getConfigValue(reparsed, ["management", "port"])).toBe(9999)
    expect(getConfigValue(reparsed, ["language"])).toBe("zh")
    const projects = getConfigValue(reparsed, ["projects"]) as Array<Record<string, unknown>>
    expect(projects[0].name).toBe("demo")
  })

  it("returns null on invalid TOML", () => {
    expect(parseConfigDoc("x = [")).toBeNull()
  })

  it("setConfigValue creates nested provider tables and prunes emptied ones", () => {
    const created = setConfigValue({}, ["speech", "openai", "api_key"], "sk-1")
    expect(getConfigValue(created, ["speech", "openai", "api_key"])).toBe("sk-1")
    const pruned = setConfigValue(created, ["speech", "openai", "api_key"], undefined)
    expect(pruned.speech).toBeUndefined()
    // clearing a text input (empty string) unsets the key too
    const cleared = setConfigValue(created, ["speech", "openai", "api_key"], "")
    expect(cleared.speech).toBeUndefined()
  })

  it("setConfigValue does not mutate the input doc", () => {
    const doc = parseConfigDoc("[management]\nport = 1\n")!
    setConfigValue(doc, ["management", "port"], 2)
    expect(getConfigValue(doc, ["management", "port"])).toBe(1)
  })
})

describe("provider-scoped fields", () => {
  it("resolveFieldPath substitutes the section's provider value", () => {
    const doc = parseConfigDoc('[speech]\nprovider = "groq"\n')!
    expect(resolveFieldPath(doc, ["speech", PROVIDER_TOKEN, "api_key"])).toEqual([
      "speech",
      "groq",
      "api_key",
    ])
  })

  it("resolveFieldPath returns null when the provider isn't chosen yet", () => {
    expect(resolveFieldPath({}, ["tts", PROVIDER_TOKEN, "api_key"])).toBeNull()
  })

  it("a static path resolves to itself", () => {
    expect(resolveFieldPath({}, ["management", "port"])).toEqual(["management", "port"])
  })

  it("isProviderScoped flags only $provider paths", () => {
    expect(
      isProviderScoped({
        path: ["speech", PROVIDER_TOKEN, "api_key"],
        key: "apiKey",
        type: "string",
      })
    ).toBe(true)
    expect(
      isProviderScoped({ path: ["speech", "provider"], key: "provider", type: "select" })
    ).toBe(false)
  })
})

describe("editor schema", () => {
  it("has no dangling [web] section and every field carries a path", () => {
    const keys = CONFIG_SECTIONS.map((s) => s.key)
    expect(keys).not.toContain("web")
    expect(keys).toEqual(
      expect.arrayContaining(["general", "management", "bridge", "webhook", "speech", "tts"])
    )
    for (const section of CONFIG_SECTIONS) {
      expect(section.fields.length).toBeGreaterThan(0)
      for (const f of section.fields) expect(f.path.length).toBeGreaterThan(0)
    }
  })

  it("provider-scoped credential fields live under a section with a provider selector", () => {
    for (const section of CONFIG_SECTIONS) {
      if (section.fields.some(isProviderScoped)) {
        expect(section.fields.some((f) => f.key === "provider")).toBe(true)
      }
    }
  })
})

describe("defaultConfigToml", () => {
  it("enables web admin on the management port and has no [web] section", () => {
    const toml = defaultConfigToml()
    const doc = parseConfigDoc(toml)!
    expect(getConfigValue(doc, ["management", "enabled"])).toBe(true)
    expect(getConfigValue(doc, ["management", "port"])).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(getConfigValue(doc, ["log", "level"])).toBe("info")
    expect(doc.web).toBeUndefined()
    expect(isSectionEnabled(toml, "management")).toBe(true)
  })
})
