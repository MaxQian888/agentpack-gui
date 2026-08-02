import { invoke, Channel } from "@tauri-apps/api/core"
import type { Command, Paths } from "@/lib/agentpack/types"
import type {
  ProxyEnvSnapshot,
  SystemProxySnapshot,
  ToolProxySnapshot,
} from "@/lib/agentpack/network/discovery"
import type { Provider, ProviderApp } from "@/lib/agentpack/ccswitch/types"
import type { ReleaseInfo } from "@/lib/agentpack/release"
import type {
  HistorySource,
  ListResult,
  ScanProgress,
  SessionDetail,
  UsageSeriesResult,
} from "@/lib/history/types"
import type {
  RepoScan,
  SkillBackup,
  SkillFile,
  SkillsScanResult,
  SkillUpdateResult,
} from "@/lib/skills/types"
import type { UpdateQuery } from "@/lib/skills/updates"
import type { CleanupRoots, CleanupSpec, CleanupStat } from "@/lib/agentpack/cleanup"

// Typed wrappers around the custom Rust commands (src-tauri/src/*.rs). Keep this
// file as the SOLE caller of `invoke` for agentpack — UI/runner import these.

export const getPaths = () => invoke<Paths>("get_paths")

export interface RunCommandOpts {
  /** Operation id so this run can be cancelled mid-flight via `cancelCommand`. */
  opId?: string
  /** Hard timeout; the backend kills the process tree if it's exceeded. */
  timeoutSecs?: number
  /** When it aborts, the running process (and its children) is killed. */
  signal?: AbortSignal
  /**
   * Windows only: run through a UAC-elevating wrapper so machine-scope installs
   * (winget) succeed instead of failing on permissions. No-op on macOS/Linux.
   */
  elevated?: boolean
  /**
   * Extra environment variables for THIS spawn only — never persisted anywhere.
   * How the recovery ladder retries an install through a mirror or a proxy
   * (`HTTPS_PROXY`, `HOMEBREW_BOTTLE_DOMAIN`, `UV_DEFAULT_INDEX`, …) without
   * touching the user's shell rc, npm config or agent settings.
   */
  env?: Record<string, string>
}

/**
 * Run a command, streaming each output line to `onLine` via a Tauri channel.
 * Resolves with the process exit code. Rejects with `TIMEOUT_ERR` if the backend
 * killed it on timeout, or "command not found: …" if the binary isn't on PATH.
 *
 * When `opId` + `signal` are given, aborting the signal kills the process tree
 * (the backend looks the child up by `opId`).
 */
export async function runCommand(
  cmd: Command,
  onLine: (line: string) => void,
  opts: RunCommandOpts = {}
): Promise<number> {
  const onEvent = new Channel<string>()
  onEvent.onmessage = onLine
  const { opId, timeoutSecs, signal, elevated, env } = opts
  if (opId && signal) {
    if (signal.aborted) void cancelCommand(opId)
    else signal.addEventListener("abort", () => void cancelCommand(opId), { once: true })
  }
  return invoke<number>("run_command", {
    file: cmd.file,
    args: cmd.args,
    onEvent,
    opId: opId ?? null,
    timeoutSecs: timeoutSecs ?? null,
    elevated: elevated ?? null,
    env: env ?? null,
  })
}

/** Kill a running `runCommand` (and its child tree) by its operation id. */
export const cancelCommand = (opId: string) => invoke<void>("cancel_command", { opId })

/** Sentinel the backend rejects with when a command is killed on timeout. */
export const TIMEOUT_ERR = "agentpack:timeout"

/**
 * Launch the cc-switch desktop app detached so it self-creates its SQLite DB on
 * first run; resolves once spawned, not on exit. The backend resolves its real
 * install path (winget/brew install it off PATH), so no path is passed here.
 */
export const launchCcSwitch = () => invoke<void>("launch_cc_switch")

/**
 * Open a desktop app by the name it is installed under — `CliTool.appBundle`.
 * Detached, so it resolves once spawned rather than when the window appears.
 * Rejects when the app isn't there, which is the signal the caller wants: the
 * "open Claude" button should say so rather than appear to do nothing.
 */
export const launchApp = (appBundle: string) => invoke<void>("launch_app", { appBundle })

/**
 * Ask cc-switch to quit (gracefully first, forced only if it won't), and wait
 * for it to actually exit. Resolves `false` when it outlived both attempts —
 * a result the UI explains rather than an error.
 *
 * This is what unblocks provider editing: agentpack refuses to write the DB
 * while cc-switch holds it, and until now the only way out was to go quit the
 * app yourself and come back.
 */
export const quitCcSwitch = () => invoke<boolean>("quit_cc_switch")

/**
 * Whether the cc-switch desktop app is running. Prefer this over
 * `isProcessRunning("cc-switch")`: on macOS the process name is the binary
 * inside the .app bundle, not the CLI id, and the backend resolves it.
 */
export const ccSwitchRunning = () => invoke<boolean>("cc_switch_running")

export const detectCli = (bin: string, gui: boolean, appBundle?: string) =>
  invoke<{ installed: boolean; version?: string }>("detect_cli", { bin, gui, appBundle })

/** Detect a runtime, falling back to its alternate binary name (python → python3). */
export async function detectRuntime(rt: {
  bin: string
  altBin?: string
}): Promise<{ installed: boolean; version?: string }> {
  const d = await detectCli(rt.bin, false)
  if (d.installed || !rt.altBin) return d
  return detectCli(rt.altBin, false)
}

/** Latest published version of an npm package, or null if it can't be determined. */
export const latestVersion = (pkg: string) =>
  invoke<string | null>("latest_version", { package: pkg })

/**
 * Whether npm's global prefix owns `pkg` — i.e. the CLI was installed via
 * `npm i -g`. False means it was put on PATH some other way (the native
 * installer), which decides how to upgrade it without leaving a duplicate.
 */
export const npmOwns = (pkg: string) => invoke<boolean>("npm_owns", { package: pkg })

/**
 * Whether the OS package manager (`winget` on Windows, `brew` on macOS) owns an
 * installed package — i.e. it can be updated/reinstalled in place. False means it
 * was put on PATH some other way (a vendor installer, nvm/fnm, scoop…), so the UI
 * offers a download link instead of an update that would fail or duplicate.
 */
export const pkgManagerOwns = (manager: "winget" | "brew", id: string) =>
  invoke<boolean>("pkg_manager_owns", { manager, id })

export const isProcessRunning = (name: string) => invoke<boolean>("is_process_running", { name })

/**
 * Spawn the cc-connect bridge detached; resolves once spawned, not on exit
 * (`runCommand` would block until the service exits, which it never does).
 *
 * Pass `configPath` so the service reads the same config.toml this app edits —
 * cc-connect otherwise prefers a `config.toml` in its working directory. The
 * spawn also carries `--force`, which clears cc-connect's instance lock so a
 * restart can't lose a race with the process it just stopped.
 */
export const startCcConnect = (configPath?: string) =>
  invoke<void>("start_cc_connect", { configPath })

/**
 * Stop every running cc-connect process (idempotent no-op when none). Also
 * kills whatever listens on the given service ports — npm installs run the
 * bridge under a `node` wrapper that a name-based kill misses.
 */
export const stopCcConnect = (ports: number[]) => invoke<void>("stop_cc_connect", { ports })

/** Whether something listens on 127.0.0.1:port (service liveness probe). */
export const probePort = (port: number) => invoke<boolean>("probe_port", { port })

/** Whether a command resolves on PATH — the stdio half of the MCP health check. */
export const commandOnPath = (command: string) => invoke<boolean>("command_on_path", { command })

/**
 * TCP-reachability + connect latency for an arbitrary host:port — the http half
 * of the MCP health check. Returns `{ reachable, latencyMs }`; an unresolvable or
 * refused endpoint resolves to `reachable: false` rather than rejecting.
 */
export const probeHost = (host: string, port: number, timeoutMs?: number) =>
  invoke<{ reachable: boolean; latencyMs: number | null }>("probe_host", {
    host,
    port,
    timeoutMs: timeoutMs ?? null,
  })

// ── Proxy discovery / verification (src-tauri/src/net.rs) ────────────────────

/** Proxy variables the agentpack process inherited from the user's shell. */
export const proxyEnvSnapshot = () => invoke<ProxyEnvSnapshot>("proxy_env_snapshot")

/** The OS proxy panel (scutil / Internet Settings / gsettings). */
export const systemProxySnapshot = () => invoke<SystemProxySnapshot>("system_proxy_snapshot")

/** Proxy-related config already set in npm and git. */
export const toolProxySnapshot = () => invoke<ToolProxySnapshot>("tool_proxy_snapshot")

/** Outcome of one real request through a proxy (mirrors Rust `ProxyCheckResult`). */
export interface ProxyCheckResult {
  ok: boolean
  status?: number
  latencyMs?: number
  /** "ok" | "proxy-auth" | "proxy-refused" | "unreachable" | "dns" | "timeout" | … */
  reason: string
}

/**
 * Send one real GET through `proxyUrl` and report status + latency. Pass null to
 * test the direct route instead (the "compare without a proxy" baseline).
 */
export const proxyCheck = (proxyUrl: string | null, testUrl: string, timeoutMs?: number) =>
  invoke<ProxyCheckResult>("proxy_check", {
    proxyUrl,
    testUrl,
    timeoutMs: timeoutMs ?? null,
  })

/**
 * Point agentpack's OWN traffic at a proxy: its HTTP client (skill tarballs, the
 * MCP registry) and every child process it spawns (npm, git, the CLIs). Pass an
 * empty config to go back to direct.
 */
export const setProcessProxy = (config: {
  http?: string
  https?: string
  all?: string
  noProxy?: string
}) => invoke<void>("set_process_proxy", { config })

// ── Release direct install (src-tauri/src/download.rs) ──────────────────────

/** Latest published release of `repo`, resolved live so a renamed asset still resolves. */
export const githubLatestRelease = (repo: string, mirrorPrefix: string | null) =>
  invoke<ReleaseInfo>("github_latest_release", { repo, mirrorPrefix })

/**
 * Current build named by a vendor's own Squirrel-style `RELEASES.json` — the
 * route for desktop apps that don't publish through GitHub Releases. Comes back
 * in the same shape, carrying the single build it names as one asset.
 */
export const manifestLatestRelease = (url: string) =>
  invoke<ReleaseInfo>("manifest_latest_release", { url })

/** Progress of an in-flight asset download (mirrors Rust `DownloadProgress`). */
export interface DownloadProgress {
  received: number
  /** 0 when the server sent no `Content-Length`. */
  total: number
}

/**
 * Download a release asset to a temp file and resolve with its local path. Goes
 * through agentpack's own proxy-aware HTTP client (and optionally a GitHub
 * mirror), which is the whole reason this beats letting winget do the download.
 */
export async function downloadReleaseAsset(
  url: string,
  fileName: string,
  mirrorPrefix: string | null,
  onProgress: (p: DownloadProgress) => void
): Promise<string> {
  const channel = new Channel<DownloadProgress>()
  channel.onmessage = onProgress
  return invoke<string>("download_release_asset", {
    url,
    fileName,
    mirrorPrefix,
    onProgress: channel,
  })
}

/**
 * Install a downloaded package (.exe/.msi/.dmg/.zip/.deb/.AppImage), streaming
 * each command it runs to `onLine` so a silent install is still auditable.
 * Resolves with the installer's exit code.
 */
export async function installPackage(
  path: string,
  onLine: (line: string) => void
): Promise<number> {
  const channel = new Channel<string>()
  channel.onmessage = onLine
  return invoke<number>("install_package", { path, onEvent: channel })
}

/** Raw `GET /v0/servers` body from the official MCP registry (TS maps the schema). */
export const registryFetch = (query?: string, cursor?: string, limit?: number) =>
  invoke<string>("registry_fetch", {
    query: query ?? null,
    cursor: cursor ?? null,
    limit: limit ?? null,
  })

/** Structured result of a real MCP `initialize` probe (see `src-tauri/src/mcp.rs`). */
export interface McpProbeResult {
  ok: boolean
  reason: string
  protocolVersion?: string
  serverName?: string
  toolCount?: number
  latencyMs?: number
}

/** Real MCP handshake against a remote (http/sse) server — distinguishes unauthorized vs unreachable. */
export const mcpProbeRemote = (
  url: string,
  headers: Record<string, string>,
  transport: "http" | "sse"
) => invoke<McpProbeResult>("mcp_probe_remote", { url, headers, transport })

/** Deep-probe a stdio server: spawn it, run `initialize`, read the reply (bounded). */
export const mcpProbeStdio = (
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs?: number
) => invoke<McpProbeResult>("mcp_probe_stdio", { command, args, env, timeoutMs: timeoutMs ?? null })

export const readTextFile = (path: string) => invoke<string>("read_text_file", { path })

export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content })

/** Raw bytes (the PNG usage card) — `writeTextFile` would mangle non-UTF-8. */
export const writeBinaryFile = (path: string, bytes: Uint8Array) =>
  invoke<void>("write_binary_file", { path, bytes: Array.from(bytes) })

export const removeDir = (path: string) => invoke<void>("remove_dir", { path })

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path })

/** Installed skill ids in a skills dir — sub-dirs with a `SKILL.md` ([] when missing). */
export const listSkills = (path: string) => invoke<string[]>("list_skills", { path })

/** Install a bundled skill into each target root (claude/codex/opencode/agents). */
export const installSkill = (id: string, targets: string[]) =>
  invoke<string[]>("install_skill", { id, targets })

/** Scan the four global skills roots (claude/codex/opencode/agents) with SKILL.md inline. */
export const skillsScan = () => invoke<SkillsScanResult>("skills_scan")

/** Copy a local skill folder into each target root (cross-agent copy / folder import). */
export const installSkillFromDir = (src: string, dirName: string, targets: string[]) =>
  invoke<string[]>("install_skill_from_dir", { src, dirName, targets })

/** Download a GitHub repo tarball and list the skills it contains (read-only). */
export const fetchRepoSkills = (url: string) => invoke<RepoScan>("fetch_repo_skills", { url })

/**
 * Install previously fetched repo skills (by rel path) into each target root.
 * `repo`/`ref` are recorded as provenance (`.agentpack-origin.json`) so the skill
 * can later be update-checked and re-synced.
 */
export const installRepoSkills = (
  scanId: string,
  relPaths: string[],
  targets: string[],
  repo: string,
  ref: string
) => invoke<string[]>("install_repo_skills", { scanId, relPaths, targets, repo, gitRef: ref })

/** Delete a repo scan's temp dir (also swept automatically after 24h). */
export const cleanupRepoScan = (scanId: string) => invoke<void>("cleanup_repo_scan", { scanId })

/** List the files inside a skill directory (read-only; dotfiles skipped). */
export const listSkillFiles = (path: string) => invoke<SkillFile[]>("list_skill_files", { path })

/**
 * Re-fetch each managed skill's repo and report whether its content changed
 * since install (by content hash). `mirrorPrefix` mirrors GitHub downloads.
 */
export const checkRepoUpdates = (entries: UpdateQuery[], mirrorPrefix: string | null) =>
  invoke<SkillUpdateResult[]>("check_repo_updates", { entries, mirrorPrefix })

/** Re-sync a managed skill from its origin repo into each target root. */
export const updateSkill = (path: string, targets: string[], mirrorPrefix: string | null) =>
  invoke<string[]>("update_skill", { path, targets, mirrorPrefix })

/** Back up a skill's directory before deletion; returns the backup metadata. */
export const backupSkill = (path: string) => invoke<SkillBackup>("backup_skill", { path })

/** List kept skill backups, newest first. */
export const listSkillBackups = () => invoke<SkillBackup[]>("list_skill_backups")

/** Restore a backed-up skill into each target root. */
export const restoreSkillBackup = (id: string, targets: string[]) =>
  invoke<string[]>("restore_skill_backup", { id, targets })

/** Permanently delete a skill backup. */
export const deleteSkillBackup = (id: string) => invoke<void>("delete_skill_backup", { id })

/**
 * Create a new hand-authored skill (`<root>/<name>/SKILL.md`). Refuses to
 * overwrite an existing skill unless `overwrite` is true (set only after the
 * user resolves the install-conflict dialog).
 */
export const createSkill = (name: string, targets: string[], content: string, overwrite = false) =>
  invoke<string[]>("create_skill", { name, targets, content, overwrite })

export const ccLoadProviders = () => invoke<Provider[]>("cc_load_providers")

export interface CcWriteReq {
  op: "add" | "update" | "delete" | "setCurrent"
  dryRun: boolean
  id?: string
  app: ProviderApp
  form?: { name: string; websiteUrl?: string; notes?: string }
  settingsConfig?: string
}

export const ccWriteProvider = (req: CcWriteReq) => invoke<string[]>("cc_write_provider", { req })

/** State of the cc-switch database (mirrors Rust `SchemaStatus`). */
export interface CcSchemaStatus {
  exists: boolean
  /** `PRAGMA user_version`; 0 for a database agentpack created itself. */
  userVersion: number
  /** Columns the `providers` table lacks. Empty => usable. */
  missingColumns: string[]
}

/**
 * Inspect the cc-switch database without touching it, so the UI can tell "never
 * created" (offer to create it) apart from "too old" (tell the user to launch
 * cc-switch, which migrates on startup).
 */
export const ccSchemaStatus = () => invoke<CcSchemaStatus>("cc_schema_status")

/**
 * Create the cc-switch database when it doesn't exist, so managing providers
 * doesn't require installing and launching cc-switch first. No-op if it's
 * already there — agentpack never migrates someone else's database.
 */
export const ccInitDb = () => invoke<void>("cc_init_db")

/** An agent CLI's own login, for display only (mirrors Rust `LoginStatus`). */
export interface LoginStatus {
  signedIn: boolean
  /** Codex's explicit `auth_mode`; null when the CLI records none. */
  mode: string | null
  plan: string | null
  expiresAt: number | null
  /** Where the answer came from, so the UI can explain a missing plan/expiry. */
  source: string
}

export interface LoginReport {
  claude: LoginStatus
  codex: LoginStatus
}

/**
 * Read each CLI's official login state. Never returns a credential: on macOS,
 * Claude's tokens live in the Keychain and are only probed for existence, so
 * this neither prompts the user nor unlocks a secret.
 */
export const loginStatus = () => invoke<LoginReport>("login_status")

/** Raw result of an authenticated GET (mirrors Rust `HttpGetResult`). */
export interface HttpGetResult {
  status: number | null
  latencyMs: number | null
  body: string
  error: string | null
}

/**
 * Authenticated GET used by the provider "test connection" check. Generic on
 * purpose — the URL and headers come from `ccswitch/probe.ts`, which is where
 * each CLI's auth scheme is already modelled.
 */
export const httpGet = (url: string, headers: Record<string, string>, timeoutMs?: number) =>
  invoke<HttpGetResult>("http_get", { url, headers, timeoutMs })

/** One backed-up file within a snapshot (mirrors Rust `BackupFile`). */
export interface BackupFile {
  originalPath: string
  storedName: string
}

/** A timestamped snapshot of the cc-switch DB + live configs (mirrors Rust `BackupEntry`). */
export interface BackupEntry {
  id: string
  ts: number
  reason: string
  files: BackupFile[]
}

export const backupSnapshot = (reason: string) => invoke<BackupEntry>("backup_snapshot", { reason })

export const backupList = () => invoke<BackupEntry[]>("backup_list")

/** What a restore wrote, plus the snapshot taken of the state it replaced. */
export interface RestoreResult {
  restoredPaths: string[]
  safetySnapshotId: string
}

export const backupRestore = (id: string) => invoke<RestoreResult>("backup_restore", { id })

/**
 * Scan Claude Code / Codex / OpenCode for chat sessions and return normalized
 * summaries plus any per-source read errors. A source that isn't installed is
 * simply absent (no error). Runs off the main thread in Rust.
 */
export const historyListSessions = (onProgress?: (p: ScanProgress) => void) =>
  invoke<ListResult>("history_list_sessions", { progress: scanChannel(onProgress) })

/**
 * The per-message usage series behind those sessions: packed usage events with
 * real timestamps plus per-session tool tallies. Much larger than the summary
 * list — fetch it only when the usage dashboard needs it.
 */
export const historyUsageSeries = (onProgress?: (p: ScanProgress) => void) =>
  invoke<UsageSeriesResult>("history_usage_series", { progress: scanChannel(onProgress) })

/**
 * A `Channel` for scan progress. Rust takes it unconditionally (Tauri can't
 * deserialize an optional channel argument), so callers that don't care still
 * get one — it simply drops what it receives.
 */
function scanChannel(onProgress?: (p: ScanProgress) => void): Channel<ScanProgress> {
  const channel = new Channel<ScanProgress>()
  if (onProgress) channel.onmessage = onProgress
  return channel
}

/**
 * Load one session's transcript. `path` is the summary's `path` handle.
 * Oversized tool payloads arrive truncated — see `historyGetPartText`.
 */
export const historyGetSession = (source: HistorySource, path: string) =>
  invoke<SessionDetail>("history_get_session", { source, path })

/**
 * Fetch the full text behind a truncated part, using the part's `ref`. Covers
 * both inline payloads capped for transport and tool output the CLI externalized
 * to its own file.
 */
export const historyGetPartText = (source: HistorySource, path: string, ref: string) =>
  invoke<string>("history_get_part_text", { source, path, ref })

// ── Environment cleanup (src-tauri/src/cleanup.rs) ──────────────────────────

/** The directories the cleanup catalog builds its paths under. */
export const cleanupRoots = () => invoke<CleanupRoots>("cleanup_roots")

/**
 * Measure what each spec currently matches. Read-only — nothing here renames or
 * unlinks, so the section can rescan freely and the review panel can quote real
 * numbers before the user commits.
 */
export const cleanupScan = (specs: CleanupSpec[]) =>
  invoke<CleanupStat[]>("cleanup_scan", { specs })

/** What a cleanup run did. `quarantineId` is the run's restore point. */
export interface CleanupOutcome {
  quarantineId: string | null
  bytes: number
  removed: number
  /** Per-path failures. A locked file is reported, never allowed to abort the run. */
  errors: string[]
}

export const cleanupApply = (specs: CleanupSpec[], mode: "quarantine" | "delete") =>
  invoke<CleanupOutcome>("cleanup_apply", { specs, mode })

/** One quarantine batch, as listed. Counts only — a batch can hold 10k files. */
export interface QuarantineEntry {
  id: string
  ts: number
  bytes: number
  items: number
  targetIds: string[]
}

export const cleanupQuarantineList = () => invoke<QuarantineEntry[]>("cleanup_quarantine_list")

/** What a restore put back, and what it skipped (a path the CLI reoccupied). */
export interface QuarantineRestore {
  restored: number
  bytes: number
  errors: string[]
}

export const cleanupQuarantineRestore = (id: string) =>
  invoke<QuarantineRestore>("cleanup_quarantine_restore", { id })

/** Permanently delete one batch, or every batch when `id` is omitted. Returns bytes freed. */
export const cleanupQuarantinePurge = (id?: string) =>
  invoke<number>("cleanup_quarantine_purge", { id: id ?? null })
