/** Supported operating-system families. */
export type OS = "win" | "mac" | "linux"

/** Which agent CLIs a skill / MCP server can target. */
export type AgentTarget = "claude" | "codex"

/** A concrete command to run, described declaratively so it can be dry-run printed. */
export interface Command {
  /** Executable, e.g. "npm" or "claude". */
  file: string
  /** Arguments, already split (no shell parsing). */
  args: string[]
}

/** A CLI tool that can be installed by the wizard. Display text lives in the i18n catalog (keyed by id). */
export interface CliTool {
  id: "claude-code" | "codex" | "cc-switch"
  /** Binary name to probe on PATH for detection. */
  bin: string
  /** GUI app: detect by PATH lookup only, never execute it (it may open a window). */
  gui?: boolean
  /** Per-OS install command. `null` => not installable that way on this OS. */
  install: Record<OS, Command | null>
  /** Optional per-OS upgrade command. */
  upgrade?: Partial<Record<OS, Command>>
  /** Fallback note shown when install is null for the current OS. */
  manualNote?: string
}

/** A bundled domain skill (shipped as assets/skills/<id>/SKILL.md). Display text lives in the i18n catalog. */
export interface SkillDef {
  id: string
}

/** Transport type for an MCP server. */
export type McpTransport = "stdio" | "http"

/** An MCP server offered in the catalog. Display text lives in the i18n catalog. */
export interface McpServer {
  id: string
  transport: McpTransport
  /** For stdio: the npx package spec, e.g. "@upstash/context7-mcp". */
  npmPackage?: string
  /** Extra args appended after the package (stdio only). */
  extraArgs?: string[]
  /** For http: the remote endpoint URL. */
  url?: string
  /** Env var name a required API key maps to (omit if none needed). */
  keyEnv?: string
}

/** User-entered API key per MCP id (empty string => skipped / placeholder). */
export type McpKeys = Record<string, string>

/** Network configuration the user opted into. */
export interface NetworkConfig {
  /** Custom API base URL / relay endpoint for the agent CLIs. */
  apiBaseUrl?: string
  /** Auth token for the relay endpoint. */
  apiToken?: string
  /** npm registry mirror URL. */
  npmRegistry?: string
}

/** The full plan collected by the wizard, consumed by the runner. */
export interface Plan {
  os: OS
  /** CLI ids the user chose to install. */
  clis: CliTool["id"][]
  /** Skill ids selected, with their install targets. */
  skills: { id: string; targets: AgentTarget[] }[]
  /** MCP ids selected, with their install targets. */
  mcps: { id: string; targets: AgentTarget[] }[]
  /** Keys entered for MCP servers (by mcp id). */
  mcpKeys: McpKeys
  network: NetworkConfig
}

/** Status of a single execution step. */
export type StepStatus = "pending" | "running" | "done" | "error" | "skipped"

/** Absolute paths resolved by the Rust backend (get_paths). */
export interface Paths {
  home: string
  claudeSettings: string
  claudeSkillsDir: string
  codexConfig: string
  codexSkillsDir: string
  ccSwitchSettings: string
  ccSwitchDb: string
  os: OS
}

export type StepKind =
  | "command"
  | "info"
  | "mergeFile"
  | "skillInstall"
  | "skillRemove"
  | "ccProvider"
  | "ccVisibleApps"

interface StepBase {
  id: string
  label: string
}

/** Run a CLI command. `verifyOnly` steps swallow failures into output. */
export interface CommandStep extends StepBase {
  kind: "command"
  command: Command
  verifyOnly?: boolean
}

/** Surface informational lines (e.g. a manual-install note) without side effects. */
export interface InfoStep extends StepBase {
  kind: "info"
  lines: string[]
}

/** Read a config file, apply a pure text transform, write it back. */
export interface MergeFileStep extends StepBase {
  kind: "mergeFile"
  path: string
  merge: (existing: string) => string
  writtenNote: string
}

export interface SkillInstallStep extends StepBase {
  kind: "skillInstall"
  skillId: string
  targets: AgentTarget[]
}

export interface SkillRemoveStep extends StepBase {
  kind: "skillRemove"
  skillId: string
  targets: AgentTarget[]
  dests: string[]
}

export interface CcProviderStep extends StepBase {
  kind: "ccProvider"
  op: "add" | "update" | "delete" | "setCurrent"
  payload: Record<string, unknown>
}

export interface CcVisibleAppsStep extends StepBase {
  kind: "ccVisibleApps"
  path: string
  merge: (existing: string) => string
}

export type StepDescriptor =
  | CommandStep
  | InfoStep
  | MergeFileStep
  | SkillInstallStep
  | SkillRemoveStep
  | CcProviderStep
  | CcVisibleAppsStep

export interface StepReport {
  id: string
  label: string
  status: StepStatus
  output: string[]
  error?: string
}
