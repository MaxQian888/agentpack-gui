import {
  getConfigValue,
  PROVIDER_TOKEN,
  setConfigValue,
  tomlFormat,
  type ConfigDoc,
  type ConfigSection,
} from "./config-editor/schema"

/**
 * The generic editor engine lives in `./config-editor/schema` and serves every
 * config file; this module keeps only what is cc-connect *knowledge* — its
 * ports, its section schema, and the web-admin bootstrap. The re-exports below
 * are the editor vocabulary this file's own schema is written in.
 */
export {
  PROVIDER_TOKEN,
  isProviderScoped,
  resolveFieldPath,
  getConfigValue,
  setConfigValue,
} from "./config-editor/schema"
export type { ConfigField, ConfigSection } from "./config-editor/schema"

/**
 * cc-connect (github.com/chenhg5/cc-connect) bridges local coding agents to
 * chat platforms. It's a Go binary (installed via the `cc-connect` npm wrapper).
 * The service reads `~/.cc-connect/config.toml` and, when the relevant sections
 * are enabled, exposes three local servers:
 *  - the web management dashboard + REST API on `[management] port` (default 9820)
 *  - the bridge WebSocket/REST for external adapters on `[bridge] port` (9810)
 *  - the inbound webhook receiver on `[webhook] port` (9111)
 *
 * All three default to `enabled = false`. The blessed way to turn the dashboard
 * on is `cc-connect web`, which flips `[management]`/`[bridge]` to enabled,
 * generates their tokens, and opens the browser at
 * `http://localhost:9820/?token=<token>`. The main `cc-connect` process is what
 * actually serves the dashboard once management is enabled.
 */
export const CC_CONNECT_MANAGEMENT_PORT = 9820
export const CC_CONNECT_BRIDGE_PORT = 9810
export const CC_CONNECT_WEBHOOK_PORT = 9111

/** Parsed config.toml document — a plain TOML object tree, unknown keys preserved. */
export type CcConnectDoc = ConfigDoc

function validPort(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535
}

/**
 * Parse config.toml, or null on a syntax error / non-object root. The config is
 * auto-created by cc-connect itself, so garbage in must never break the section.
 */
export function parseConfigDoc(toml: string): CcConnectDoc | null {
  return tomlFormat.parse(toml)
}

/** Serialize a config document back to TOML (unknown keys round-trip). */
export function serializeConfigDoc(doc: CcConnectDoc): string {
  return tomlFormat.serialize(doc)
}

function sectionTable(doc: CcConnectDoc | null, section: string): Record<string, unknown> | null {
  const s = doc?.[section]
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : null
}

function sectionPort(doc: CcConnectDoc | null, section: string, fallback: number): number {
  const port = sectionTable(doc, section)?.port
  return validPort(port) ? port : fallback
}

/** Management dashboard/API port from config.toml (falls back to 9820). */
export function parseManagementPort(toml: string): number {
  return sectionPort(parseConfigDoc(toml), "management", CC_CONNECT_MANAGEMENT_PORT)
}

/** Bridge WebSocket/REST port from config.toml (falls back to 9810). */
export function parseBridgePort(toml: string): number {
  return sectionPort(parseConfigDoc(toml), "bridge", CC_CONNECT_BRIDGE_PORT)
}

/** Inbound webhook port from config.toml (falls back to 9111). */
export function parseWebhookPort(toml: string): number {
  return sectionPort(parseConfigDoc(toml), "webhook", CC_CONNECT_WEBHOOK_PORT)
}

/** Whether a config section has `enabled = true` (defaults to false / disabled). */
export function isSectionEnabled(toml: string, section: string): boolean {
  return sectionTable(parseConfigDoc(toml), section)?.enabled === true
}

/** The management auth token, or undefined when none is configured. */
export function parseManagementToken(toml: string): string | undefined {
  const tok = sectionTable(parseConfigDoc(toml), "management")?.token
  return typeof tok === "string" && tok !== "" ? tok : undefined
}

/**
 * The dashboard is only ever bound locally. When a management token is set,
 * cc-connect authenticates the dashboard via a `?token=` query param (matching
 * what `cc-connect web` opens), so append it for a one-click, pre-authed load.
 */
export function dashboardUrl(port: number, token?: string): string {
  const base = `http://localhost:${port}`
  return token ? `${base}/?token=${encodeURIComponent(token)}` : base
}

/**
 * The visual editor's schema — cc-connect's documented global settings, grouped
 * to mirror its TOML sections. Projects (`[[projects]]`), providers, hooks and
 * other array tables are edited via the raw-TOML tab or the bridge's own web UI;
 * everything the schema doesn't know round-trips untouched.
 */
export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    key: "general",
    fields: [
      { path: ["language"], key: "language", type: "select", options: ["", "en", "zh"] },
      { path: ["data_dir"], key: "dataDir", type: "string" },
      {
        path: ["shell"],
        key: "shell",
        type: "select",
        options: ["", "sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"],
      },
      { path: ["shell_profile"], key: "shellProfile", type: "string" },
      {
        path: ["attachment_send"],
        key: "attachmentSend",
        type: "select",
        options: ["", "on", "off"],
      },
      { path: ["max_attachment_size_mb"], key: "maxAttachmentSize", type: "number" },
      { path: ["quiet"], key: "quiet", type: "boolean" },
      {
        path: ["log", "level"],
        key: "logLevel",
        type: "select",
        options: ["debug", "info", "warn", "error"],
      },
    ],
  },
  {
    key: "management",
    fields: [
      { path: ["management", "enabled"], key: "enabled", type: "boolean" },
      { path: ["management", "port"], key: "port", type: "number" },
      { path: ["management", "token"], key: "token", type: "string" },
      {
        path: ["management", "cors_origins"],
        key: "corsOrigins",
        type: "string-list",
        placeholder: "*",
      },
    ],
  },
  {
    key: "bridge",
    fields: [
      { path: ["bridge", "enabled"], key: "enabled", type: "boolean" },
      { path: ["bridge", "port"], key: "port", type: "number" },
      { path: ["bridge", "token"], key: "token", type: "string" },
      { path: ["bridge", "path"], key: "path", type: "string", placeholder: "/bridge/ws" },
      { path: ["bridge", "insecure"], key: "insecure", type: "boolean" },
    ],
  },
  {
    key: "webhook",
    fields: [
      { path: ["webhook", "enabled"], key: "enabled", type: "boolean" },
      { path: ["webhook", "port"], key: "port", type: "number" },
      { path: ["webhook", "token"], key: "token", type: "string" },
      { path: ["webhook", "path"], key: "path", type: "string", placeholder: "/hook" },
    ],
  },
  {
    key: "speech",
    fields: [
      { path: ["speech", "enabled"], key: "enabled", type: "boolean" },
      {
        path: ["speech", "provider"],
        key: "provider",
        type: "select",
        options: ["openai", "groq", "qwen"],
      },
      { path: ["speech", "language"], key: "speechLanguage", type: "string" },
      { path: ["speech", PROVIDER_TOKEN, "api_key"], key: "apiKey", type: "string" },
      { path: ["speech", PROVIDER_TOKEN, "base_url"], key: "baseUrl", type: "string" },
      { path: ["speech", PROVIDER_TOKEN, "model"], key: "model", type: "string" },
    ],
  },
  {
    key: "tts",
    fields: [
      { path: ["tts", "enabled"], key: "enabled", type: "boolean" },
      {
        path: ["tts", "provider"],
        key: "provider",
        type: "select",
        options: ["qwen", "openai", "minimax", "mimo", "edge", "espeak", "pico"],
      },
      { path: ["tts", "voice"], key: "voice", type: "string" },
      { path: ["tts", "voice_id"], key: "voiceId", type: "string" },
      { path: ["tts", "speed"], key: "speed", type: "number" },
      {
        path: ["tts", "tts_mode"],
        key: "ttsMode",
        type: "select",
        options: ["voice_only", "always"],
      },
      { path: ["tts", "max_text_len"], key: "maxTextLen", type: "number" },
      { path: ["tts", PROVIDER_TOKEN, "api_key"], key: "apiKey", type: "string" },
      { path: ["tts", PROVIDER_TOKEN, "base_url"], key: "baseUrl", type: "string" },
      { path: ["tts", PROVIDER_TOKEN, "model"], key: "model", type: "string" },
    ],
  },
  {
    key: "display",
    fields: [
      {
        path: ["display", "mode"],
        key: "displayMode",
        type: "select",
        options: ["", "full", "compact", "quiet"],
      },
      { path: ["display", "thinking_messages"], key: "thinkingMessages", type: "boolean" },
      { path: ["display", "thinking_max_len"], key: "thinkingMaxLen", type: "number" },
      { path: ["display", "tool_messages"], key: "toolMessages", type: "boolean" },
      { path: ["display", "tool_max_len"], key: "toolMaxLen", type: "number" },
      { path: ["display", "history_max_len"], key: "historyMaxLen", type: "number" },
      { path: ["display", "show_context_indicator"], key: "showContextIndicator", type: "boolean" },
      { path: ["display", "reply_footer"], key: "replyFooter", type: "boolean" },
      { path: ["display", "hide_agent_footer"], key: "hideAgentFooter", type: "boolean" },
    ],
  },
  {
    key: "streamPreview",
    fields: [
      { path: ["stream_preview", "enabled"], key: "enabled", type: "boolean" },
      { path: ["stream_preview", "interval_ms"], key: "intervalMs", type: "number" },
      { path: ["stream_preview", "min_delta_chars"], key: "minDeltaChars", type: "number" },
      { path: ["stream_preview", "max_chars"], key: "maxChars", type: "number" },
    ],
  },
  {
    key: "rateLimit",
    fields: [
      { path: ["rate_limit", "max_messages"], key: "maxMessages", type: "number" },
      { path: ["rate_limit", "window_secs"], key: "windowSecs", type: "number" },
    ],
  },
  {
    key: "relay",
    fields: [
      { path: ["relay", "timeout_secs"], key: "relayTimeout", type: "number" },
      {
        path: ["relay", "visibility"],
        key: "visibility",
        type: "select",
        options: ["", "full", "summary", "none"],
      },
    ],
  },
  {
    key: "timeouts",
    fields: [
      { path: ["idle_timeout_mins"], key: "idleTimeout", type: "number" },
      { path: ["max_turn_time_mins"], key: "maxTurnTime", type: "number" },
      { path: ["reset_on_idle_mins"], key: "resetOnIdle", type: "number" },
      { path: ["workspace_idle_timeout_mins"], key: "workspaceIdleTimeout", type: "number" },
      {
        path: ["agent_session_idle_timeout_mins"],
        key: "agentSessionIdleTimeout",
        type: "number",
      },
    ],
  },
]

/**
 * Ensure the management dashboard is turned on with a non-empty login token,
 * returning the (possibly updated) doc, the token to open the dashboard with,
 * and whether anything changed. `newToken` is consumed only when the config has
 * no token yet, so opening never rotates a token out from under a running
 * service. Mirrors cc-connect's own `EnableWebAdmin` (enabled + port + token +
 * cors_origins) — and guaranteeing a token is what lets the dashboard open
 * pre-authenticated instead of stopping at the SPA's login form.
 */
export function ensureWebAdmin(
  doc: CcConnectDoc,
  newToken: string
): { doc: CcConnectDoc; token: string; changed: boolean } {
  let next = doc
  let changed = false
  const set = (path: string[], value: unknown) => {
    next = setConfigValue(next, path, value)
    changed = true
  }
  if (getConfigValue(next, ["management", "enabled"]) !== true) {
    set(["management", "enabled"], true)
  }
  if (!validPort(getConfigValue(next, ["management", "port"]))) {
    set(["management", "port"], CC_CONNECT_MANAGEMENT_PORT)
  }
  const existing = getConfigValue(next, ["management", "token"])
  let token = typeof existing === "string" && existing !== "" ? existing : ""
  if (!token) {
    token = newToken
    set(["management", "token"], token)
  }
  if (getConfigValue(next, ["management", "cors_origins"]) === undefined) {
    set(["management", "cors_origins"], ["*"])
  }
  return { doc: next, token, changed }
}

/**
 * Starter config written when the user creates config.toml from the GUI. It
 * turns the management dashboard on (the whole point of the GUI helper) so a
 * plain `Start` immediately serves the web UI on 9820; the bridge is left for
 * `cc-connect web` / the user to enable. Projects are added from the dashboard.
 */
export function defaultConfigToml(): string {
  return [
    "# cc-connect configuration — see https://github.com/chenhg5/cc-connect",
    "# Add projects and platforms from the web dashboard after starting the service.",
    "",
    "[log]",
    'level = "info"',
    "",
    "[management]",
    "enabled = true",
    `port = ${CC_CONNECT_MANAGEMENT_PORT}`,
    // A login token is injected by the GUI's Open dashboard action so the
    // dashboard opens pre-authenticated; cors matches `cc-connect web`.
    'cors_origins = ["*"]',
    "",
  ].join("\n")
}
