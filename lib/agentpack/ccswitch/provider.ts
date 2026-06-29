import { parse, stringify } from "smol-toml"
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
 */
export function buildSettingsConfig(form: ProviderForm): string {
  if (form.app === "claude") {
    const env: Record<string, string> = {}
    const authVar = form.claudeAuthKind === "api_key" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
    env[authVar] = form.token
    if (form.baseUrl) env["ANTHROPIC_BASE_URL"] = form.baseUrl
    if (form.model) env["ANTHROPIC_MODEL"] = form.model
    return JSON.stringify({ env })
  }

  // codex
  const config: Record<string, unknown> = {
    model_provider: "custom",
    model_providers: {
      custom: {
        name: form.name,
        base_url: form.baseUrl,
        wire_api: "responses",
        requires_openai_auth: true,
      },
    },
  }
  if (form.model) config["model"] = form.model
  return JSON.stringify({
    auth: { OPENAI_API_KEY: form.token },
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

  // codex
  const auth = (raw as { auth?: Record<string, unknown> }).auth ?? {}
  if (typeof auth["OPENAI_API_KEY"] === "string") out.token = auth["OPENAI_API_KEY"]
  const configStr = (raw as { config?: unknown }).config
  if (typeof configStr === "string") {
    try {
      const config = parse(configStr) as {
        model?: unknown
        model_providers?: { custom?: { base_url?: unknown } }
      }
      const baseUrl = config.model_providers?.custom?.base_url
      if (typeof baseUrl === "string") out.baseUrl = baseUrl
      if (typeof config.model === "string") out.model = config.model
    } catch {
      // leave codex base_url/model unset on malformed TOML
    }
  }
  return out
}
