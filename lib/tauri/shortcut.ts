import { isTauri } from "@/lib/tauri"
import { showAndFocusWindow } from "@/lib/tauri/window"

// Thin wrapper over `@tauri-apps/plugin-global-shortcut`. The accelerator is a
// user setting (AppSettings.summonShortcut) and OFF by default — a global
// hotkey is system-wide, so agentpack should not claim one uninvited.
//
// Accelerator syntax is Tauri's: modifiers joined with `+`, e.g.
// "CommandOrControl+Shift+A" (Cmd on macOS, Ctrl elsewhere).

/** The accelerator offered in the UI when the user turns the hotkey on. */
export const DEFAULT_SUMMON_SHORTCUT = "CommandOrControl+Shift+A"

/**
 * Register `accelerator` to re-summon the main window.
 *
 * Returns false when the shortcut is already taken by another app (the plugin
 * rejects the registration) or we're in web mode — the caller surfaces that
 * instead of leaving a toggle switched on that does nothing.
 */
export async function registerSummonShortcut(accelerator: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    const { register, isRegistered } = await import("@tauri-apps/plugin-global-shortcut")
    // Re-registering an accelerator this process already owns throws, and on a
    // hot reload we may still hold it — treat that as success.
    if (await isRegistered(accelerator)) return true
    await register(accelerator, (event) => {
      // `register` fires for both press and release; act once, on press.
      if (event.state === "Pressed") void showAndFocusWindow()
    })
    return true
  } catch {
    return false
  }
}

/** Release `accelerator`. Safe to call when it was never registered. */
export async function unregisterSummonShortcut(accelerator: string): Promise<void> {
  if (!isTauri()) return
  try {
    const { unregister, isRegistered } = await import("@tauri-apps/plugin-global-shortcut")
    if (await isRegistered(accelerator)) await unregister(accelerator)
  } catch {
    // Already gone / plugin unavailable — nothing to release.
  }
}
