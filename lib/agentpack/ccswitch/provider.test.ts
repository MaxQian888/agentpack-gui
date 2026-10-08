import { parse } from "smol-toml"
import { buildSettingsConfig, parseSettingsConfig } from "./provider"
import { CODEX_PROVIDER_KEY, OPENCODE_NPM } from "./sync"
import type { ProviderApp, ProviderForm } from "./types"

type Toml = {
  model?: string
  model_provider?: string
  model_providers?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

const form = (app: ProviderApp, over: Partial<ProviderForm> = {}): ProviderForm => ({
  name: "Relay",
  app,
  baseUrl: "https://new",
  token: "sk-new",
  claudeAuthKind: "auth_token",
  ...over,
})

/** Edit a stored row: the stored config rides in `baseSettingsConfig`. */
const edit = (app: ProviderApp, stored: unknown, over: Partial<ProviderForm> = {}) =>
  JSON.parse(
    buildSettingsConfig(
      form(app, {
        ...over,
        baseSettingsConfig: typeof stored === "string" ? stored : JSON.stringify(stored),
      })
    )
  )

describe("a stored config that can't be merged into falls back to a fresh build", () => {
  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON array", "[1,2]"],
    ["JSON null", "null"],
    ["an empty object", "{}"],
  ])("treats %s as no stored row", (_label, stored) => {
    expect(edit("claude", stored)).toEqual({
      env: { ANTHROPIC_AUTH_TOKEN: "sk-new", ANTHROPIC_BASE_URL: "https://new" },
    })
  })

  it("rebuilds a codex row whose stored TOML does not parse, rather than dropping fields", () => {
    const out = edit("codex", { auth: { OPENAI_API_KEY: "sk" }, config: "[[broken" })
    const config = parse(out.config) as Toml
    expect(config.model_provider).toBe(CODEX_PROVIDER_KEY)
    expect(config.model_providers?.[CODEX_PROVIDER_KEY]).toMatchObject({
      name: "Relay",
      base_url: "https://new",
      experimental_bearer_token: "sk-new",
    })
    expect(out.auth).toEqual({ OPENAI_API_KEY: "sk-new" })
  })
})

describe("claude edits", () => {
  it("starts an env block when the stored one is missing or not an object", () => {
    expect(edit("claude", { permissions: { allow: [] }, env: "oops" })).toEqual({
      permissions: { allow: [] },
      env: { ANTHROPIC_AUTH_TOKEN: "sk-new", ANTHROPIC_BASE_URL: "https://new" },
    })
  })

  it("switching to api_key drops the old auth token and clearing the model removes it", () => {
    const out = edit(
      "claude",
      { env: { ANTHROPIC_AUTH_TOKEN: "sk-old", ANTHROPIC_MODEL: "opus", KEEP: "1" } },
      { claudeAuthKind: "api_key", model: "" }
    )
    expect(out.env).toEqual({
      ANTHROPIC_API_KEY: "sk-new",
      ANTHROPIC_BASE_URL: "https://new",
      KEEP: "1",
    })
  })
})

describe("opencode edits", () => {
  it("restores the SDK package when the stored one is missing, keeps it when present", () => {
    expect(edit("opencode", { name: "Old" }).npm).toBe(OPENCODE_NPM)
    expect(edit("opencode", { npm: "@ai-sdk/anthropic", name: "Old" }).npm).toBe(
      "@ai-sdk/anthropic"
    )
  })

  it("replaces a non-object options value and renames the row", () => {
    const out = edit("opencode", { npm: "x", name: "Old", options: "bad" })
    expect(out.name).toBe("Relay")
    expect(out.options).toEqual({ baseURL: "https://new", apiKey: "sk-new" })
  })

  it("clearing only the endpoint keeps the row a relay with just its key", () => {
    const tokenOnly = edit(
      "opencode",
      { npm: "x", options: { baseURL: "https://old", apiKey: "sk-old" } },
      { baseUrl: "" }
    )
    expect(tokenOnly.options).toEqual({ apiKey: "sk-new" })
  })

  it("moves the selected model to the front and keeps the rest of the map", () => {
    const out = edit(
      "opencode",
      { npm: "x", models: { a: { name: "A" }, b: { name: "B" }, c: {} } },
      { model: "b" }
    )
    expect(Object.keys(out.models)).toEqual(["b", "c"])
    expect(out.models.b).toEqual({ name: "B" })
  })

  it("adds an unseen model as an empty entry", () => {
    const out = edit("opencode", { npm: "x", models: "bad" }, { model: "fresh" })
    expect(out.models).toEqual({ fresh: {} })
  })

  it("clearing the model removes only the first key, and the map when it was the only one", () => {
    expect(
      edit("opencode", { npm: "x", models: { a: {}, b: {} } }, { model: undefined }).models
    ).toEqual({ b: {} })
    expect(edit("opencode", { npm: "x", models: { a: {} } }, { model: "" })).not.toHaveProperty(
      "models"
    )
  })
})

describe("codex edits", () => {
  it("treats a missing or blank config string as an empty TOML document", () => {
    for (const stored of [{ auth: {} }, { auth: {}, config: "   " }, { config: 42 }]) {
      const out = edit("codex", stored)
      const config = parse(out.config) as Toml
      expect(config.model_provider).toBe(CODEX_PROVIDER_KEY)
      expect(config.model_providers?.[CODEX_PROVIDER_KEY]).toEqual({
        name: "Relay",
        base_url: "https://new",
        wire_api: "responses",
        experimental_bearer_token: "sk-new",
        requires_openai_auth: false,
      })
    }
  })

  it("falls back to the custom table when the selector names a table that does not exist", () => {
    const out = edit("codex", { config: 'model_provider = "ghost"\n' })
    const config = parse(out.config) as Toml
    expect(config.model_provider).toBe(CODEX_PROVIDER_KEY)
    expect(config.model_providers?.["ghost"]).toBeUndefined()
  })

  it("keeps a named table's own name and wire_api, and drops the bearer when the token goes", () => {
    const stored = {
      auth: { OPENAI_API_KEY: "sk-old", OTHER: "1" },
      config: [
        'model_provider = "packy"',
        "[model_providers.packy]",
        'name = "Packy"',
        'base_url = "https://old"',
        'wire_api = "chat"',
        'experimental_bearer_token = "sk-old"',
        "",
      ].join("\n"),
    }
    const out = edit("codex", stored, { token: "" })
    const table = (parse(out.config) as Toml).model_providers?.["packy"]
    expect(table).toEqual({ name: "Packy", base_url: "https://new", wire_api: "chat" })
    // The cc-switch copy of the key goes with it; unrelated auth keys stay.
    expect(out.auth).toEqual({ OTHER: "1" })
  })

  it("renames the custom table to the form's name, since agentpack owns it", () => {
    const out = edit("codex", {
      config: '[model_providers.custom]\nname = "Old"\nbase_url = "https://old"\n',
    })
    expect((parse(out.config) as Toml).model_providers?.[CODEX_PROVIDER_KEY]?.name).toBe("Relay")
  })

  it("clearing the endpoint removes only the selected table and keeps the user's others", () => {
    const stored = {
      auth: "not-an-object",
      config: [
        'model_provider = "packy"',
        'model = "gpt-5"',
        "[model_providers.packy]",
        'base_url = "https://old"',
        "[model_providers.mine]",
        'base_url = "https://mine"',
        "",
      ].join("\n"),
    }
    const out = edit("codex", stored, { baseUrl: "", token: "", model: "gpt-5" })
    const config = parse(out.config) as Toml
    expect(config.model_provider).toBeUndefined()
    expect(config.model_providers).toEqual({ mine: { base_url: "https://mine" } })
    expect(config.model).toBe("gpt-5")
    expect(out.auth).toEqual({})
  })

  it("leaves a selector pointing elsewhere alone when the endpoint is cleared", () => {
    const stored = {
      config: 'model_provider = "openai"\n[model_providers.custom]\nbase_url = "https://old"\n',
    }
    const config = parse(edit("codex", stored, { baseUrl: "", token: "" }).config) as Toml
    expect(config.model_provider).toBe("openai")
    expect(config.model_providers).toBeUndefined()
  })
})

describe("parseSettingsConfig on stored shapes it did not write", () => {
  it.each(["null", "42", '"text"', "{nope"])("returns empty fields for %s", (text) => {
    for (const app of ["claude", "codex", "opencode"] as const) {
      expect(parseSettingsConfig(app, text)).toEqual({
        baseUrl: "",
        token: "",
        claudeAuthKind: "auth_token",
        model: undefined,
      })
    }
  })

  it("ignores non-string claude env values and tolerates a missing env", () => {
    expect(
      parseSettingsConfig(
        "claude",
        JSON.stringify({ env: { ANTHROPIC_API_KEY: 1, ANTHROPIC_BASE_URL: ["x"] } })
      )
    ).toMatchObject({ token: "", baseUrl: "", claudeAuthKind: "auth_token" })
    expect(parseSettingsConfig("claude", "{}").token).toBe("")
  })

  it("reads an opencode row with no models, or non-string options", () => {
    expect(
      parseSettingsConfig("opencode", JSON.stringify({ options: { baseURL: 1, apiKey: "k" } }))
    ).toMatchObject({ baseUrl: "", token: "k", model: undefined })
    expect(parseSettingsConfig("opencode", JSON.stringify({ models: {} })).model).toBeUndefined()
  })

  it("keeps the cc-switch token when the codex TOML is malformed", () => {
    const parsed = parseSettingsConfig(
      "codex",
      JSON.stringify({ auth: { OPENAI_API_KEY: "sk-cc" }, config: "[[broken" })
    )
    expect(parsed).toMatchObject({ token: "sk-cc", baseUrl: "", model: undefined })
  })

  it("reads a codex row with a non-string config and no auth", () => {
    expect(parseSettingsConfig("codex", JSON.stringify({ config: 5 }))).toMatchObject({
      token: "",
      baseUrl: "",
    })
  })

  it("ignores non-string fields inside the codex provider table", () => {
    const config =
      'model = 3\nmodel_provider = "custom"\n[model_providers.custom]\nbase_url = 1\nexperimental_bearer_token = 2\n'
    expect(
      parseSettingsConfig("codex", JSON.stringify({ auth: { OPENAI_API_KEY: "sk" }, config }))
    ).toMatchObject({ baseUrl: "", token: "sk", model: undefined })
  })
})
