/**
 * cc-switch domain types. cc-switch stores provider configs in a SQLite DB
 * (~/.cc-switch/cc-switch.db) and device UI prefs in settings.json. We only
 * touch the two agent CLIs we support.
 */

/** Provider app types agentpack can manage. cc-switch also has gemini/opencode/… */
export type ProviderApp = "claude" | "codex"

/** Which auth env var a Claude provider uses (relays usually want AUTH_TOKEN). */
export type ClaudeAuthKind = "auth_token" | "api_key"

/**
 * The set of apps cc-switch shows in its sidebar (settings.json `visibleApps`).
 * Mirrors cc-switch's own keys; agentpack defaults to claude + codex only.
 */
export interface VisibleApps {
  claude: boolean
  claudeDesktop: boolean
  codex: boolean
  gemini: boolean
  opencode: boolean
  openclaw: boolean
  hermes: boolean
}

/** A row of cc-switch's `providers` table (subset we read/write). */
export interface Provider {
  id: string
  app_type: ProviderApp
  name: string
  /** JSON string; shape depends on app_type (see provider.ts). */
  settings_config: string
  website_url?: string | null
  notes?: string | null
  is_current: boolean
}

/** The fields the "add / edit provider" form collects. */
export interface ProviderForm {
  name: string
  app: ProviderApp
  baseUrl: string
  token: string
  /** Only meaningful when app === "claude". */
  claudeAuthKind: ClaudeAuthKind
  model?: string
  notes?: string
  websiteUrl?: string
}
