import { detectUnmanagedProviders } from "./import"
import { buildSettingsConfig } from "./provider"
import { claudeSettingsFromProvider, codexConfigFromProvider } from "./sync"
import type { Provider, ProviderForm } from "./types"

const form = (over: Partial<ProviderForm>): ProviderForm => ({
  name: "n",
  app: "claude",
  baseUrl: "https://relay.example/v1",
  token: "sk-1",
  claudeAuthKind: "auth_token",
  ...over,
})

const row = (over: Partial<Provider> & { settings_config: string }): Provider => ({
  id: "1",
  app_type: "claude",
  name: "n",
  is_current: false,
  ...over,
})

const empty = { claudeSettings: "", codexConfig: "", providers: [] }

it("finds nothing in empty configs", () => {
  expect(detectUnmanagedProviders(empty)).toEqual([])
})

it("adopts a claude endpoint configured by hand", () => {
  const claudeSettings = JSON.stringify({
    env: { ANTHROPIC_BASE_URL: "https://hand.example", ANTHROPIC_AUTH_TOKEN: "sk-hand" },
  })
  const found = detectUnmanagedProviders({ ...empty, claudeSettings })
  expect(found).toHaveLength(1)
  expect(found[0].app).toBe("claude")
  expect(found[0].form).toMatchObject({
    baseUrl: "https://hand.example",
    token: "sk-hand",
    claudeAuthKind: "auth_token",
    name: "hand.example",
  })
})

it("carries the api_key auth kind through rather than defaulting", () => {
  const claudeSettings = JSON.stringify({
    env: { ANTHROPIC_BASE_URL: "https://x.example", ANTHROPIC_API_KEY: "sk-k" },
  })
  const [found] = detectUnmanagedProviders({ ...empty, claudeSettings })
  expect(found.form.claudeAuthKind).toBe("api_key")
  expect(found.form.token).toBe("sk-k")
})

it("ignores a claude config with no relay endpoint", () => {
  // A plain proxy setup is not a relay and must not be offered as a provider.
  const claudeSettings = JSON.stringify({ env: { HTTP_PROXY: "http://127.0.0.1:7890" } })
  expect(detectUnmanagedProviders({ ...empty, claudeSettings })).toEqual([])
})

it("adopts the provider table the removed relay card used to write", () => {
  const codexConfig =
    'model_provider = "agentpack"\n\n[model_providers.agentpack]\n' +
    'name = "agentpack relay"\nbase_url = "https://old.example/v1"\nenv_key = "AGENTPACK_API_KEY"\n'
  const found = detectUnmanagedProviders({ ...empty, codexConfig })
  expect(found).toHaveLength(1)
  expect(found[0].form).toMatchObject({ app: "codex", baseUrl: "https://old.example/v1" })
  // That path never wrote the token anywhere readable, so the user re-enters it.
  expect(found[0].form.token).toBe("")
})

it("adopts a hand-rolled codex provider under any table name", () => {
  const codexConfig =
    'model_provider = "mine"\nmodel = "gpt-5.2"\n\n[model_providers.mine]\n' +
    'base_url = "https://mine.example/v1"\n'
  const [found] = detectUnmanagedProviders({ ...empty, codexConfig })
  expect(found.form).toMatchObject({ name: "mine", baseUrl: "https://mine.example/v1" })
  expect(found.form.model).toBe("gpt-5.2")
})

it("skips endpoints a provider row already covers", () => {
  const claudeForm = form({ app: "claude", baseUrl: "https://relay.example" })
  const codexForm = form({ app: "codex", baseUrl: "https://relay.example/v1" })
  const providers = [
    row({ app_type: "claude", settings_config: buildSettingsConfig(claudeForm) }),
    row({ id: "2", app_type: "codex", settings_config: buildSettingsConfig(codexForm) }),
  ]
  // Exactly the live config those two rows produce — nothing is unmanaged.
  const claudeSettings = claudeSettingsFromProvider("", buildSettingsConfig(claudeForm))
  const codexConfig = codexConfigFromProvider("", buildSettingsConfig(codexForm))
  expect(detectUnmanagedProviders({ claudeSettings, codexConfig, providers })).toEqual([])
})

it("matches endpoints ignoring trailing slash and host case", () => {
  const providers = [
    row({ settings_config: buildSettingsConfig(form({ baseUrl: "https://Relay.Example/v1/" })) }),
  ]
  const claudeSettings = JSON.stringify({
    env: { ANTHROPIC_BASE_URL: "https://relay.example/v1", ANTHROPIC_AUTH_TOKEN: "t" },
  })
  expect(detectUnmanagedProviders({ ...empty, claudeSettings, providers })).toEqual([])
})

it("still offers an endpoint a row for the other app covers", () => {
  // The same relay used by both CLIs needs one row per app; having the claude
  // row must not hide the codex one.
  const providers = [
    row({ settings_config: buildSettingsConfig(form({ baseUrl: "https://both.example/v1" })) }),
  ]
  const codexConfig = '[model_providers.custom]\nbase_url = "https://both.example/v1"\n'
  const found = detectUnmanagedProviders({ ...empty, codexConfig, providers })
  expect(found).toHaveLength(1)
  expect(found[0].app).toBe("codex")
})

it("adopts an opencode provider from opencode.json", () => {
  const opencodeConfig = JSON.stringify({
    provider: {
      mine: {
        npm: "@ai-sdk/openai-compatible",
        name: "My Relay",
        options: { baseURL: "https://oc.example/v1", apiKey: "sk-oc" },
      },
    },
  })
  const found = detectUnmanagedProviders({ ...empty, opencodeConfig })
  expect(found).toHaveLength(1)
  expect(found[0].form).toMatchObject({
    app: "opencode",
    name: "My Relay",
    baseUrl: "https://oc.example/v1",
    token: "sk-oc",
  })
})

it("ignores an opencode provider entry with no endpoint", () => {
  // The built-in providers carry no baseURL and are not something to import.
  const opencodeConfig = JSON.stringify({ provider: { anthropic: { models: {} } } })
  expect(detectUnmanagedProviders({ ...empty, opencodeConfig })).toEqual([])
})

it("degrades to nothing on malformed input instead of throwing", () => {
  expect(detectUnmanagedProviders({ ...empty, claudeSettings: "{not json" })).toEqual([])
  expect(detectUnmanagedProviders({ ...empty, codexConfig: "= = =" })).toEqual([])
  expect(detectUnmanagedProviders({ ...empty, opencodeConfig: "{not json" })).toEqual([])
})
