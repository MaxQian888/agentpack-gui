import { parseSettingsConfig } from "./provider"
import type { Provider, ProviderApp, ProviderForm } from "./types"

/**
 * The "official login" provider: the row that means *stop overriding anything,
 * use whatever the CLI's own login says*.
 *
 * It has to be a real row rather than a synthetic entry in the UI. `is_current`
 * is the single switch this whole feature is built around — the DB decides which
 * provider is live, and cc-switch reads the same flag — so a synthetic row would
 * leave the DB pointing at a relay while the live config pointed at the official
 * account, which is exactly the two-sources-of-truth bug being removed.
 *
 * Mechanically it is just a provider with no endpoint and no token: syncing it
 * clears every key agentpack manages (`ANTHROPIC_*` in settings.json, the
 * `[model_providers.custom]` table and `model_provider` in config.toml) and the
 * CLI falls back to its built-in provider and its own credentials. Nothing here
 * reads or writes those credentials.
 */

/** Form that serializes to "override nothing" — see `buildSettingsConfig`. */
export function officialForm(app: ProviderApp, name: string): ProviderForm {
  return { name, app, baseUrl: "", token: "", claudeAuthKind: "auth_token" }
}

/**
 * Whether a stored config is the official-login one. Derived from content —
 * "declares neither an endpoint nor a token" — rather than a marker column, so a
 * row created by cc-switch is recognized too and no schema change is needed.
 */
export function isOfficialConfig(app: ProviderApp, settingsConfig: string): boolean {
  const { baseUrl, token } = parseSettingsConfig(app, settingsConfig)
  return !baseUrl && !token
}

export function isOfficial(p: Provider): boolean {
  return isOfficialConfig(p.app_type, p.settings_config)
}

/** Apps with no official-login row yet, so the UI can offer to add one. */
export function appsMissingOfficial(
  providers: Provider[],
  apps: readonly ProviderApp[]
): ProviderApp[] {
  const have = new Set(providers.filter(isOfficial).map((p) => p.app_type))
  return apps.filter((a) => !have.has(a))
}
