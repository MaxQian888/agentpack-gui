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

/**
 * Every MCP target, in the order the UI lists them — and therefore the order a
 * derived target list comes out in, so it never depends on the user's click order.
 */
export const MCP_TARGETS: readonly McpTarget[] = ["claude", "codex", "opencode"]

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
  /**
   * Minimum Node.js MAJOR version the package declares in its `engines` field.
   * npm refuses to install below it, so the plan checks the detected Node first
   * and surfaces a readable note instead of letting the install fail on an
   * EBADENGINE deep in the log. Only meaningful for npm-installed CLIs.
   */
  minNodeMajor?: number
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
  /**
   * GitHub Releases as a last-resort install route — used when the platform has
   * no package manager path at all (cc-switch on Linux), and as the final rung
   * of the recovery ladder when winget/brew fail on the network. agentpack
   * downloads the asset itself through a proxy-aware, mirror-capable client, so
   * this works on networks where the package managers simply can't reach out.
   */
  release?: ReleaseSource
  /** Fallback note shown when install is null for the current OS. */
  manualNote?: string
}

/**
 * Where to find a tool's installable release assets.
 *
 * The release is resolved live from the GitHub API and the asset picked by
 * matching `pattern` against the real asset names — never a hard-coded download
 * URL, so an upstream rename of the installer file doesn't silently break the
 * fallback for everyone.
 */
export interface ReleaseSource {
  /** `owner/name`. */
  repo: string
  /** Per-OS asset name matcher (a regex source string, matched case-insensitively). */
  asset: Partial<Record<OS, ReleaseAssetMatch>>
}

export interface ReleaseAssetMatch {
  /** Regex source matched against the asset file name. */
  pattern: string
  /**
   * Optional per-architecture refinement, tried before `pattern`. macOS ships
   * separate Intel and Apple-Silicon builds, and installing the wrong one either
   * fails outright or runs under Rosetta.
   */
  arch?: Partial<Record<Arch, string>>
}

/** CPU architectures we distinguish when picking a release asset. */
export type Arch = "x64" | "arm64"

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

/**
 * Launcher for a stdio catalog server. `npx` runs an npm package; `uvx` runs a
 * PyPI package (some reference servers are published only to PyPI — notably
 * `mcp-server-fetch`, which has no npm counterpart). Defaults to `npx`.
 */
export type McpRuntime = "npx" | "uvx"

/** An MCP server offered in the catalog. Display text lives in the i18n catalog. */
export interface McpServer {
  id: string
  transport: McpTransport
  /** Which catalog section this server is grouped under in the management UI. */
  category: McpCategory
  /** How a stdio server is launched. Omit for the `npx` default. */
  runtime?: McpRuntime
  /** For stdio: the package spec, e.g. "@upstash/context7-mcp" (npx) or "mcp-server-fetch" (uvx). */
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

/**
 * How the proxy section behaves. `off` leaves every surface untouched; `system`
 * adopts whatever the OS / ambient environment already advertises (discovered,
 * then written like a manual value so the CLIs see it too); `manual` uses the
 * URLs typed into the form.
 */
export type ProxyMode = "off" | "system" | "manual"

/**
 * A config surface the proxy is written into. `claude` is the only agent CLI
 * with a documented config field (`settings.json` → `env`); Codex and OpenCode
 * read the process environment only, so `shell` is what reaches them.
 */
export type ProxyTarget = "claude" | "npm" | "git" | "shell"

/** Every target, in the order the UI lists them (also the plan's step order). */
export const PROXY_TARGETS: readonly ProxyTarget[] = ["claude", "npm", "git", "shell"]

/**
 * Proxy settings, rich enough for the corporate cases the agent CLIs document:
 * per-scheme URLs, a bypass list, basic auth, a custom CA bundle and mTLS client
 * certificates. `allUrl` (SOCKS) is honored by npm/git/curl but NOT by Claude
 * Code, which documents no SOCKS support — the UI warns instead of silently
 * writing something that won't work.
 */
export interface ProxyConfig {
  mode: ProxyMode
  /** Proxy for http:// traffic (HTTP_PROXY). Falls back to `httpsUrl`. */
  httpUrl?: string
  /** Proxy for https:// traffic (HTTPS_PROXY). Falls back to `httpUrl`. */
  httpsUrl?: string
  /** SOCKS / catch-all proxy (ALL_PROXY). Not supported by Claude Code. */
  allUrl?: string
  /** Bypass list (NO_PROXY): comma- or space-separated hosts, or `*`. */
  noProxy?: string
  /** Basic-auth user, merged into the proxy URL when applied. */
  username?: string
  /** Basic-auth password — a secret: masked in the UI, redacted on export. */
  password?: string
  /** Extra CA bundle for a TLS-inspecting proxy (NODE_EXTRA_CA_CERTS). */
  caCertPath?: string
  /** Skip TLS verification (NODE_TLS_REJECT_UNAUTHORIZED=0) — unsafe, opt-in. */
  insecureTls?: boolean
  /** mTLS client certificate (CLAUDE_CODE_CLIENT_CERT). */
  clientCertPath?: string
  /** mTLS client private key (CLAUDE_CODE_CLIENT_KEY). */
  clientKeyPath?: string
  /** Passphrase for an encrypted client key — a secret, like `password`. */
  clientKeyPassphrase?: string
  /** Which config surfaces to write the proxy into. */
  targets: ProxyTarget[]
}

/**
 * Network configuration the user opted into.
 *
 * Relay endpoints/tokens deliberately do NOT live here: they are provider rows
 * (see `ccswitch/types.ts`), so there is exactly one writer for the agent CLIs'
 * endpoint config. This block only covers what a plan run owns outright.
 */
export interface NetworkConfig {
  /** npm registry mirror URL. */
  npmRegistry?: string
  /** Proxy settings; absent => never configured (same effect as `mode: "off"`). */
  proxy?: ProxyConfig
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
  /** `~/.agentpack/mcp-disabled.json` — agentpack's stash for Claude servers disabled via remove-and-remember. */
  mcpDisabledStore: string
  /**
   * The login shell's rc file (`~/.zshrc`, `~/.bashrc`, `config.fish`), where the
   * proxy export block goes so Codex / OpenCode — which read the process
   * environment and have no proxy config of their own — see it. Empty on Windows,
   * which uses `setx` instead of an rc file.
   */
  shellProfile: string
  os: OS
}

export type StepKind =
  | "command"
  | "releaseInstall"
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
  /**
   * Wholly different routes to the same outcome, tried in order if this command
   * fails **on the network** and no mirror/proxy rewrite of it worked either
   * (see `lib/agentpack/network/recovery.ts`).
   *
   * These are full steps rather than command rewrites because that's what they
   * genuinely are — scoop instead of winget, a GitHub Release instead of a
   * package manager — and modelling them as steps means they inherit dry-run
   * preview and step reporting for free. Fallbacks are never nested: a fallback
   * that fails is the end of the line.
   */
  fallbacks?: StepDescriptor[]
}

/**
 * Download a tool's installer straight from its GitHub Releases and run it.
 *
 * Three side effects in one step (resolve the release, fetch the asset, run the
 * installer), because to the user it is one thing: "install cc-switch". The
 * runner logs each phase, and dry-run renders it without touching the network.
 */
export interface ReleaseInstallStep extends StepBase {
  kind: "releaseInstall"
  /** Display name of the tool being installed, for log lines. */
  title: string
  source: ReleaseSource
  os: OS
  arch: Arch
  /** GitHub download mirror prefix, or null for direct. */
  mirrorPrefix: string | null
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
  /**
   * SkillInstallTarget[] — kept as strings so agentpack types stay
   * skills-agnostic. The bundled catalog installs into any of the four skill
   * roots (claude/codex/opencode/agents); the onboarding plan only ever fills
   * claude/codex.
   */
  targets: string[]
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
  /** Replace an existing skill (set only after the user resolves a conflict). */
  overwrite?: boolean
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
  | ReleaseInstallStep
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

/**
 * How a step that first failed on the network was rescued. Present only when a
 * retry actually succeeded, so the UI can both explain what changed and offer to
 * make it permanent — nothing was written to the machine to get here.
 */
export interface StepRecovery {
  /** Remedy id from the ladder (`npm-registry`, `proxy`, …) or `fallback:<id>`. */
  remedyId: string
  /** Human label for the route that worked, e.g. `registry.npmmirror.com`. */
  label: string
  /** How to make it stick, when agentpack knows how to write it. */
  persist?: { kind: "npmRegistry"; url: string } | { kind: "proxy"; url: string }
}

export interface StepReport {
  id: string
  label: string
  status: StepStatus
  output: string[]
  error?: string
  /** Wall-clock execution time, set once the step finishes (done or error). */
  durationMs?: number
  /** Set when the step only succeeded after a network retry (see `StepRecovery`). */
  recovery?: StepRecovery
}
