import { buildSettingsConfig, parseSettingsConfig } from "./provider"
import { readVisibleApps, mergeVisibleApps, DEFAULT_VISIBLE_APPS } from "./settings"

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
