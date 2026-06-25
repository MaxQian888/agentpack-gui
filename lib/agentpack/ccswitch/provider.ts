import { stringify } from "smol-toml"
import type { ProviderForm } from "./types"

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
