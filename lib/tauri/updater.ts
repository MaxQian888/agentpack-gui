import { isTauri } from "@/lib/tauri"

// App self-update bridge. Wraps the `@tauri-apps/plugin-updater` +
// `@tauri-apps/plugin-process` JS APIs and `@tauri-apps/api/app` version. Plugin
// modules are imported dynamically (like config-io.tsx does for plugin-dialog)
// so Tauri code never lands in the web/static-export bundle, and every entry is
// gated by `isTauri()` so the same UI runs in `pnpm dev`. Keep this file the SOLE
// caller of the updater/process plugin APIs.

/** Plain, serializable view of an available update (mirrors plugin `Update`). */
export interface UpdateInfo {
  version: string
  currentVersion: string
  date?: string
  body?: string
}

// The live `Update` handle from the last successful check(). downloadAndInstall
// must run against the same object, so hold it between check and install.
let pendingUpdate: import("@tauri-apps/plugin-updater").Update | null = null

/** Current app version (from the bundle), or null when not running under Tauri. */
export async function getAppVersion(): Promise<string | null> {
  if (!isTauri()) return null
  const { getVersion } = await import("@tauri-apps/api/app")
  return getVersion()
}

/**
 * Check the configured endpoint for a newer release. Returns update metadata, or
 * null when the app is up to date (or not running under Tauri). Throws if the
 * check itself fails (offline, bad signature, misconfigured endpoint) — callers
 * surface that as an error state.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null
  const { check } = await import("@tauri-apps/plugin-updater")
  const update = await check()
  pendingUpdate = update
  if (!update) return null
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    body: update.body,
  }
}

/**
 * Download and install the update found by the last `checkForUpdate()`, reporting
 * a 0–100 percentage to `onProgress`. Call `restartApp()` afterwards to apply it.
 */
export async function downloadAndInstallUpdate(onProgress: (pct: number) => void): Promise<void> {
  if (!pendingUpdate) throw new Error("No update to install — check for updates first.")
  let total = 0
  let downloaded = 0
  await pendingUpdate.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0
        downloaded = 0
        onProgress(0)
        break
      case "Progress":
        downloaded += event.data.chunkLength
        onProgress(total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0)
        break
      case "Finished":
        onProgress(100)
        break
    }
  })
}

/** Relaunch the app so a freshly installed update takes effect. */
export async function restartApp(): Promise<void> {
  if (!isTauri()) return
  const { relaunch } = await import("@tauri-apps/plugin-process")
  await relaunch()
}
