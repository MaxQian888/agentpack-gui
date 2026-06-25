import { invoke, Channel } from "@tauri-apps/api/core"
import type { AgentTarget, Command, Paths } from "@/lib/agentpack/types"
import type { Provider, ProviderApp } from "@/lib/agentpack/ccswitch/types"

// Typed wrappers around the custom Rust commands (src-tauri/src/*.rs). Keep this
// file as the SOLE caller of `invoke` for agentpack — UI/runner import these.

export const getPaths = () => invoke<Paths>("get_paths")

/**
 * Run a command, streaming each output line to `onLine` via a Tauri channel.
 * Resolves with the process exit code.
 */
export async function runCommand(cmd: Command, onLine: (line: string) => void): Promise<number> {
  const onEvent = new Channel<string>()
  onEvent.onmessage = onLine
  return invoke<number>("run_command", { file: cmd.file, args: cmd.args, onEvent })
}

export const detectCli = (bin: string, gui: boolean) =>
  invoke<{ installed: boolean; version?: string }>("detect_cli", { bin, gui })

export const isProcessRunning = (name: string) => invoke<boolean>("is_process_running", { name })

export const readTextFile = (path: string) => invoke<string>("read_text_file", { path })

export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content })

export const removeDir = (path: string) => invoke<void>("remove_dir", { path })

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
