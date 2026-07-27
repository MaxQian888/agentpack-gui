import { isTauri } from "@/lib/tauri"

/**
 * Copy `value` to the system clipboard. Returns whether it worked.
 *
 * Under Tauri this goes through `@tauri-apps/plugin-clipboard-manager` rather
 * than `navigator.clipboard`: the web API is gated on a secure context and on
 * transient user activation, and WebKitGTK (Linux) rejects it outright — so
 * "copy MCP key" would silently do nothing on some desktops. In web mode
 * (`pnpm dev`) it falls back to `navigator.clipboard`.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (isTauri()) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager")
      await writeText(value)
      return true
    }
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

/** Read the clipboard as plain text; null when unavailable or on failure. */
export async function readTextFromClipboard(): Promise<string | null> {
  try {
    if (isTauri()) {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager")
      return await readText()
    }
    if (!navigator.clipboard) return null
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}
