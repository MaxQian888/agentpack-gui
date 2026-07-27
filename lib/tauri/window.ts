import { isTauri } from "@/lib/tauri"

// Thin wrapper over the core window API (`@tauri-apps/api/window`), used by the
// custom titlebar on the undecorated Windows/Linux window and by the global
// "summon agentpack" hotkey. Permissions live in capabilities/desktop.json
// (core:window:allow-minimize / -toggle-maximize / -close / -show /
// -unminimize / -set-focus; the drag region needs -start-dragging).
//
// Everything is `isTauri()`-gated so the same components render in `pnpm dev`.

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  return getCurrentWindow()
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return
  await (await currentWindow()).minimize()
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return
  await (await currentWindow()).toggleMaximize()
}

/** Closes the window; Tauri turns this into a `closeRequested` event first. */
export async function closeWindow(): Promise<void> {
  if (!isTauri()) return
  await (await currentWindow()).close()
}

/** Current maximized state; false in web mode. */
export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false
  return (await currentWindow()).isMaximized()
}

/**
 * Subscribe to window resizes so the maximize button can swap its icon
 * (resizing is the only signal Tauri gives for maximize/restore). Returns an
 * unlisten function; a no-op one in web mode.
 */
export async function onWindowResized(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  return (await currentWindow()).onResized(() => handler())
}

/**
 * Bring the window back to the front. Mirrors the Rust `focus_main_window` the
 * single-instance plugin uses, and the order matters for the same reason: tao's
 * `setFocus` bails out early when the window is minimized or reports itself
 * invisible, which is exactly what happens to every window of an app hidden
 * with Cmd+H — so the app has to be un-hidden before any of it takes effect.
 */
export async function showAndFocusWindow(): Promise<void> {
  if (!isTauri()) return
  try {
    // macOS-only; a no-op error on other platforms, which we can ignore.
    const { show } = await import("@tauri-apps/api/app")
    await show()
  } catch {
    // Not macOS, or the app was never hidden — the window calls below suffice.
  }
  const win = await currentWindow()
  await win.unminimize()
  await win.show()
  await win.setFocus()
}
