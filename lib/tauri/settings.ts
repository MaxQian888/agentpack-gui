import { isTauri } from "@/lib/tauri"

// Persisted app settings, backed by `@tauri-apps/plugin-store` (a small JSON KV
// store in the app's data dir). The Zustand store (store/app-store.ts) has no
// persistence, so this is the durable home for cross-launch preferences such as
// "auto-check for updates". In web mode (`pnpm dev`) there's no store — reads
// return defaults and writes no-op, which is fine since these only matter in the
// desktop build. Keep this file the SOLE caller of the store plugin.

export interface AppSettings {
  /** Silently check for app updates on startup. */
  autoCheckUpdates: boolean
  /** A version the user chose to skip; suppresses the update prompt for it. */
  skippedVersion: string | null
  /** Epoch ms of the last successful update check (for display). */
  lastCheckAt: number | null
  /**
   * Whether the first-run welcome wizard has been completed or dismissed. False
   * on a fresh install so the wizard greets a newcomer once; set true after they
   * install or click "later". The About section can reopen the wizard regardless.
   */
  onboarded: boolean
  /**
   * Whether the user permanently hid the dashboard "quick start" card via its
   * "don't show again". Independent of `onboarded`: the card is a lingering
   * safety net for anyone who skipped the wizard, until they set up an assistant
   * or dismiss it here.
   */
  quickStartDismissed: boolean
  /**
   * Optional URL prefix prepended to GitHub tarball downloads (e.g.
   * `https://gh-proxy.com/`) for networks where github.com is unreachable.
   * Null = direct.
   */
  ghMirrorPrefix: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoCheckUpdates: true,
  skippedVersion: null,
  lastCheckAt: null,
  onboarded: false,
  quickStartDismissed: false,
  ghMirrorPrefix: null,
}

const STORE_FILE = "settings.json"
const SETTINGS_KEY = "app"

async function openStore() {
  const { load } = await import("@tauri-apps/plugin-store")
  // `defaults` is required by StoreOptions; we merge with DEFAULT_SETTINGS in
  // code, so an empty default map is fine. autoSave persists on every set().
  return load(STORE_FILE, { defaults: {}, autoSave: true })
}

/** Load persisted settings merged over defaults; defaults in web mode / on error. */
export async function loadSettings(): Promise<AppSettings> {
  if (!isTauri()) return { ...DEFAULT_SETTINGS }
  try {
    const store = await openStore()
    const saved = await store.get<Partial<AppSettings>>(SETTINGS_KEY)
    return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Merge `patch` into the persisted settings; returns the resulting settings. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch }
  if (!isTauri()) return next
  try {
    const store = await openStore()
    await store.set(SETTINGS_KEY, next)
  } catch {
    // Persisting failed (e.g. no store) — return the merged value regardless so
    // the in-memory UI stays consistent.
  }
  return next
}
