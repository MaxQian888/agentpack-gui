import {
  CC_CONNECT_BRIDGE_PORT,
  CC_CONNECT_MANAGEMENT_PORT,
  CC_CONNECT_WEBHOOK_PORT,
  CONFIG_SECTIONS,
  PROVIDER_TOKEN,
  countProjects,
  dashboardUrl,
  defaultConfigToml,
  ensureWebAdmin,
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
  summarizeConfig,
} from "./ccconnect"

describe("config summary", () => {
  it("extracts counts, agent types, ports and enabled states without exposing tokens", () => {
    const summary = summarizeConfig(`
[management]
enabled = true
port = 8080
token = "top-secret"
[bridge]
enabled = false
port = 8181
token = "bridge-secret"
[[projects]]
name = "one"
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "slack"
[[projects.platforms]]
type = "feishu"
`)
    expect(summary).toEqual({
      projectCount: 1,
      platformCount: 2,
      agentTypes: ["codex"],
      management: { port: 8080, enabled: true },
      bridge: { port: 8181, enabled: false },
      webhook: { port: CC_CONNECT_WEBHOOK_PORT, enabled: false },
    })
    expect(JSON.stringify(summary)).not.toContain("secret")
  })
})

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
    expect(dashboardUrl(9820, "sec ret")).toBe("http://localhost:9820/login?token=sec%20ret")
  })

  it("puts the token on /login — the only route that reads it", () => {
    // The dashboard's index is behind an auth guard that redirects to /login
    // without the query string, so `/?token=` silently loses the token and
    // strands the user on the login form. Verified against cc-connect v1.4.1.
    const url = new URL(dashboardUrl(9820, "abc"))
    expect(url.pathname).toBe("/login")
    expect(url.searchParams.get("token")).toBe("abc")
  })
})

describe("countProjects", () => {
  it("counts [[projects]] entries", () => {
    expect(countProjects('[[projects]]\nname = "a"\n[[projects]]\nname = "b"\n')).toBe(2)
    expect(countProjects('[[projects]]\nname = "a"\n')).toBe(1)
  })

  it("reads zero for empty, projectless and unparseable configs", () => {
    // Zero is the number that matters: cc-connect refuses such a config during
    // validation and exits before binding the management port.
    expect(countProjects("")).toBe(0)
    expect(countProjects("[management]\nenabled = true\n")).toBe(0)
    expect(countProjects("broken = [")).toBe(0)
  })

  it("ignores a `projects` key that isn't an array of tables", () => {
    expect(countProjects('projects = "one"\n')).toBe(0)
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

  it("offers no key that cc-connect reads per-project rather than globally", () => {
    // These live on [[projects]] in upstream's config.go. Written at the top
    // level they parse fine and are silently ignored, so the form would report a
    // setting as in effect when nothing reads it.
    const projectScoped = ["reset_on_idle_mins", "agent_session_idle_timeout_mins"]
    const paths = CONFIG_SECTIONS.flatMap((s) => s.fields.map((f) => f.path.join(".")))
    for (const key of projectScoped) expect(paths).not.toContain(key)
  })

  it("field keys are unique, so one flat i18n label map can serve them", () => {
    const keys = CONFIG_SECTIONS.flatMap((s) => s.fields.map((f) => f.key))
    // The same key may repeat across sections (`enabled`, `port`, `token`) — it
    // is one label. What must not happen is two *different* meanings sharing one.
    const byKey = new Map<string, Set<string>>()
    for (const s of CONFIG_SECTIONS) {
      for (const f of s.fields) {
        if (!byKey.has(f.key)) byKey.set(f.key, new Set())
        byKey.get(f.key)!.add(f.path[f.path.length - 1])
      }
    }
    for (const [key, leaves] of byKey) {
      expect([key, [...leaves]]).toEqual([key, [...leaves].slice(0, 1)])
    }
    expect(keys.length).toBeGreaterThan(0)
  })
})

describe("defaultConfigToml", () => {
  it("enables web admin on the management port and has no [web] section", () => {
    const toml = defaultConfigToml()
    const doc = parseConfigDoc(toml)!
    expect(getConfigValue(doc, ["management", "enabled"])).toBe(true)
    expect(getConfigValue(doc, ["management", "port"])).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(getConfigValue(doc, ["management", "cors_origins"])).toEqual(["*"])
    expect(getConfigValue(doc, ["log", "level"])).toBe("info")
    expect(doc.web).toBeUndefined()
    expect(isSectionEnabled(toml, "management")).toBe(true)
  })

  it("enables the bridge too, so the dashboard's bridge surfaces work", () => {
    const toml = defaultConfigToml()
    expect(isSectionEnabled(toml, "bridge")).toBe(true)
    expect(getConfigValue(parseConfigDoc(toml)!, ["bridge", "port"])).toBe(CC_CONNECT_BRIDGE_PORT)
  })

  it("declares a project with a platform — without one cc-connect won't start", () => {
    const doc = parseConfigDoc(defaultConfigToml())!
    expect(countProjects(defaultConfigToml())).toBe(1)
    const projects = getConfigValue(doc, ["projects"]) as Array<Record<string, unknown>>
    expect(projects[0].name).toBeTruthy()
    expect(getConfigValue(projects[0], ["agent", "type"])).toBeTruthy()
    const platforms = projects[0].platforms as Array<Record<string, unknown>>
    expect(platforms).toHaveLength(1)
    expect(platforms[0].type).toBeTruthy()
  })
})

describe("ensureWebAdmin", () => {
  const TOKENS = { management: "tok123", bridge: "btok" }

  it("enables management with the given token + cors on an empty doc", () => {
    const { doc, token, changed } = ensureWebAdmin({}, TOKENS)
    expect(changed).toBe(true)
    expect(token).toBe("tok123")
    expect(getConfigValue(doc, ["management", "enabled"])).toBe(true)
    expect(getConfigValue(doc, ["management", "port"])).toBe(CC_CONNECT_MANAGEMENT_PORT)
    expect(getConfigValue(doc, ["management", "token"])).toBe("tok123")
    expect(getConfigValue(doc, ["management", "cors_origins"])).toEqual(["*"])
  })

  it("enables the bridge half too, mirroring upstream EnableWebAdmin", () => {
    const { doc } = ensureWebAdmin({}, TOKENS)
    expect(getConfigValue(doc, ["bridge", "enabled"])).toBe(true)
    expect(getConfigValue(doc, ["bridge", "port"])).toBe(CC_CONNECT_BRIDGE_PORT)
    expect(getConfigValue(doc, ["bridge", "cors_origins"])).toEqual(["*"])
  })

  it("gives the bridge its own token, never the one handed to the browser", () => {
    const { doc, token } = ensureWebAdmin({}, TOKENS)
    expect(getConfigValue(doc, ["bridge", "token"])).toBe("btok")
    expect(getConfigValue(doc, ["bridge", "token"])).not.toBe(token)
  })

  it("keeps existing tokens (never rotates) and reports no change", () => {
    const base = parseConfigDoc(
      '[management]\nenabled = true\nport = 8080\ntoken = "keep"\ncors_origins = ["*"]\n' +
        '[bridge]\nenabled = true\nport = 9810\ntoken = "bkeep"\ncors_origins = ["*"]\n'
    )!
    const { doc, token, changed } = ensureWebAdmin(base, { management: "new", bridge: "bnew" })
    expect(token).toBe("keep")
    expect(changed).toBe(false)
    expect(getConfigValue(doc, ["management", "port"])).toBe(8080)
    expect(getConfigValue(doc, ["bridge", "token"])).toBe("bkeep")
  })

  it("backfills only the missing pieces (enabled but tokenless)", () => {
    const base = parseConfigDoc("[management]\nenabled = true\nport = 9820\n")!
    const { doc, token, changed } = ensureWebAdmin(base, { management: "gen", bridge: "bgen" })
    expect(changed).toBe(true)
    expect(token).toBe("gen")
    expect(getConfigValue(doc, ["management", "token"])).toBe("gen")
    expect(getConfigValue(doc, ["management", "cors_origins"])).toEqual(["*"])
  })

  it("repairs an enabled-but-tokenless bridge, which cc-connect would refuse", () => {
    // "bridge: token is required when insecure mode is not enabled" — upstream's
    // own EnableWebAdmin skips an already-enabled section and leaves this broken.
    const base = parseConfigDoc("[bridge]\nenabled = true\nport = 9810\n")!
    const { doc } = ensureWebAdmin(base, { management: "m", bridge: "b" })
    expect(getConfigValue(doc, ["bridge", "token"])).toBe("b")
  })

  it("does not mutate the input doc", () => {
    const base = parseConfigDoc("[management]\nport = 1\n")!
    ensureWebAdmin(base, { management: "x", bridge: "y" })
    expect(getConfigValue(base, ["management", "enabled"])).toBeUndefined()
    expect(getConfigValue(base, ["management", "token"])).toBeUndefined()
    expect(base.bridge).toBeUndefined()
  })

  it("leaves [[projects]] alone — enabling web admin is not enough to start", () => {
    const base = parseConfigDoc('[[projects]]\nname = "keep"\n')!
    const { doc } = ensureWebAdmin(base, TOKENS)
    expect(countProjects(serializeConfigDoc(doc))).toBe(1)
  })
})
