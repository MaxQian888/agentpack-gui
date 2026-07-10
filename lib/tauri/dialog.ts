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
