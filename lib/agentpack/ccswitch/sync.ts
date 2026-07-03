import { parse, stringify } from "smol-toml"

/**
 * Sync a cc-switch provider's `settings_config` into the live agent config files
 * so switching a provider actually takes effect (cc-switch itself does this on
 * "switch"; agentpack only flipped the DB flag before). Pure text transforms,
 * mirroring the shapes in `provider.ts` / `merge/network.ts`.
 *
 * - claude: `settings_config.env` → `~/.claude/settings.json` `env` block
 * - codex:  `settings_config.config` (TOML) → `~/.codex/config.toml`
 *           `settings_config.auth.OPENAI_API_KEY` → `~/.codex/auth.json`
 */

/** Claude env keys agentpack owns; cleared before applying a provider so an
 * api_key ↔ auth_token switch never leaves both, and a switch fully replaces
 * base URL / model. Unrelated env keys are preserved. */
const MANAGED_CLAUDE_ENV = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
] as const

/** Extract the string-valued `env` map from a claude provider's settings_config. */
function providerClaudeEnv(settingsConfig: string): Record<string, string> | null {
  let raw: unknown
  try {
    raw = JSON.parse(settingsConfig)
  } catch {
    return null
  }
  const env = (raw as { env?: Record<string, unknown> })?.env
  if (!env || typeof env !== "object") return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v
  return out
}

/**
 * Merge a claude provider's env vars into a settings.json text. Preserves all
 * other fields and unrelated env keys. On malformed input returns the original
 * text unchanged (never wipes a live config).
 */
export function claudeSettingsFromProvider(existingJson: string, settingsConfig: string): string {
  const providerEnv = providerClaudeEnv(settingsConfig)
  if (!providerEnv) return existingJson
  const data = (existingJson.trim() ? JSON.parse(existingJson) : {}) as Record<string, unknown>
  const env = { ...((data["env"] as Record<string, string>) ?? {}) }
  for (const k of MANAGED_CLAUDE_ENV) delete env[k]
  Object.assign(env, providerEnv)
  data["env"] = env
  return JSON.stringify(data, null, 2) + "\n"
}

/** Parse the embedded codex `config` TOML string from a provider's settings_config. */
function providerCodexConfig(settingsConfig: string): Record<string, unknown> | null {
  let raw: unknown
  try {
    raw = JSON.parse(settingsConfig)
  } catch {
    return null
  }
  const configStr = (raw as { config?: unknown })?.config
  if (typeof configStr !== "string") return null
  try {
    return parse(configStr) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Merge a codex provider's `config` TOML into an existing config.toml text:
 * sets `model_provider`, merges `model_providers`, and sets `model` when present.
 * Other tables/keys are left intact. Returns the original text on malformed input.
 */
export function codexConfigFromProvider(existingToml: string, settingsConfig: string): string {
  const cfg = providerCodexConfig(settingsConfig)
  if (!cfg) return existingToml
  const data = (existingToml.trim() ? parse(existingToml) : {}) as Record<string, unknown>
  if (cfg["model_provider"] !== undefined) data["model_provider"] = cfg["model_provider"]
  // `model` is provider-managed: switching to a provider without a pinned model
  // must not keep the previous provider's model in config.toml.
  if (cfg["model"] !== undefined) data["model"] = cfg["model"]
  else delete data["model"]
  const providers = { ...((data["model_providers"] as Record<string, unknown>) ?? {}) }
  const cfgProviders = cfg["model_providers"] as Record<string, unknown> | undefined
  if (cfgProviders) Object.assign(providers, cfgProviders)
  if (Object.keys(providers).length) data["model_providers"] = providers
  return stringify(data)
}

/**
 * Write a codex provider's `OPENAI_API_KEY` into an auth.json text, preserving
 * other keys. Returns the original text when the provider has no key.
 */
export function codexAuthFromProvider(existingJson: string, settingsConfig: string): string {
  let raw: unknown
  try {
    raw = JSON.parse(settingsConfig)
  } catch {
    return existingJson
  }
  const key = (raw as { auth?: Record<string, unknown> })?.auth?.["OPENAI_API_KEY"]
  if (typeof key !== "string") return existingJson
  const data = (existingJson.trim() ? JSON.parse(existingJson) : {}) as Record<string, unknown>
  data["OPENAI_API_KEY"] = key
  return JSON.stringify(data, null, 2) + "\n"
}
