/** Supported operating-system families. */
export type OS = "win" | "mac" | "linux"

/** Which agent CLIs a skill can target. */
export type AgentTarget = "claude" | "codex"

/**
 * Which agent CLIs an MCP server can target. A superset of `AgentTarget`:
 * MCP servers additionally support OpenCode (skills do not, so `AgentTarget`
 * stays narrow). Because `AgentTarget ⊆ McpTarget`, existing `AgentTarget[]`
 * call sites remain assignable to `McpTarget[]`.
 */
export type McpTarget = "claude" | "codex" | "opencode"

/** A concrete command to run, described declaratively so it can be dry-run printed. */
export interface Command {
  /** Executable, e.g. "npm" or "claude". */
  file: string
  /** Arguments, already split (no shell parsing). */
  args: string[]
}

/**
 * One way to install a tool (e.g. via npm, pnpm, bun, a native script, winget).
 * A tool can offer several so the user can pick a channel that suits their
 * machine (npm missing, winget blocked by policy, etc.). The first method in a
 * list is the recommended default.
 */
export interface InstallMethod {
  /** Stable key used for selection + i18n label lookup (e.g. "npm", "native", "winget"). */
  id: string
  /** The command this method runs. */
  command: Command
  /**
   * True when the command typically needs administrator rights (e.g. a machine-
   * scope winget install). Surfaced to the user as an elevation hint on failure.
   */
  requiresElevation?: boolean
}

/**
 * How an installed CLI got onto PATH, which decides how to UPGRADE it in place:
 * `npm` → `npm i -g <pkg>@latest`; `native` → re-run the tool's native installer
 * (running npm on a native install would leave a second, shadowing copy).
 */
export type CliInstallManager = "npm" | "native"

/** A CLI tool that can be installed by the wizard. Display text lives in the i18n catalog (keyed by id). */
export interface CliTool {
  id: "claude-code" | "codex" | "cc-switch" | "cc-connect" | "opencode"
  /** Binary name to probe on PATH for detection. */
  bin: string
  /** GUI app: detect by PATH lookup only, never execute it (it may open a window). */
  gui?: boolean
  /** npm package name, used to query the latest published version (npm-based CLIs only). */
  npmPackage?: string
  /** Per-OS install command. `null` => not installable that way on this OS. */
  install: Record<OS, Command | null>
  /**
   * Optional per-OS alternative install methods (npm / pnpm / bun / native
   * script …). When present, the UI offers a chooser; the first entry is the
   * default. When absent, `installMethodsFor` wraps `install[os]` as the sole
   * method, so existing single-method tools keep working unchanged.
   */
  methods?: Partial<Record<OS, InstallMethod[]>>
  /** Optional per-OS upgrade command. */
  upgrade?: Partial<Record<OS, Command>>
  /** Optional per-OS uninstall command (absent OS => surface a manual note). */
  uninstall?: Partial<Record<OS, Command>>
  /** Fallback note shown when install is null for the current OS. */
  manualNote?: string
}

/**
 * A language runtime / toolchain prerequisite (Node.js, Bun). Detected the same
 * way as a non-GUI CLI (`<bin> --version`), but installed through the platform's
 * runtime installer rather than npm. Display text lives in the i18n catalog.
 */
export interface Runtime {
  id: "node" | "bun" | "python" | "uv"
  /** Binary name to probe on PATH for detection. */
  bin: string
  /** Fallback binary name to probe when `bin` is absent (e.g. python3 vs python). */
  altBin?: string
  /** Per-OS install command. `null` => no automated installer on this OS. */
  install: Record<OS, Command | null>
  /**
   * Optional per-OS alternative install methods (e.g. Node via winget vs a
   * user-scope scoop/fnm install that avoids UAC). First entry is the default;
   * absent => `installMethodsFor` wraps `install[os]`.
   */
  methods?: Partial<Record<OS, InstallMethod[]>>
  /**
   * Optional per-OS UPDATE command for an already-installed runtime — `winget
   * upgrade` / `brew upgrade` for OS-managed runtimes, or the tool's own
   * self-update (`bun upgrade`, `uv self update`). Absent OS => no in-place
   * update, so the UI hides the Update action there.
   */
  upgrade?: Partial<Record<OS, Command>>
  /**
   * The vendor's official "latest version" download page. Shown as a fallback
   * when the runtime is installed but NOT owned by the OS package manager its
   * update/reinstall uses (winget/brew) — those commands can't touch a copy that
   * came from an installer, nvm/fnm, scoop, etc., so we link the user to the
   * official installer instead of running a command that would fail or duplicate.
   */
  downloadUrl?: string
  /** Fallback note shown when install is null for the current OS. */
  manualNote?: string
}

/** A bundled domain skill (shipped as assets/skills/<id>/SKILL.md). Display text lives in the i18n catalog. */
export interface SkillDef {
  id: string
}

/** Transport type for an MCP server. */
export type McpTransport = "stdio" | "http"

/**
 * Grouping bucket for the MCP catalog UI, so the management page can present
 * servers under category headers (like a marketplace) rather than one flat list.
 */
export type McpCategory = "memory" | "search" | "web" | "dev" | "reasoning"

/** An MCP server offered in the catalog. Display text lives in the i18n catalog. */
export interface McpServer {
  id: string
  transport: McpTransport
  /** Which catalog section this server is grouped under in the management UI. */
  category: McpCategory
  /** For stdio: the npx package spec, e.g. "@upstash/context7-mcp". */
  npmPackage?: string
  /** Extra args appended after the package (stdio only). */
  extraArgs?: string[]
  /** For http: the remote endpoint URL. */
  url?: string
  /** Env var name a required API key maps to (omit if none needed). */
  keyEnv?: string
  /** Link to the server's official docs / source repo (shown as an external link). */
  docsUrl?: string
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
  /**
   * Chosen install-method id per CLI (by CLI id). Absent id => use that tool's
   * default (first) method. Only set when the user picks a non-default channel.
   */
  cliMethods?: Record<string, string>
  /** Skill ids selected, with their install targets. */
  skills: { id: string; targets: AgentTarget[] }[]
  /** MCP ids selected, with their install targets. */
  mcps: { id: string; targets: McpTarget[] }[]
  /** Keys entered for MCP servers (by mcp id). */
  mcpKeys: McpKeys
  network: NetworkConfig
}

/** Status of a single execution step. */
export type StepStatus = "pending" | "running" | "done" | "error" | "skipped" | "warning"

/** Absolute paths resolved by the Rust backend (get_paths). */
export interface Paths {
  home: string
  claudeSettings: string
  /** `~/.claude.json` — holds user-scope MCP servers (distinct from settings.json). */
  claudeConfig: string
  claudeSkillsDir: string
  codexConfig: string
  codexAuth: string
  codexSkillsDir: string
  /** `~/.config/opencode/opencode.json` (XDG-style path even on Windows). */
  opencodeConfig: string
  opencodeSkillsDir: string
  /** Shared canonical dir used by the skills.sh CLI and read by OpenCode. */
  agentsSkillsDir: string
  ccSwitchSettings: string
  ccSwitchDb: string
  ccConnectDir: string
  ccConnectConfig: string
  os: OS
}

export type StepKind =
  | "command"
  | "info"
  | "mergeFile"
  | "skillInstall"
  | "skillRemove"
  | "skillCopy"
  | "skillRepoInstall"
  | "skillUpdate"
  | "skillBackup"
  | "skillCreate"
  | "ccProvider"
  | "ccVisibleApps"
  | "fileRestore"
  | "snapshot"

interface StepBase {
  id: string
  label: string
  /** Ids of earlier steps this one needs; if any of them failed, this step is skipped. */
  dependsOn?: string[]
}

/** Run a CLI command. `verifyOnly` steps swallow failures into output. */
export interface CommandStep extends StepBase {
  kind: "command"
  command: Command
  verifyOnly?: boolean
  /**
   * True when this command typically needs administrator rights. On a non-zero
   * exit the runner appends an elevation hint (the exact command to re-run in an
   * elevated terminal) instead of a bare failure.
   */
  requiresElevation?: boolean
}

/** Surface informational lines (e.g. a manual-install note) without side effects. */
export interface InfoStep extends StepBase {
  kind: "info"
  lines: string[]
  /**
   * True when the note describes a manual action the user still has to perform
   * (e.g. no automated installer on this OS). The runner reports these as a
   * `warning` rather than a green `done`, so they don't read as "installed".
   */
  manual?: boolean
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
  /** Label-only; execution deletes `dests`. Includes browser sources (opencode/agents). */
  targets: string[]
  dests: string[]
}

/** Copy a local skill folder into agent skills roots (cross-agent copy / import). */
export interface SkillCopyStep extends StepBase {
  kind: "skillCopy"
  srcPath: string
  dirName: string
  /** SkillInstallTarget[] — kept as strings so agentpack types stay skills-agnostic. */
  targets: string[]
  /** Destination dirs, precomputed for dry-run preview. */
  dests: string[]
}

/** Install skills picked from a fetched GitHub repo scan (see skills.rs). */
export interface SkillRepoInstallStep extends StepBase {
  kind: "skillRepoInstall"
  scanId: string
  skills: { relPath: string; dirName: string }[]
  targets: string[]
  /** Destination dirs (skill × target), precomputed for dry-run preview. */
  dests: string[]
  /** `owner/name` — recorded as provenance for later update checks. */
  repo: string
  /** Ref (branch/tag/sha) the skills came from. */
  ref: string
}

/**
 * Re-sync a managed (GitHub-installed) skill from its origin repo. The backend
 * reads the skill's `.agentpack-origin.json` to know what to re-fetch.
 */
export interface SkillUpdateStep extends StepBase {
  kind: "skillUpdate"
  /** An installed path of the skill (its origin manifest drives the re-fetch). */
  path: string
  dirName: string
  /** Skill sources to refresh. */
  targets: string[]
  /** Destination dirs, precomputed for dry-run preview. */
  dests: string[]
  /** GitHub download mirror prefix, or null for direct. */
  mirrorPrefix: string | null
}

/** Back up a skill's directory (before deletion) into the restorable history. */
export interface SkillBackupStep extends StepBase {
  kind: "skillBackup"
  /** Canonical/primary skill path to copy into the backup store. */
  path: string
  dirName: string
}

/** Create a new hand-authored skill (`<root>/<name>/SKILL.md`) in each target. */
export interface SkillCreateStep extends StepBase {
  kind: "skillCreate"
  name: string
  targets: string[]
  content: string
  /** Destination dirs, precomputed for dry-run preview. */
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

/** Restore a config file from a previously written `.agentpack.bak` snapshot. */
export interface FileRestoreStep extends StepBase {
  kind: "fileRestore"
  path: string
  backupPath: string
}

/** Snapshot the cc-switch DB + live configs into the listable backup history. */
export interface SnapshotStep extends StepBase {
  kind: "snapshot"
  reason: string
}

export type StepDescriptor =
  | CommandStep
  | InfoStep
  | MergeFileStep
  | SkillInstallStep
  | SkillRemoveStep
  | SkillCopyStep
  | SkillRepoInstallStep
  | SkillUpdateStep
  | SkillBackupStep
  | SkillCreateStep
  | CcProviderStep
  | CcVisibleAppsStep
  | FileRestoreStep
  | SnapshotStep

export interface StepReport {
  id: string
  label: string
  status: StepStatus
  output: string[]
  error?: string
  /** Wall-clock execution time, set once the step finishes (done or error). */
  durationMs?: number
}
