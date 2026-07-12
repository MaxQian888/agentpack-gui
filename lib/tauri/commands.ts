import { invoke, Channel } from "@tauri-apps/api/core"
import type { AgentTarget, Command, Paths } from "@/lib/agentpack/types"
import type { Provider, ProviderApp } from "@/lib/agentpack/ccswitch/types"
import type { HistorySource, ListResult, SessionDetail } from "@/lib/history/types"
import type { RepoScan, SkillsScanResult } from "@/lib/skills/types"

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

export const readTextFile = (path: string) => invoke<string>("read_text_file", { path })

export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content })

export const removeDir = (path: string) => invoke<void>("remove_dir", { path })

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path })

/** Installed skill ids in a skills dir — sub-dirs with a `SKILL.md` ([] when missing). */
export const listSkills = (path: string) => invoke<string[]>("list_skills", { path })

export const installSkill = (id: string, targets: AgentTarget[]) =>
  invoke<string[]>("install_skill", { id, targets })

/** Scan the four global skills roots (claude/codex/opencode/agents) with SKILL.md inline. */
export const skillsScan = () => invoke<SkillsScanResult>("skills_scan")

/** Copy a local skill folder into each target root (cross-agent copy / folder import). */
export const installSkillFromDir = (src: string, dirName: string, targets: string[]) =>
  invoke<string[]>("install_skill_from_dir", { src, dirName, targets })

/** Download a GitHub repo tarball and list the skills it contains (read-only). */
export const fetchRepoSkills = (url: string) => invoke<RepoScan>("fetch_repo_skills", { url })

/** Install previously fetched repo skills (by rel path) into each target root. */
export const installRepoSkills = (scanId: string, relPaths: string[], targets: string[]) =>
  invoke<string[]>("install_repo_skills", { scanId, relPaths, targets })

/** Delete a repo scan's temp dir (also swept automatically after 24h). */
export const cleanupRepoScan = (scanId: string) => invoke<void>("cleanup_repo_scan", { scanId })

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
