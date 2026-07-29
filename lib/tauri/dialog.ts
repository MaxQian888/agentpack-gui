import { isTauri } from "@/lib/tauri"

/**
 * Native folder picker (local skill import). Isolated in its own module so
 * component tests can mock it without touching the plugin. Returns the chosen
 * absolute path, or null when cancelled / running in web mode.
 */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === "string" ? picked : null
}

/** One `{ name, extensions }` entry for the pickers below. */
export interface FileFilter {
  name: string
  extensions: string[]
}

/**
 * Native open-file picker. Returns the chosen absolute path, or null when
 * cancelled / running in web mode.
 */
export async function pickFile(filters?: FileFilter[]): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const picked = await open(filters ? { filters } : {})
  return typeof picked === "string" ? picked : null
}

/**
 * Native save-file picker. Returns the chosen absolute path, or null when
 * cancelled / running in web mode.
 */
export async function pickSavePath(options?: {
  defaultPath?: string
  filters?: FileFilter[]
}): Promise<string | null> {
  if (!isTauri()) return null
  const { save } = await import("@tauri-apps/plugin-dialog")
  const picked = await save(options ?? {})
  return typeof picked === "string" ? picked : null
}
