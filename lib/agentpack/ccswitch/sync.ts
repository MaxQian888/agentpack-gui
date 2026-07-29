import { parse, stringify } from "smol-toml"

/**
 * Sync a cc-switch provider's `settings_config` into the live agent config files
 * so switching a provider actually takes effect (cc-switch itself does this on
 * "switch"; agentpack only flipped the DB flag before). Pure text transforms,
 * mirroring the shapes in `provider.ts`.
 *
 * - claude:   `settings_config.env` → `~/.claude/settings.json` `env` block
 * - codex:    `settings_config.config` (TOML) → `~/.codex/config.toml`
 * - opencode: `settings_config` → `provider.custom` in
 *             `~/.config/opencode/opencode.json`, plus the top-level `model`
 *
 * `~/.codex/auth.json` is deliberately NOT written. Codex resolves its explicit
 * `auth_mode` field ahead of everything else, so on a machine logged in with a
 * ChatGPT subscription (`auth_mode = "chatgpt"`) an `OPENAI_API_KEY` written
 * beside it is simply ignored — the switch reports success while Codex keeps
 * talking to OpenAI. The relay token therefore rides in config.toml as
 * `experimental_bearer_token`, which leaves the official login untouched and
 * makes switching back a pure config edit.
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

/**
 * The `[model_providers.*]` key agentpack writes. cc-switch writes the same key,
 * so the two tools overwrite each other's entry instead of stacking duplicates
 * and a switch never leaves a stale provider table behind.
 */
export const CODEX_PROVIDER_KEY = "custom"

/** The `provider.*` key agentpack writes into opencode.json. */
export const OPENCODE_PROVIDER_KEY = "custom"

/**
 * OpenCode resolves a provider through an AI-SDK package. `openai-compatible` is
 * the one that speaks the chat-completions API every relay implements; the plain
 * `@ai-sdk/openai` package is only for endpoints serving `/v1/responses`.
 */
export const OPENCODE_NPM = "@ai-sdk/openai-compatible"

/**
 * The `[model_providers.*]` key the removed Network → relay card used to write.
 * Cleaned up on every codex sync so the old dual-write path can't keep
 * shadowing the provider the user actually selected.
 */
export const LEGACY_CODEX_PROVIDER_KEY = "agentpack"

/**
 * Top-level codex keys a provider owns. Cleared before applying so switching to
 * a provider that pins none of them doesn't inherit the previous provider's
 * values. Everything else in config.toml is left alone.
 */
const MANAGED_CODEX_KEYS = [
  "model",
  "model_reasoning_effort",
  "model_context_window",
  "model_auto_compact_token_limit",
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
 *
 * An "official login" provider carries an empty `env`, which clears every
 * managed key and hands Claude Code back to its own OAuth credentials.
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
 * Merge a codex provider's `config` TOML into an existing config.toml text.
 *
 * Managed surface: the `[model_providers.custom]` table, the `model_provider`
 * selector, and the `MANAGED_CODEX_KEYS` top-level keys — each cleared, then
 * re-applied from the provider. A provider that declares no `model_providers`
 * (the "official login" row) drops the table and the selector so codex falls
 * back to its built-in OpenAI provider. Everything else is left intact, and
 * malformed input returns the original text.
 */
export function codexConfigFromProvider(existingToml: string, settingsConfig: string): string {
  const cfg = providerCodexConfig(settingsConfig)
  if (!cfg) return existingToml
  const data = (existingToml.trim() ? parse(existingToml) : {}) as Record<string, unknown>

  for (const k of MANAGED_CODEX_KEYS) {
    if (cfg[k] !== undefined) data[k] = cfg[k]
    else delete data[k]
  }

  const providers = { ...((data["model_providers"] as Record<string, unknown>) ?? {}) }
  // The old Network → relay card wrote its own provider table; drop it so a
  // config written by that path stops competing with the selected provider.
  delete providers[LEGACY_CODEX_PROVIDER_KEY]
  if (data["model_provider"] === LEGACY_CODEX_PROVIDER_KEY) delete data["model_provider"]

  const cfgProviders = cfg["model_providers"] as Record<string, unknown> | undefined
  const managed = cfgProviders?.[CODEX_PROVIDER_KEY]
  if (managed !== undefined) {
    providers[CODEX_PROVIDER_KEY] = managed
    data["model_provider"] = cfg["model_provider"] ?? CODEX_PROVIDER_KEY
  } else {
    delete providers[CODEX_PROVIDER_KEY]
    if (data["model_provider"] === CODEX_PROVIDER_KEY) delete data["model_provider"]
  }

  if (Object.keys(providers).length) data["model_providers"] = providers
  else delete data["model_providers"]
  return stringify(data)
}

/**
 * Merge an opencode provider into an opencode.json text. Managed surface: the
 * `provider.custom` entry and the top-level `model` selector, which OpenCode
 * reads as `"<providerId>/<modelId>"`. A provider that declares nothing (the
 * official-login row) drops both. Unrelated keys — `mcp`, `permission`, the
 * user's other providers — are preserved, and malformed input is returned as-is.
 */
export function opencodeConfigFromProvider(existingJson: string, settingsConfig: string): string {
  let entry: Record<string, unknown>
  try {
    entry = JSON.parse(settingsConfig) as Record<string, unknown>
  } catch {
    return existingJson
  }
  if (!entry || typeof entry !== "object") return existingJson

  let data: Record<string, unknown>
  try {
    data = (existingJson.trim() ? JSON.parse(existingJson) : {}) as Record<string, unknown>
  } catch {
    return existingJson
  }

  const providers = { ...((data["provider"] as Record<string, unknown>) ?? {}) }
  const declaresProvider = Object.keys(entry).length > 0
  if (declaresProvider) {
    providers[OPENCODE_PROVIDER_KEY] = entry
    const models = entry["models"]
    const modelId = models && typeof models === "object" ? Object.keys(models)[0] : undefined
    if (modelId) data["model"] = `${OPENCODE_PROVIDER_KEY}/${modelId}`
    // Switching to a provider that pins no model must not leave the previous
    // one's selection pointing at a provider entry we just replaced.
    else if (String(data["model"] ?? "").startsWith(`${OPENCODE_PROVIDER_KEY}/`)) {
      delete data["model"]
    }
  } else {
    delete providers[OPENCODE_PROVIDER_KEY]
    if (String(data["model"] ?? "").startsWith(`${OPENCODE_PROVIDER_KEY}/`)) delete data["model"]
  }

  if (Object.keys(providers).length) data["provider"] = providers
  else delete data["provider"]
  return JSON.stringify(data, null, 2) + "\n"
}
