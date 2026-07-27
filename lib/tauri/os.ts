import { isTauri } from "@/lib/tauri"
import type { OS } from "@/lib/agentpack/types"

// Thin wrapper over `@tauri-apps/plugin-os`. Dynamically imported + `isTauri()`
// -gated like the other bridges; in web mode (`pnpm dev`) every read returns
// null so callers fall back to their own defaults.
//
// Note the plugin's `platform()`/`version()`/`arch()` are SYNCHRONOUS once the
// module is loaded (the values are injected at webview init, not fetched over
// IPC) — the promises here come only from the dynamic import.

/** The host OS, in the `OS` vocabulary the plan/registry use. Null in web mode. */
export async function detectOs(): Promise<OS | null> {
  if (!isTauri()) return null
  try {
    const { platform } = await import("@tauri-apps/plugin-os")
    switch (platform()) {
      case "macos":
        return "mac"
      case "windows":
        return "win"
      default:
        // Every other Tauri desktop target (linux, freebsd, the other BSDs)
        // uses the same XDG paths and package managers as linux.
        return "linux"
    }
  } catch {
    return null
  }
}

/** e.g. `"macOS 15.3 · aarch64"`, for the About section. Null in web mode. */
export async function osSummary(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const { type, version, arch } = await import("@tauri-apps/plugin-os")
    const names: Record<string, string> = {
      macos: "macOS",
      windows: "Windows",
      linux: "Linux",
      ios: "iOS",
      android: "Android",
    }
    const name = names[type()] ?? type()
    return `${name} ${version()} · ${arch()}`
  } catch {
    return null
  }
}
