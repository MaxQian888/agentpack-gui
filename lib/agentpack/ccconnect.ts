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
 * The dashboard is only ever bound locally. A management token authenticates it
 * via a `?token=` query param — but **only on the `/login` route**, which is the
 * single place in the dashboard SPA that reads the param (and is exactly what
 * `cc-connect web` opens).
 *
 * The path is not cosmetic. Hitting `/` with the token lands on the protected
 * index, whose auth guard renders `<Navigate to="/login">` — a bare path that
 * drops the query string — so the token never reaches the one component that
 * would have consumed it and the user is asked to log in by hand.
 */
export function dashboardUrl(port: number, token?: string): string {
  const base = `http://localhost:${port}`
  return token ? `${base}/login?token=${encodeURIComponent(token)}` : base
}

/**
 * How many `[[projects]]` the config declares.
 *
 * This is the difference between a service that serves the dashboard and one
 * that dies a second after spawn: cc-connect's startup validation refuses a
 * config with no projects ("at least one [[projects]] entry is required") and
 * exits *before* it binds the management port. So "web admin is enabled" is not
 * on its own enough to open the dashboard — there has to be a project too.
 */
export function projectCount(doc: CcConnectDoc | null): number {
  const projects = doc?.projects
  return Array.isArray(projects) ? projects.length : 0
}

/** `projectCount` over raw config text (an unparseable file counts as none). */
export function countProjects(toml: string): number {
  return projectCount(parseConfigDoc(toml))
}

/**
 * The visual editor's schema — cc-connect's documented **global** settings,
 * grouped to mirror its TOML sections. Projects (`[[projects]]`), providers,
 * hooks and other array tables are edited via the raw-TOML tab or the bridge's
 * own web UI; everything the schema doesn't know round-trips untouched.
 *
 * ⚠️ Global is the operative word. cc-connect has several settings that read as
 * global but live on `[[projects]]` — `reset_on_idle_mins` and
 * `agent_session_idle_timeout_mins` are the two this file used to offer at the
 * top level. TOML decoding ignores unknown keys silently, so a field pointed at
 * the wrong scope doesn't error: it writes a key nothing ever reads, and the
 * form then reports the dead value back as if it were in effect. Check the scope
 * in upstream's `config.go` (top-level `Config` vs `ProjectConfig`) before
 * adding a path here.
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
      { path: ["banned_words"], key: "bannedWords", type: "string-list" },
      { path: ["provider_presets_url"], key: "providerPresetsUrl", type: "string" },
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
      {
        path: ["bridge", "cors_origins"],
        key: "corsOrigins",
        type: "string-list",
        placeholder: "*",
      },
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
        options: ["openai", "groq", "qwen", "gemini"],
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
      { path: ["tts", "language_type"], key: "languageType", type: "string" },
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
      {
        path: ["display", "card_mode"],
        key: "cardMode",
        type: "select",
        options: ["", "legacy", "rich"],
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
      {
        path: ["stream_preview", "disabled_platforms"],
        key: "disabledPlatforms",
        type: "string-list",
        placeholder: "feishu, slack",
      },
    ],
  },
  {
    key: "instantReply",
    fields: [
      { path: ["instant_reply", "enabled"], key: "enabled", type: "boolean" },
      { path: ["instant_reply", "content"], key: "instantReplyContent", type: "string" },
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
    // Outbound throttling, the opposite direction from [rate_limit]. Its
    // `platforms` table maps a platform name to a *table* of overrides, which no
    // scalar widget can express — it stays raw-tab only, and round-trips.
    key: "outgoingRateLimit",
    fields: [
      { path: ["outgoing_rate_limit", "max_per_second"], key: "maxPerSecond", type: "number" },
      { path: ["outgoing_rate_limit", "burst"], key: "burst", type: "number" },
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
    key: "cron",
    fields: [
      { path: ["cron", "silent"], key: "cronSilent", type: "boolean" },
      {
        path: ["cron", "session_mode"],
        key: "cronSessionMode",
        type: "select",
        options: ["", "reuse", "new_per_run"],
      },
      { path: ["queue", "max_depth"], key: "queueMaxDepth", type: "number" },
    ],
  },
  {
    // Only the timeouts cc-connect really reads at the top level. The
    // per-session ones (`reset_on_idle_mins`, `agent_session_idle_timeout_mins`)
    // are `[[projects]]` fields — see the scope warning above.
    key: "timeouts",
    fields: [
      { path: ["idle_timeout_mins"], key: "idleTimeout", type: "number" },
      { path: ["max_turn_time_mins"], key: "maxTurnTime", type: "number" },
      { path: ["workspace_idle_timeout_mins"], key: "workspaceIdleTimeout", type: "number" },
    ],
  },
]

/** The two independent tokens `cc-connect web` generates when it turns the dashboard on. */
export interface WebAdminTokens {
  management: string
  bridge: string
}

/**
 * Ensure the web admin is turned on, returning the (possibly updated) doc, the
 * token to open the dashboard with, and whether anything changed.
 *
 * Mirrors cc-connect's own `EnableWebAdmin`, which enables **both halves**:
 * `[management]` (the dashboard + REST API the browser talks to) and `[bridge]`
 * (the WebSocket the dashboard's own Bridge/chat surfaces need), each with its
 * own port, its own token and `cors_origins`. Enabling management alone gets you
 * a dashboard whose bridge pages have nothing to talk to.
 *
 * A supplied token is consumed only where the config has none, so opening never
 * rotates a token out from under a running service. One deliberate difference
 * from upstream: it backfills a missing token even on a section that is
 * *already* enabled. Upstream skips such a section wholesale, which leaves two
 * states it can't repair — a tokenless management section (the dashboard stops
 * at its login form) and a tokenless bridge (cc-connect logs "token is required
 * when insecure mode is not enabled" and refuses every connection).
 */
export function ensureWebAdmin(
  doc: CcConnectDoc,
  tokens: WebAdminTokens
): { doc: CcConnectDoc; token: string; changed: boolean } {
  let next = doc
  let changed = false
  const set = (path: string[], value: unknown) => {
    next = setConfigValue(next, path, value)
    changed = true
  }

  /** Enable one section and backfill whatever it is missing; returns its token. */
  const enable = (section: string, defaultPort: number, newToken: string): string => {
    if (getConfigValue(next, [section, "enabled"]) !== true) {
      set([section, "enabled"], true)
    }
    if (!validPort(getConfigValue(next, [section, "port"]))) {
      set([section, "port"], defaultPort)
    }
    const existing = getConfigValue(next, [section, "token"])
    let token = typeof existing === "string" && existing !== "" ? existing : ""
    if (!token) {
      token = newToken
      set([section, "token"], token)
    }
    if (getConfigValue(next, [section, "cors_origins"]) === undefined) {
      set([section, "cors_origins"], ["*"])
    }
    return token
  }

  const token = enable("management", CC_CONNECT_MANAGEMENT_PORT, tokens.management)
  enable("bridge", CC_CONNECT_BRIDGE_PORT, tokens.bridge)
  return { doc: next, token, changed }
}

/**
 * Starter config written when the user creates config.toml from the GUI.
 *
 * The `[[projects]]` block is not padding: cc-connect validates the config
 * before it binds anything and exits on a projectless one, so a config carrying
 * only `[management]` produces a service that can never serve the dashboard it
 * just enabled. Placeholder credentials are enough to get there — the platform
 * connects, fails auth and retries in the background while the management API
 * comes up — which is what lets the user fix them *from* the dashboard. This is
 * the same shape cc-connect's own first-run bootstrap writes, plus the web admin
 * the GUI helper exists to turn on.
 */
export function defaultConfigToml(): string {
  return [
    "# cc-connect configuration — see https://github.com/chenhg5/cc-connect",
    "# Replace the placeholders below, or edit projects and platforms from the",
    "# web dashboard once the service is running.",
    "",
    "[log]",
    'level = "info"',
    "",
    "[management]",
    "enabled = true",
    `port = ${CC_CONNECT_MANAGEMENT_PORT}`,
    // Login tokens are injected by the GUI's Open dashboard action so the
    // dashboard opens pre-authenticated; cors matches `cc-connect web`.
    'cors_origins = ["*"]',
    "",
    "[bridge]",
    "enabled = true",
    `port = ${CC_CONNECT_BRIDGE_PORT}`,
    'cors_origins = ["*"]',
    "",
    "# cc-connect refuses to start without at least one project, and each project",
    "# needs at least one platform. Point work_dir at the repo you want to drive.",
    "[[projects]]",
    'name = "my-project"',
    "",
    "[projects.agent]",
    '# "claudecode", "codex", "cursor", "gemini", "qoder", "opencode" or "iflow"',
    'type = "claudecode"',
    "",
    "[projects.agent.options]",
    'work_dir = "/path/to/your/project"',
    "",
    "# Feishu / Lark needs no public IP. For DingTalk, Telegram, Slack, Discord,",
    "# LINE or WeChat Work see the upstream config.example.toml.",
    "[[projects.platforms]]",
    'type = "feishu"',
    "",
    "[projects.platforms.options]",
    'app_id = "your-feishu-app-id"',
    'app_secret = "your-feishu-app-secret"',
    "",
  ].join("\n")
}
