import { buildSettingsConfig } from "./provider"
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
