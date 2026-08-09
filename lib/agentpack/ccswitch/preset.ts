/**
 * Built-in "recommended provider" presets. Selecting one opens the add-provider
 * form pre-filled with everything except the token, which the user supplies.
 * We never write these to the DB silently — they're just form defaults.
 */
import type { ProviderForm } from "./types"

export interface ProviderPreset {
  /** Stable key used as the menu option value (`__preset__:<key>`). */
  key: string
  /** Menu label. */
  label: string
  /** Pre-filled form fields (token left for the user). */
  form: Partial<ProviderForm>
}

/**
 * napi.moretoken.ai relay, offered for both agent CLIs. Claude uses the root
 * domain with an AUTH_TOKEN; Codex (OpenAI-compatible) uses the `/v1` base.
 */
export const RECOMMENDED_PROVIDERS: ProviderPreset[] = [
  {
    key: "anthropic-compatible",
    label: "Anthropic-compatible",
    form: {
      name: "Anthropic-compatible",
      app: "claude",
      claudeAuthKind: "auth_token",
    },
  },
  {
    key: "openai-compatible",
    label: "OpenAI-compatible",
    form: {
      name: "OpenAI-compatible",
      app: "codex",
    },
  },
  {
    key: "opencode-compatible",
    label: "OpenCode-compatible",
    form: {
      name: "OpenCode-compatible",
      app: "opencode",
    },
  },
  {
    key: "moretoken-claude",
    label: "napi.moretoken.ai (Claude)",
    form: {
      name: "MoreToken",
      app: "claude",
      baseUrl: "https://napi.moretoken.ai",
      claudeAuthKind: "auth_token",
    },
  },
  {
    key: "moretoken-codex",
    label: "napi.moretoken.ai (Codex)",
    form: {
      name: "MoreToken",
      app: "codex",
      baseUrl: "https://napi.moretoken.ai/v1",
    },
  },
]
