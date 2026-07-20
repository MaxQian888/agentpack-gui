import { invoke, Channel } from "@tauri-apps/api/core"
import type { Command, Paths } from "@/lib/agentpack/types"
import type { Provider, ProviderApp } from "@/lib/agentpack/ccswitch/types"
import type { HistorySource, ListResult, SessionDetail } from "@/lib/history/types"
import type {
  RepoScan,
  SkillBackup,
  SkillFile,
  SkillsScanResult,
  SkillUpdateResult,
} from "@/lib/skills/types"
import type { UpdateQuery } from "@/lib/skills/updates"

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
  const { opId, timeoutSecs, signal, elevated } = opts
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

export const detectCli = (bin: string, gui: boolean) =>
  invoke<{ installed: boolean; version?: string }>("detect_cli", { bin, gui })

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
 */
export const startCcConnect = () => invoke<void>("start_cc_connect")

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

export const backupRestore = (id: string) => invoke<string[]>("backup_restore", { id })

/**
 * Scan Claude Code / Codex / OpenCode for chat sessions and return normalized
 * summaries plus any per-source read errors. A source that isn't installed is
 * simply absent (no error). Runs off the main thread in Rust.
 */
export const historyListSessions = () => invoke<ListResult>("history_list_sessions")

/** Load one session's full transcript. `path` is the summary's `path` handle. */
export const historyGetSession = (source: HistorySource, path: string) =>
  invoke<SessionDetail>("history_get_session", { source, path })
