import { isTauri } from "@/lib/tauri"
import type { RepoSource } from "@/lib/skills/types"
import type { Surface } from "@/lib/agentpack/presets"
import type { OS, ProxyConfig } from "@/lib/agentpack/types"
import type { ProviderBackend } from "@/lib/agentpack/ccswitch/types"
import type { SectionKey } from "@/lib/agentpack/workspaces"
import { DEFAULT_UI_SCALE, type UiScale } from "@/lib/agentpack/appearance"

/**
 * Where a half-finished first run got to. Written when the wizard is closed
 * *incidentally* (Esc, the overlay, following the tour link) so the next launch
 * resumes instead of restarting — the wizard's own state is component-local and
 * dies with the process.
 */
export interface OnboardingProgress {
  step: string
  preset: string
  surface: Surface
}

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
   * Whether the first-run welcome wizard has been *deliberately* finished with.
   * False on a fresh install so the wizard greets a newcomer; set true only when
   * they install or click "later". Closing the wizard any other way (Esc, the
   * overlay, the tour link) leaves this false and records `onboardingProgress`
   * instead — a mis-click is not consent to never be guided again. The About
   * section can reopen the wizard regardless.
   */
  onboarded: boolean
  /**
   * The step / bundle / surface a suspended wizard was on, or null when there's
   * nothing to resume. Cleared once `onboarded` goes true.
   */
  onboardingProgress: OnboardingProgress | null
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
  /**
   * Saved GitHub skill repositories the user can browse & install from (the
   * skills "marketplace"). Empty by default; the UI offers recommended sources
   * to add.
   */
  skillRepoSources: RepoSource[]
  /**
   * The proxy the user applied, kept so agentpack's own downloads keep going
   * through it after a restart (the plan itself isn't persisted). Re-applied to
   * the backend on startup. Null = never configured / cleared.
   */
  proxy: ProxyConfig | null
  /**
   * Global accelerator that re-summons the window from anywhere, or null when
   * the user hasn't enabled one. Off by default on purpose: a global hotkey is
   * system-wide, so agentpack shouldn't claim a key combination uninvited.
   */
  summonShortcut: string | null
  /**
   * What the user pays per month for their coding-assistant subscriptions, in
   * USD. Purely for the "API-equivalent vs what you actually pay" comparison on
   * the usage dashboard — null hides that card rather than guessing a plan,
   * since local transcripts carry no evidence of which one is in force.
   */
  monthlySubscriptionUsd: number | null
  /** Provider record store selected in Accounts & relays. */
  providerBackend: ProviderBackend
  /**
   * Root font size as a percentage of the browser default, which — because
   * every length in the app is a rem — is the interface scale for the whole
   * window. Only the four values Preferences offers are meaningful; anything
   * else falls back to 100 rather than writing an arbitrary size onto <html>.
   */
  uiScale: UiScale
  /**
   * Collapse animation and transition durations regardless of what the OS
   * reports. An override in one direction only: it can turn motion off, never
   * back on for someone whose system asked for less of it.
   */
  reduceMotion: boolean
  /**
   * Where the app lands at launch. Null = the overview dashboard, which is what
   * every install has always done. Stored as a section key rather than a
   * workspace so "open on Chat history" is expressible.
   */
  startupSection: SectionKey | null
  /**
   * "Build commands for" in Preferences: the OS install commands are generated
   * for, or null for this machine's own. Remembered because the page says the
   * desktop app remembers its preferences; restored at startup only when it is
   * one of the three OS ids. Never exported in a backup — it describes this
   * install, not a setup to carry elsewhere. Optional because it arrived after
   * the rest: a settings object written before it simply has no override.
   */
  osOverride?: OS | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoCheckUpdates: true,
  skippedVersion: null,
  lastCheckAt: null,
  onboarded: false,
  onboardingProgress: null,
  quickStartDismissed: false,
  ghMirrorPrefix: null,
  skillRepoSources: [],
  proxy: null,
  summonShortcut: null,
  monthlySubscriptionUsd: null,
  providerBackend: "native",
  uiScale: DEFAULT_UI_SCALE,
  reduceMotion: false,
  startupSection: null,
  osOverride: null,
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
    // A persisted object without this field comes from an Agentpack release
    // where provider management always used CC Switch. Preserve that choice on
    // upgrade; a genuinely fresh install (no object) starts in native mode.
    const migratedBackend = saved && !("providerBackend" in saved) ? "ccswitch" : undefined
    return {
      ...DEFAULT_SETTINGS,
      ...(migratedBackend ? { providerBackend: migratedBackend } : {}),
      ...(saved ?? {}),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Merge `patch` into the persisted settings and flush them to disk, rejecting
 * when the store refuses. `saveSettings` swallows that failure so a preference
 * toggle never throws at the UI; the runner's `appSettings` step uses this one
 * instead, because a step that reports `done` has to mean the write happened.
 */
export async function writeSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch }
  if (!isTauri()) return next
  const store = await openStore()
  await store.set(SETTINGS_KEY, next)
  await store.save()
  return next
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
