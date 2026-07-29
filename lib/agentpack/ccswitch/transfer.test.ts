import { parse } from "smol-toml"
import { buildSettingsConfig } from "./provider"
import { exportProviders, parseProviderBundle, planImport, redactSettingsConfig } from "./transfer"
import type { Provider, ProviderApp } from "./types"

const cfg = (app: ProviderApp, token = "sk-secret") =>
  buildSettingsConfig({
    name: "Relay",
    app,
    baseUrl: "https://relay.example/v1",
    token,
    claudeAuthKind: "auth_token",
  })

const row = (app: ProviderApp, name = "Relay", id = "1"): Provider => ({
  id,
  app_type: app,
  name,
  settings_config: cfg(app),
  is_current: false,
})

it("keeps tokens only when asked", () => {
  const providers = [row("claude")]
  expect(exportProviders(providers, { includeTokens: true })).toContain("sk-secret")
  expect(exportProviders(providers, { includeTokens: false })).not.toContain("sk-secret")
})

it("redacts every place a codex token is stored", () => {
  // The codex token lives twice over: `auth` for cc-switch, and the bearer token
  // inside the config TOML for agentpack.
  const redacted = JSON.parse(redactSettingsConfig("codex", cfg("codex")))
  expect(redacted.auth.OPENAI_API_KEY).toBe("")
  const managed = (parse(redacted.config) as { model_providers: Record<string, never> })
    .model_providers.custom as Record<string, unknown>
  expect(managed["experimental_bearer_token"]).toBe("")
  // Everything that isn't a secret survives.
  expect(managed["base_url"]).toBe("https://relay.example/v1")
})

it("redacts claude and opencode credentials in place", () => {
  const claude = JSON.parse(redactSettingsConfig("claude", cfg("claude")))
  expect(claude.env.ANTHROPIC_AUTH_TOKEN).toBe("")
  expect(claude.env.ANTHROPIC_BASE_URL).toBe("https://relay.example/v1")

  const oc = JSON.parse(redactSettingsConfig("opencode", cfg("opencode")))
  expect(oc.options.apiKey).toBe("")
  expect(oc.options.baseURL).toBe("https://relay.example/v1")
})

it("preserves hand-written fields the form doesn't model", () => {
  // Redaction rewrites the stored config in place rather than rebuilding it from
  // form fields, precisely so extras like this survive the round trip.
  const handWritten = JSON.stringify({
    env: { ANTHROPIC_AUTH_TOKEN: "sk-secret", ANTHROPIC_CUSTOM_HEADERS: "X-Key: v" },
  })
  const out = JSON.parse(redactSettingsConfig("claude", handWritten))
  expect(out.env.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Key: v")
  expect(out.env.ANTHROPIC_AUTH_TOKEN).toBe("")
})

it("drops a config it cannot inspect rather than exporting an unknown payload", () => {
  expect(redactSettingsConfig("claude", "{not json")).toBe("{}")
  const badToml = JSON.stringify({ auth: { OPENAI_API_KEY: "sk" }, config: "= = =" })
  expect(JSON.parse(redactSettingsConfig("codex", badToml)).config).toBe("")
})

it("round-trips a bundle", () => {
  const providers = [row("claude"), row("codex", "Other", "2")]
  const entries = parseProviderBundle(exportProviders(providers, { includeTokens: true }))
  expect(entries.map((e) => [e.app, e.name])).toEqual([
    ["claude", "Relay"],
    ["codex", "Other"],
  ])
})

it("skips entries an unknown or malformed file carries", () => {
  const json = JSON.stringify({
    version: 1,
    providers: [
      { app: "gemini", name: "Nope", settingsConfig: "{}" },
      { app: "claude", name: "", settingsConfig: "{}" },
      { app: "claude", name: "NoConfig" },
      { app: "claude", name: "Good", settingsConfig: "{}" },
    ],
  })
  expect(parseProviderBundle(json).map((e) => e.name)).toEqual(["Good"])
})

it("degrades to nothing on invalid input", () => {
  expect(parseProviderBundle("{not json")).toEqual([])
  expect(parseProviderBundle(JSON.stringify({ nope: 1 }))).toEqual([])
})

it("splits an import by (app, name) against what's already there", () => {
  const existing = [row("claude", "Relay")]
  const entries = parseProviderBundle(
    exportProviders([row("claude", "Relay"), row("codex", "Relay", "2")], {
      includeTokens: true,
    })
  )
  const plan = planImport(entries, existing)
  // Same name but a different app is a different provider, not a conflict.
  expect(plan.fresh.map((e) => e.app)).toEqual(["codex"])
  expect(plan.conflicts.map((c) => c.existing.id)).toEqual(["1"])
})
