import { isTauri } from "@/lib/tauri"
import type { Arch } from "@/lib/agentpack/types"

// Thin wrappers over `@tauri-apps/plugin-opener` (open URLs / reveal folders in
// the system file manager) and `@tauri-apps/plugin-notification` (desktop
// notifications). Dynamically imported + `isTauri()`-gated like the other
// bridges; in web mode `openUrl` falls back to `window.open` and the rest no-op.

/** Open a URL in the system's default browser. */
export async function openUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer")
    return
  }
  const { openUrl: open } = await import("@tauri-apps/plugin-opener")
  await open(url)
}

/** Reveal a file/folder path in the system file manager. No-op in web mode. */
export async function revealPath(path: string): Promise<void> {
  if (!isTauri()) return
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener")
  await revealItemInDir(path)
}

/** Open a file with the system's default application (e.g. SKILL.md in an editor). */
export async function openPath(path: string): Promise<void> {
  if (!isTauri()) return
  const { openPath: open } = await import("@tauri-apps/plugin-opener")
  await open(path)
}

/**
 * This machine's CPU architecture, for picking the right release asset.
 *
 * Defaults to x64 — the safe guess, since an x64 build runs under Rosetta on
 * Apple Silicon while an arm64 build simply won't start on an Intel Mac.
 */
export async function hostArch(): Promise<Arch> {
  if (!isTauri()) return "x64"
  try {
    const { arch } = await import("@tauri-apps/plugin-os")
    return arch() === "aarch64" ? "arm64" : "x64"
  } catch {
    return "x64"
  }
}

/** Send a desktop notification, requesting permission first if needed. */
export async function notify(title: string, body: string): Promise<void> {
  if (!isTauri()) return
  const { isPermissionGranted, requestPermission, sendNotification } =
    await import("@tauri-apps/plugin-notification")
  let granted = await isPermissionGranted()
  if (!granted) granted = (await requestPermission()) === "granted"
  if (granted) sendNotification({ title, body })
}
