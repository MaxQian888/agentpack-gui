import { invoke, Channel } from "@tauri-apps/api/core"
import type { AgentTarget, Command, Paths } from "@/lib/agentpack/types"
import type { Provider, ProviderApp } from "@/lib/agentpack/ccswitch/types"

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
  const { opId, timeoutSecs, signal } = opts
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
  })
}

/** Kill a running `runCommand` (and its child tree) by its operation id. */
export const cancelCommand = (opId: string) => invoke<void>("cancel_command", { opId })

/** Sentinel the backend rejects with when a command is killed on timeout. */
export const TIMEOUT_ERR = "agentpack:timeout"

/** Launch a GUI app (e.g. cc-switch) detached; resolves once spawned, not on exit. */
export const launchApp = (cmd: Command) =>
  invoke<void>("launch_app", { file: cmd.file, args: cmd.args })

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

export const isProcessRunning = (name: string) => invoke<boolean>("is_process_running", { name })

export const readTextFile = (path: string) => invoke<string>("read_text_file", { path })

export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content })

export const removeDir = (path: string) => invoke<void>("remove_dir", { path })

export const pathExists = (path: string) => invoke<boolean>("path_exists", { path })

/** Immediate child entry names of a directory ([] when missing / not a dir). */
export const listDir = (path: string) => invoke<string[]>("list_dir", { path })

export const installSkill = (id: string, targets: AgentTarget[]) =>
  invoke<string[]>("install_skill", { id, targets })

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
