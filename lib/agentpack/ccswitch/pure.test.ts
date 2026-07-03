import { buildSettingsConfig, parseSettingsConfig } from "./provider"
import { readVisibleApps, mergeVisibleApps, DEFAULT_VISIBLE_APPS } from "./settings"
import { claudeSettingsFromProvider, codexAuthFromProvider, codexConfigFromProvider } from "./sync"
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

it("codexAuthFromProvider writes OPENAI_API_KEY and preserves other keys", () => {
  const cfg = buildSettingsConfig({
    name: "n",
    app: "codex",
    baseUrl: "https://b/v1",
    token: "sk-123",
    claudeAuthKind: "auth_token",
  })
  const out = JSON.parse(codexAuthFromProvider(JSON.stringify({ other: 1 }), cfg))
  expect(out.OPENAI_API_KEY).toBe("sk-123")
  expect(out.other).toBe(1)
})
