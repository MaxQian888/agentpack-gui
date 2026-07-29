import { parse } from "smol-toml"
import { appsMissingOfficial, isOfficialConfig, officialForm } from "./official"
import { buildSettingsConfig } from "./provider"
import { claudeSettingsFromProvider, codexConfigFromProvider } from "./sync"
import type { Provider, ProviderApp } from "./types"

const officialConfig = (app: ProviderApp) => buildSettingsConfig(officialForm(app, "Official"))

const relayConfig = (app: ProviderApp) =>
  buildSettingsConfig({
    name: "Relay",
    app,
    baseUrl: "https://relay.example/v1",
    token: "sk-1",
    claudeAuthKind: "auth_token",
  })

const row = (app: ProviderApp, settings_config: string, id = "1"): Provider => ({
  id,
  app_type: app,
  name: "n",
  settings_config,
  is_current: false,
})

it("an official form overrides nothing", () => {
  expect(JSON.parse(officialConfig("claude")).env).toEqual({})
  expect(parse(JSON.parse(officialConfig("codex")).config)).toEqual({})
})

it("recognizes official vs relay configs", () => {
  for (const app of ["claude", "codex"] as const) {
    expect(isOfficialConfig(app, officialConfig(app))).toBe(true)
    expect(isOfficialConfig(app, relayConfig(app))).toBe(false)
  }
})

it("switching to official clears the claude keys agentpack manages", () => {
  const live = claudeSettingsFromProvider(
    JSON.stringify({ env: { KEEP: "1" } }),
    relayConfig("claude")
  )
  const back = JSON.parse(claudeSettingsFromProvider(live, officialConfig("claude")))
  expect(back.env).toEqual({ KEEP: "1" })
})

it("switching to official hands codex back to its built-in provider", () => {
  const live = codexConfigFromProvider('[mcp_servers.foo]\ncommand = "x"\n', relayConfig("codex"))
  const back = parse(codexConfigFromProvider(live, officialConfig("codex"))) as Record<
    string,
    unknown
  >
  expect(back["model_provider"]).toBeUndefined()
  expect(back["model_providers"]).toBeUndefined()
  // Unrelated tables survive the round trip.
  expect(back["mcp_servers"]).toBeDefined()
})

it("a token cleared in the form removes the variable rather than blanking it", () => {
  const cleared = buildSettingsConfig({
    name: "n",
    app: "claude",
    baseUrl: "https://x",
    token: "",
    claudeAuthKind: "auth_token",
  })
  expect(JSON.parse(cleared).env).toEqual({ ANTHROPIC_BASE_URL: "https://x" })
})

it("reports which apps still need an official row", () => {
  const apps = ["claude", "codex"] as const
  expect(appsMissingOfficial([], apps)).toEqual(["claude", "codex"])
  expect(appsMissingOfficial([row("claude", officialConfig("claude"))], apps)).toEqual(["codex"])
  // A relay row doesn't count as one.
  expect(appsMissingOfficial([row("codex", relayConfig("codex"))], apps)).toEqual([
    "claude",
    "codex",
  ])
})
