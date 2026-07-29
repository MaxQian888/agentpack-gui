import { buildSettingsConfig, parseSettingsConfig } from "./provider"
import { readVisibleApps, mergeVisibleApps, DEFAULT_VISIBLE_APPS } from "./settings"
import {
  CODEX_PROVIDER_KEY,
  claudeSettingsFromProvider,
  codexConfigFromProvider,
  opencodeConfigFromProvider,
} from "./sync"
import { parse } from "smol-toml"

it("claude provider uses AUTH_TOKEN by default", () => {
  const json = JSON.parse(
    buildSettingsConfig({
      name: "n",
      app: "claude",
      baseUrl: "https://b",
      token: "t",
      claudeAuthKind: "auth_token",
    })
  )
  expect(json.env.ANTHROPIC_AUTH_TOKEN).toBe("t")
  expect(json.env.ANTHROPIC_BASE_URL).toBe("https://b")
})

it("codex provider embeds OPENAI_API_KEY + TOML config", () => {
  const json = JSON.parse(
    buildSettingsConfig({
      name: "n",
      app: "codex",
      baseUrl: "https://b/v1",
      token: "sk",
      claudeAuthKind: "auth_token",
    })
  )
  expect(json.auth.OPENAI_API_KEY).toBe("sk")
  expect(json.config).toContain("model_provider")
})

it("visibleApps round-trips and defaults missing keys to true", () => {
  expect(readVisibleApps("").claude).toBe(true)
  const merged = mergeVisibleApps("", DEFAULT_VISIBLE_APPS)
  expect(JSON.parse(merged).visibleApps.gemini).toBe(false)
  expect(JSON.parse(merged).visibleApps.claude).toBe(true)
})

it("claude provider uses ANTHROPIC_API_KEY for api_key auth and includes the model", () => {
  const json = JSON.parse(
    buildSettingsConfig({
      name: "n",
      app: "claude",
      baseUrl: "https://b",
      token: "t",
      claudeAuthKind: "api_key",
      model: "opus",
    })
  )
  expect(json.env.ANTHROPIC_API_KEY).toBe("t")
  expect(json.env.ANTHROPIC_MODEL).toBe("opus")
})

it("codex provider embeds the model when provided", () => {
  const json = JSON.parse(
    buildSettingsConfig({
      name: "n",
      app: "codex",
      baseUrl: "https://b/v1",
      token: "sk",
      claudeAuthKind: "auth_token",
      model: "gpt-5",
    })
  )
  expect(json.config).toContain("gpt-5")
})

it("readVisibleApps honors explicit false and falls back when corrupt", () => {
  const explicit = readVisibleApps(JSON.stringify({ visibleApps: { claude: false } }))
  expect(explicit.claude).toBe(false)
  // codex absent → defaults to shown
  expect(explicit.codex).toBe(true)
  // unparsable settings → all shown
  expect(readVisibleApps("{ not json").claude).toBe(true)
})

it("mergeVisibleApps preserves other fields in settings.json", () => {
  const out = JSON.parse(mergeVisibleApps(JSON.stringify({ theme: "dark" }), DEFAULT_VISIBLE_APPS))
  expect(out.theme).toBe("dark")
  expect(out.visibleApps.codex).toBe(true)
})

it("parseSettingsConfig round-trips a claude auth_token provider", () => {
  const config = buildSettingsConfig({
    name: "n",
    app: "claude",
    baseUrl: "https://b",
    token: "tok",
    claudeAuthKind: "auth_token",
    model: "sonnet",
  })
  expect(parseSettingsConfig("claude", config)).toEqual({
    baseUrl: "https://b",
    token: "tok",
    claudeAuthKind: "auth_token",
    model: "sonnet",
  })
})

it("parseSettingsConfig detects the api_key auth kind", () => {
  const config = buildSettingsConfig({
    name: "n",
    app: "claude",
    baseUrl: "https://b",
    token: "key",
    claudeAuthKind: "api_key",
  })
  const parsed = parseSettingsConfig("claude", config)
  expect(parsed.claudeAuthKind).toBe("api_key")
  expect(parsed.token).toBe("key")
  expect(parsed.model).toBeUndefined()
})

it("parseSettingsConfig round-trips a codex provider", () => {
  const config = buildSettingsConfig({
    name: "n",
    app: "codex",
    baseUrl: "https://b/v1",
    token: "sk",
    claudeAuthKind: "auth_token",
    model: "gpt-5",
  })
  expect(parseSettingsConfig("codex", config)).toMatchObject({
    baseUrl: "https://b/v1",
    token: "sk",
    model: "gpt-5",
  })
})

it("parseSettingsConfig tolerates malformed settings_config", () => {
  expect(parseSettingsConfig("claude", "{ not json")).toEqual({
    baseUrl: "",
    token: "",
    claudeAuthKind: "auth_token",
    model: undefined,
  })
})

it("claudeSettingsFromProvider merges provider env and preserves other keys", () => {
  const cfg = buildSettingsConfig({
    name: "n",
    app: "claude",
    baseUrl: "https://b",
    token: "tok",
    claudeAuthKind: "auth_token",
  })
  const existing = JSON.stringify({ env: { FOO: "bar" }, theme: "dark" })
  const out = JSON.parse(claudeSettingsFromProvider(existing, cfg))
  expect(out.env.ANTHROPIC_AUTH_TOKEN).toBe("tok")
  expect(out.env.ANTHROPIC_BASE_URL).toBe("https://b")
  expect(out.env.FOO).toBe("bar") // unrelated env preserved
  expect(out.theme).toBe("dark") // unrelated top-level field preserved
})

it("claudeSettingsFromProvider clears stale api_key when switching to auth_token", () => {
  const cfg = buildSettingsConfig({
    name: "n",
    app: "claude",
    baseUrl: "https://b",
    token: "tok",
    claudeAuthKind: "auth_token",
  })
  const existing = JSON.stringify({ env: { ANTHROPIC_API_KEY: "old-key" } })
  const out = JSON.parse(claudeSettingsFromProvider(existing, cfg))
  expect(out.env.ANTHROPIC_API_KEY).toBeUndefined()
  expect(out.env.ANTHROPIC_AUTH_TOKEN).toBe("tok")
})

it("claudeSettingsFromProvider leaves the config untouched on malformed input", () => {
  const existing = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "keep" } })
  expect(claudeSettingsFromProvider(existing, "{ not json")).toBe(existing)
})

it("codexConfigFromProvider merges the provider TOML and preserves other tables", () => {
  const cfg = buildSettingsConfig({
    name: "prov",
    app: "codex",
    baseUrl: "https://b/v1",
    token: "sk",
    claudeAuthKind: "auth_token",
    model: "gpt-5",
  })
  const existing = 'model_provider = "old"\n[mcp_servers.keep]\ncommand = "x"\n'
  const out = parse(codexConfigFromProvider(existing, cfg)) as {
    model_provider?: string
    model?: string
    model_providers?: { custom?: { base_url?: string } }
    mcp_servers?: { keep?: unknown }
  }
  expect(out.model_provider).toBe("custom")
  expect(out.model).toBe("gpt-5")
  expect(out.model_providers?.custom?.base_url).toBe("https://b/v1")
  expect(out.mcp_servers?.keep).toBeDefined() // unrelated table preserved
})

it("codexConfigFromProvider clears a stale model when the provider pins none", () => {
  const cfg = buildSettingsConfig({
    name: "prov",
    app: "codex",
    baseUrl: "https://b/v1",
    token: "sk",
    claudeAuthKind: "auth_token",
    // no model
  })
  const existing = 'model = "left-by-previous-provider"\nmodel_provider = "old"\n'
  const out = parse(codexConfigFromProvider(existing, cfg)) as { model?: string }
  expect(out.model).toBeUndefined()
})

const codexCfg = (token: string, baseUrl = "https://b/v1") =>
  buildSettingsConfig({
    name: "n",
    app: "codex",
    baseUrl,
    token,
    claudeAuthKind: "auth_token",
  })

it("codex provider carries the token as a bearer token, not an OpenAI login", () => {
  const out = parse(codexConfigFromProvider("", codexCfg("sk-123"))) as {
    model_providers?: Record<string, Record<string, unknown>>
  }
  const managed = out.model_providers?.[CODEX_PROVIDER_KEY]
  expect(managed?.["experimental_bearer_token"]).toBe("sk-123")
  // The bearer token authenticates the relay, so codex must not also demand an
  // OpenAI login for it (which would bounce the user to a login screen).
  expect(managed?.["requires_openai_auth"]).toBe(false)
})

it("round-trips the codex token back into the edit form", () => {
  expect(parseSettingsConfig("codex", codexCfg("sk-123")).token).toBe("sk-123")
})

it("still reads a codex token written by cc-switch (auth.OPENAI_API_KEY only)", () => {
  // cc-switch writes the key into `auth` and no bearer token; agentpack has to
  // echo that back into the form rather than showing an empty token field.
  const ccSwitchRow = JSON.stringify({
    auth: { OPENAI_API_KEY: "sk-from-ccswitch" },
    config: 'model_provider = "custom"\n\n[model_providers.custom]\nbase_url = "https://b/v1"\n',
  })
  const form = parseSettingsConfig("codex", ccSwitchRow)
  expect(form.token).toBe("sk-from-ccswitch")
  expect(form.baseUrl).toBe("https://b/v1")
})

it("an official-login codex provider drops the relay provider and selector", () => {
  const existing = codexConfigFromProvider("", codexCfg("sk-123"))
  const official = JSON.stringify({ config: "" })
  const out = parse(codexConfigFromProvider(existing, official)) as Record<string, unknown>
  expect(out["model_provider"]).toBeUndefined()
  expect(out["model_providers"]).toBeUndefined()
})

it("cleans up the provider table the removed relay card used to write", () => {
  const legacy =
    'model_provider = "agentpack"\n\n[model_providers.agentpack]\nbase_url = "https://old"\n'
  const out = parse(codexConfigFromProvider(legacy, codexCfg("sk-123"))) as {
    model_provider?: string
    model_providers?: Record<string, unknown>
  }
  expect(out.model_providers?.["agentpack"]).toBeUndefined()
  expect(out.model_provider).toBe(CODEX_PROVIDER_KEY)
})

const opencodeCfg = (over: Partial<Parameters<typeof buildSettingsConfig>[0]> = {}) =>
  buildSettingsConfig({
    name: "Relay",
    app: "opencode",
    baseUrl: "https://b/v1",
    token: "sk-1",
    claudeAuthKind: "auth_token",
    ...over,
  })

it("opencode provider uses the openai-compatible SDK package", () => {
  const cfg = JSON.parse(opencodeCfg())
  expect(cfg.npm).toBe("@ai-sdk/openai-compatible")
  expect(cfg.options).toEqual({ baseURL: "https://b/v1", apiKey: "sk-1" })
})

it("opencode round-trips back into the edit form", () => {
  const form = parseSettingsConfig("opencode", opencodeCfg({ model: "gpt-5.2" }))
  expect(form).toMatchObject({ baseUrl: "https://b/v1", token: "sk-1", model: "gpt-5.2" })
})

it("opencode sync writes provider.custom and the model selector", () => {
  const out = JSON.parse(opencodeConfigFromProvider("", opencodeCfg({ model: "gpt-5.2" })))
  expect(out.provider.custom.options.baseURL).toBe("https://b/v1")
  // OpenCode selects a model as "<providerId>/<modelId>".
  expect(out.model).toBe("custom/gpt-5.2")
})

it("opencode sync preserves mcp servers and the user's other providers", () => {
  const existing = JSON.stringify({
    mcp: { foo: { type: "local" } },
    provider: { mine: { npm: "x" } },
  })
  const out = JSON.parse(opencodeConfigFromProvider(existing, opencodeCfg()))
  expect(out.mcp.foo).toBeDefined()
  expect(out.provider.mine).toBeDefined()
  expect(out.provider.custom).toBeDefined()
})

it("an official-login opencode provider drops the entry and the selector", () => {
  const live = opencodeConfigFromProvider("", opencodeCfg({ model: "gpt-5.2" }))
  const official = buildSettingsConfig({
    name: "Official",
    app: "opencode",
    baseUrl: "",
    token: "",
    claudeAuthKind: "auth_token",
  })
  const out = JSON.parse(opencodeConfigFromProvider(live, official))
  expect(out.provider).toBeUndefined()
  expect(out.model).toBeUndefined()
})

it("switching to an opencode provider with no model clears a stale selection", () => {
  const live = opencodeConfigFromProvider("", opencodeCfg({ model: "old-model" }))
  const out = JSON.parse(opencodeConfigFromProvider(live, opencodeCfg()))
  expect(out.model).toBeUndefined()
  expect(out.provider.custom).toBeDefined()
})

it("keeps unrelated codex tables and providers intact", () => {
  const existing =
    '[mcp_servers.foo]\ncommand = "x"\n\n[model_providers.other]\nbase_url = "https://other"\n'
  const out = parse(codexConfigFromProvider(existing, codexCfg("sk-123"))) as {
    mcp_servers?: Record<string, unknown>
    model_providers?: Record<string, unknown>
  }
  expect(out.mcp_servers?.["foo"]).toBeDefined()
  expect(out.model_providers?.["other"]).toBeDefined()
})
