import { parse, stringify } from "smol-toml"
import { CODEX_PROVIDER_KEY, OPENCODE_NPM } from "./sync"
import type { ProviderApp, ProviderForm } from "./types"

/**
 * Build the cc-switch `settings_config` JSON string for a provider, matching
 * the shapes cc-switch writes itself:
 *
 * - claude: `{ env: { <AUTH_TOKEN|API_KEY>, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL? } }`
 * - codex:  `{ auth: { OPENAI_API_KEY }, config: "<TOML>" }`
 *
 * The codex `config` is a TOML string serialized with smol-toml to avoid
 * hand-rolled escaping.
 *
 * The codex token is carried twice on purpose: as `experimental_bearer_token`
 * inside the config TOML (what agentpack applies — see `sync.ts` for why
 * auth.json is off limits) and as `auth.OPENAI_API_KEY` (what cc-switch reads
 * when the user switches this same provider from cc-switch's own UI).
 */
export function buildSettingsConfig(form: ProviderForm): string {
  // The raw tab exists precisely for fields this function doesn't model
  // (`query_params`, custom headers, per-model overrides…), so when it was used
  // it wins wholesale — re-deriving would silently drop whatever was added.
  if (form.rawSettingsConfig) return form.rawSettingsConfig
  if (form.app === "claude") {
    const env: Record<string, string> = {}
    const authVar = form.claudeAuthKind === "api_key" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
    // Empty fields are omitted rather than written as empty strings: clearing a
    // token should remove the variable, not set it to "". It also makes a form
    // with no endpoint and no token serialize to "override nothing", which is
    // exactly the official-login row (see `official.ts`).
    if (form.token) env[authVar] = form.token
    if (form.baseUrl) env["ANTHROPIC_BASE_URL"] = form.baseUrl
    if (form.model) env["ANTHROPIC_MODEL"] = form.model
    return JSON.stringify({ env })
  }

  if (form.app === "opencode") {
    // Mirrors the shape cc-switch stores (and OpenCode's own `provider.<id>`
    // entry), so a row written here is one cc-switch can switch to as well.
    const out: Record<string, unknown> = { npm: OPENCODE_NPM, name: form.name }
    const options: Record<string, string> = {}
    if (form.baseUrl) options["baseURL"] = form.baseUrl
    if (form.token) options["apiKey"] = form.token
    if (Object.keys(options).length) out["options"] = options
    if (form.model) out["models"] = { [form.model]: {} }
    // An official-login row declares neither, and must serialize to "override
    // nothing" — see `official.ts`.
    return JSON.stringify(form.baseUrl || form.token ? out : {})
  }

  // codex
  const config: Record<string, unknown> = {}
  if (form.baseUrl) {
    const provider: Record<string, unknown> = {
      name: form.name,
      base_url: form.baseUrl,
      wire_api: "responses",
      // The bearer token below authenticates the relay, so codex must not also
      // demand an OpenAI login for this provider.
      requires_openai_auth: false,
    }
    if (form.token) provider["experimental_bearer_token"] = form.token
    config["model_provider"] = CODEX_PROVIDER_KEY
    config["model_providers"] = { [CODEX_PROVIDER_KEY]: provider }
  }
  if (form.model) config["model"] = form.model
  return JSON.stringify({
    auth: form.token ? { OPENAI_API_KEY: form.token } : {},
    config: stringify(config),
  })
}

/**
 * Reverse of {@link buildSettingsConfig}: recover the editable form fields from a
 * provider's stored `settings_config` so the "edit provider" dialog can echo the
 * existing values back. Tolerates malformed JSON/TOML by returning what it can.
 */
export function parseSettingsConfig(
  app: ProviderApp,
  settingsConfig: string
): Pick<ProviderForm, "baseUrl" | "token" | "claudeAuthKind" | "model"> {
  const out = {
    baseUrl: "",
    token: "",
    claudeAuthKind: "auth_token" as ProviderForm["claudeAuthKind"],
    model: undefined as string | undefined,
  }
  let raw: unknown
  try {
    raw = JSON.parse(settingsConfig)
  } catch {
    return out
  }
  if (!raw || typeof raw !== "object") return out

  if (app === "claude") {
    const env = (raw as { env?: Record<string, unknown> }).env ?? {}
    if (typeof env["ANTHROPIC_API_KEY"] === "string") {
      out.token = env["ANTHROPIC_API_KEY"]
      out.claudeAuthKind = "api_key"
    } else if (typeof env["ANTHROPIC_AUTH_TOKEN"] === "string") {
      out.token = env["ANTHROPIC_AUTH_TOKEN"]
      out.claudeAuthKind = "auth_token"
    }
    if (typeof env["ANTHROPIC_BASE_URL"] === "string") out.baseUrl = env["ANTHROPIC_BASE_URL"]
    if (typeof env["ANTHROPIC_MODEL"] === "string") out.model = env["ANTHROPIC_MODEL"]
    return out
  }

  if (app === "opencode") {
    const entry = raw as {
      options?: { baseURL?: unknown; apiKey?: unknown }
      models?: Record<string, unknown>
    }
    if (typeof entry.options?.baseURL === "string") out.baseUrl = entry.options.baseURL
    if (typeof entry.options?.apiKey === "string") out.token = entry.options.apiKey
    // The form carries one model; `models` is a map, so echo back its first key.
    const first = entry.models && Object.keys(entry.models)[0]
    if (first) out.model = first
    return out
  }

  // codex
  const auth = (raw as { auth?: Record<string, unknown> }).auth ?? {}
  if (typeof auth["OPENAI_API_KEY"] === "string") out.token = auth["OPENAI_API_KEY"]
  const configStr = (raw as { config?: unknown }).config
  if (typeof configStr === "string") {
    try {
      const config = parse(configStr) as {
        model?: unknown
        model_providers?: Record<
          string,
          { base_url?: unknown; experimental_bearer_token?: unknown }
        >
      }
      const managed = config.model_providers?.[CODEX_PROVIDER_KEY]
      if (typeof managed?.base_url === "string") out.baseUrl = managed.base_url
      // Prefer the token agentpack actually applies; `auth.OPENAI_API_KEY` above
      // is the cc-switch-compatible copy and only fills in for rows written by
      // cc-switch (or by agentpack before the bearer-token switch).
      if (typeof managed?.experimental_bearer_token === "string") {
        out.token = managed.experimental_bearer_token
      }
      if (typeof config.model === "string") out.model = config.model
    } catch {
      // leave codex base_url/model unset on malformed TOML
    }
  }
  return out
}
