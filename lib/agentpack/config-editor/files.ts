import { jsonFormat, tomlFormat, type ConfigFormat, type ConfigSection } from "./schema"

/**
 * Which config files the built-in editor knows how to project into a form.
 *
 * The schemas below are a *useful subset*, not a spec: each file belongs to
 * another project, and every one of them accepts keys we deliberately don't
 * model (hooks, provider tables, array tables). That's safe because the raw text
 * is what gets written — an unmodelled key round-trips untouched — and it's why
 * the lists here stay conservative. A key we're unsure of is worse than a key
 * we omit: omitting costs the user one trip to the raw tab, while getting one
 * wrong writes a value the agent CLI will reject.
 *
 * Field `key`s are the i18n label keys and must be globally unique across every
 * file, so `t.configFiles.fields` can stay one flat map (`files.test.ts`
 * enforces both).
 */

export type ConfigFileId = "claudeSettings" | "codexConfig" | "opencodeConfig" | "claudeConfig"

export interface ConfigFileDef {
  id: ConfigFileId
  /** Key into `Paths`; they line up 1:1 with the ids by design. */
  pathKey: ConfigFileId
  format: ConfigFormat
  /**
   * `fields` projects the doc into controls. `mcpInventory` is the read-only
   * escape for a file we refuse to write through a form (see claudeConfig).
   */
  form: { kind: "fields"; sections: ConfigSection[] } | { kind: "mcpInventory" }
  /** Another process rewrites this file while it runs → warn, and never form-edit. */
  volatile?: boolean
  /** Above this size the raw tab is replaced by a notice rather than a textarea. */
  rawLimitBytes: number
}

/**
 * `~/.claude/settings.json`.
 *
 * Excluded on purpose, all round-tripping via the raw tab: `hooks` and
 * `skillOverrides` (maps of objects, no honest widget), `sandbox.credentials` /
 * `sandbox.mounts`, and the managed-settings-only keys — an enterprise policy
 * file is not something a GUI should teach people to hand-edit.
 */
const CLAUDE_SETTINGS_SECTIONS: ConfigSection[] = [
  {
    key: "claudeGeneral",
    fields: [
      { path: ["model"], key: "claudeModel", type: "string", placeholder: "opus" },
      {
        path: ["theme"],
        key: "claudeTheme",
        type: "select",
        options: ["", "light", "dark", "auto"],
      },
      { path: ["verbose"], key: "claudeVerbose", type: "boolean" },
      { path: ["includeCoAuthoredBy"], key: "claudeCoAuthored", type: "boolean" },
      { path: ["cleanupPeriodDays"], key: "claudeCleanupDays", type: "number", placeholder: "30" },
      { path: ["spinnerTipsEnabled"], key: "claudeSpinnerTips", type: "boolean" },
      { path: ["alwaysThinkingEnabled"], key: "claudeAlwaysThinking", type: "boolean" },
      {
        path: ["apiKeyHelper"],
        key: "claudeApiKeyHelper",
        type: "string",
        placeholder: "~/.claude/key.sh",
      },
      { path: ["sandbox", "enabled"], key: "claudeSandboxEnabled", type: "boolean" },
    ],
  },
  {
    key: "claudePermissions",
    fields: [
      {
        path: ["permissions", "defaultMode"],
        key: "claudeDefaultMode",
        type: "select",
        options: ["", "default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"],
      },
      {
        path: ["permissions", "allow"],
        key: "claudeAllow",
        type: "string-list",
        placeholder: "Bash(npm run lint)",
      },
      { path: ["permissions", "ask"], key: "claudeAsk", type: "string-list" },
      {
        path: ["permissions", "deny"],
        key: "claudeDeny",
        type: "string-list",
        placeholder: "Bash(curl *)",
      },
      {
        path: ["permissions", "additionalDirectories"],
        key: "claudeAddDirs",
        type: "string-list",
      },
      // Documented value is the string "disable", not a boolean — a Switch here
      // would write `true` and the setting would silently do nothing.
      {
        path: ["permissions", "disableBypassPermissionsMode"],
        key: "claudeDisableBypass",
        type: "select",
        options: ["", "disable"],
      },
    ],
  },
  {
    key: "claudeEnv",
    fields: [{ path: ["env"], key: "claudeEnvVars", type: "string-map" }],
  },
  {
    // `statusLine` is a union — a bare template string, or a command object.
    // isPathEditable locks all three of these whenever the string form is on disk.
    key: "claudeStatusLine",
    fields: [
      {
        path: ["statusLine", "type"],
        key: "claudeStatusType",
        type: "select",
        options: ["", "command"],
      },
      {
        path: ["statusLine", "command"],
        key: "claudeStatusCommand",
        type: "string",
        placeholder: "~/.claude/statusline.sh",
      },
      { path: ["statusLine", "padding"], key: "claudeStatusPadding", type: "number" },
    ],
  },
  {
    key: "claudeMcp",
    fields: [
      {
        path: ["enableAllProjectMcpServers"],
        key: "claudeEnableProjectMcp",
        type: "boolean",
      },
      { path: ["enabledMcpjsonServers"], key: "claudeEnabledMcpJson", type: "string-list" },
      { path: ["disabledMcpjsonServers"], key: "claudeDisabledMcpJson", type: "string-list" },
    ],
  },
]

/**
 * `~/.codex/config.toml`.
 *
 * Excluded: `[model_providers.*]`, `[mcp_servers.*]`, `[projects.*]` and
 * `[profiles.*]` — maps of tables owned by the cc-switch and MCP sections, which
 * already write them with their own merge rules.
 */
const CODEX_SECTIONS: ConfigSection[] = [
  {
    key: "codexModel",
    fields: [
      { path: ["model"], key: "codexModel", type: "string", placeholder: "gpt-5.1-codex" },
      // Options come from the user's own `[model_providers]` table, so this is a
      // pick from what's actually declared rather than a list we'd have to chase.
      {
        path: ["model_provider"],
        key: "codexProvider",
        type: "select",
        options: ["", "openai"],
        optionsFrom: ["model_providers"],
      },
      {
        path: ["model_reasoning_effort"],
        key: "codexEffort",
        type: "select",
        options: ["", "minimal", "low", "medium", "high", "xhigh"],
      },
      {
        path: ["model_reasoning_summary"],
        key: "codexSummary",
        type: "select",
        options: ["", "auto", "concise", "detailed", "none"],
      },
      {
        path: ["model_verbosity"],
        key: "codexVerbosity",
        type: "select",
        options: ["", "low", "medium", "high"],
      },
      { path: ["model_context_window"], key: "codexContextWindow", type: "number" },
    ],
  },
  {
    key: "codexSandbox",
    fields: [
      // May also be a `{ granular = { … } }` table; the leaf guard locks it then.
      {
        path: ["approval_policy"],
        key: "codexApproval",
        type: "select",
        options: ["", "untrusted", "on-request", "never"],
      },
      {
        path: ["sandbox_mode"],
        key: "codexSandboxMode",
        type: "select",
        options: ["", "read-only", "workspace-write", "danger-full-access"],
      },
      {
        path: ["sandbox_workspace_write", "network_access"],
        key: "codexNetworkAccess",
        type: "boolean",
      },
      {
        path: ["sandbox_workspace_write", "writable_roots"],
        key: "codexWritableRoots",
        type: "string-list",
      },
    ],
  },
  {
    key: "codexUi",
    fields: [
      {
        path: ["file_opener"],
        key: "codexFileOpener",
        type: "select",
        options: ["", "vscode", "vscode-insiders", "windsurf", "cursor", "none"],
      },
      { path: ["hide_agent_reasoning"], key: "codexHideReasoning", type: "boolean" },
      { path: ["show_raw_agent_reasoning"], key: "codexRawReasoning", type: "boolean" },
      // Top-level `web_search` is the mode enum; `tools.web_search` is a separate
      // boolean and is deliberately not modelled alongside it.
      {
        path: ["web_search"],
        key: "codexWebSearch",
        type: "select",
        options: ["", "disabled", "cached", "indexed", "live"],
      },
      { path: ["tools", "view_image"], key: "codexViewImage", type: "boolean" },
    ],
  },
  {
    key: "codexShellEnv",
    fields: [
      {
        path: ["shell_environment_policy", "inherit"],
        key: "codexShellInherit",
        type: "select",
        options: ["", "all", "core", "none"],
      },
      { path: ["shell_environment_policy", "set"], key: "codexShellSet", type: "string-map" },
    ],
  },
  {
    key: "codexHistory",
    fields: [
      {
        path: ["history", "persistence"],
        key: "codexHistoryPersistence",
        type: "select",
        options: ["", "save-all", "none"],
      },
      { path: ["history", "max_bytes"], key: "codexHistoryMaxBytes", type: "number" },
    ],
  },
]

/**
 * `~/.config/opencode/opencode.json`.
 *
 * Excluded: `theme` / `keybinds` / `tui` (deprecated — OpenCode migrated them to
 * `tui.json`, so a form field here would write a key that gets migrated away),
 * `autoupdate` (a `boolean | "notify"` union with no clean widget), and the
 * `provider` / `mcp` / `agent` / `command` / `lsp` maps of objects.
 */
const OPENCODE_SECTIONS: ConfigSection[] = [
  {
    key: "ocGeneral",
    fields: [
      {
        path: ["$schema"],
        key: "ocSchema",
        type: "string",
        placeholder: "https://opencode.ai/config.json",
      },
      {
        path: ["model"],
        key: "ocModel",
        type: "string",
        placeholder: "anthropic/claude-sonnet-4-5",
      },
      { path: ["small_model"], key: "ocSmallModel", type: "string" },
      { path: ["username"], key: "ocUsername", type: "string" },
      {
        path: ["share"],
        key: "ocShare",
        type: "select",
        options: ["", "manual", "auto", "disabled"],
      },
      { path: ["snapshot"], key: "ocSnapshot", type: "boolean" },
      { path: ["subagent_depth"], key: "ocSubagentDepth", type: "number", placeholder: "1" },
      { path: ["default_agent"], key: "ocDefaultAgent", type: "string" },
      {
        path: ["log_level"],
        key: "ocLogLevel",
        type: "select",
        options: ["", "DEBUG", "INFO", "WARN", "ERROR"],
      },
      { path: ["disabled_providers"], key: "ocDisabledProviders", type: "string-list" },
      { path: ["instructions"], key: "ocInstructions", type: "string-list" },
    ],
  },
  {
    // Each of these may instead hold a pattern→action map (`{"git *": "allow"}`);
    // the leaf guard locks the select rather than flattening it to one action.
    key: "ocPermission",
    fields: [
      {
        path: ["permission", "edit"],
        key: "ocPermEdit",
        type: "select",
        options: ["", "allow", "ask", "deny"],
      },
      {
        path: ["permission", "bash"],
        key: "ocPermBash",
        type: "select",
        options: ["", "allow", "ask", "deny"],
      },
      {
        path: ["permission", "webfetch"],
        key: "ocPermWebfetch",
        type: "select",
        options: ["", "allow", "ask", "deny"],
      },
    ],
  },
]

/**
 * The four files, in the order the config section lists them.
 *
 * `~/.claude.json` gets no field schema at all, for three compounding reasons:
 *
 *  1. The Claude CLI rewrites it continuously (`projects`, `tipsHistory`,
 *     `numStartups`, `oauthAccount`). Any read-modify-write can swallow whatever
 *     the CLI wrote in between — and unlike the other three, agentpack has never
 *     written this file, so introducing a second writer is a new risk, not an
 *     existing one.
 *  2. It routinely carries megabytes of conversation index. The 128 KB raw
 *     ceiling means the text editor is normally replaced by a notice, by design.
 *  3. Nothing but `mcpServers` is documented, and that subtree already has a
 *     first-class home in the MCP section.
 *
 * So its "form" is a read-only inventory plus a pointer at the section that
 * should be doing the writing.
 */
export const CONFIG_FILES: ConfigFileDef[] = [
  {
    id: "claudeSettings",
    pathKey: "claudeSettings",
    format: jsonFormat,
    form: { kind: "fields", sections: CLAUDE_SETTINGS_SECTIONS },
    rawLimitBytes: 1_000_000,
  },
  {
    id: "codexConfig",
    pathKey: "codexConfig",
    format: tomlFormat,
    form: { kind: "fields", sections: CODEX_SECTIONS },
    rawLimitBytes: 1_000_000,
  },
  {
    id: "opencodeConfig",
    pathKey: "opencodeConfig",
    format: jsonFormat,
    form: { kind: "fields", sections: OPENCODE_SECTIONS },
    rawLimitBytes: 1_000_000,
  },
  {
    id: "claudeConfig",
    pathKey: "claudeConfig",
    format: jsonFormat,
    form: { kind: "mcpInventory" },
    volatile: true,
    rawLimitBytes: 131_072,
  },
]

/** Every field across every file, for i18n coverage checks and label lookups. */
export function allFields() {
  return CONFIG_FILES.flatMap((f) =>
    f.form.kind === "fields" ? f.form.sections.flatMap((s) => s.fields) : []
  )
}

/** Every section key across every file. */
export function allSectionKeys(): string[] {
  return CONFIG_FILES.flatMap((f) =>
    f.form.kind === "fields" ? f.form.sections.map((s) => s.key) : []
  )
}
