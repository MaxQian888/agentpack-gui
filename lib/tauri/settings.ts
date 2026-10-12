import { isTauri } from "@/lib/tauri"
import type { RepoSource } from "@/lib/skills/types"
import type { OS, ProxyConfig } from "@/lib/agentpack/types"
import type { ProviderBackend } from "@/lib/agentpack/ccswitch/types"
import type { SectionKey } from "@/lib/agentpack/workspaces"
import { DEFAULT_UI_SCALE, type UiScale } from "@/lib/agentpack/appearance"
import { DEFAULT_PROXY } from "@/lib/agentpack/network/proxy"

/**
 * Where a half-finished first run got to. Written when the wizard is closed
 * *incidentally* (Esc, the overlay) so the next launch resumes instead of
 * restarting — the wizard's own state is component-local and dies with the
 * process.
 *
 * Every field but `step` is optional, and all of them are read back through a
 * narrowing function: this is plain JSON from an earlier version as often as
 * not (one that asked for a bundle and a surface instead of an agent).
 */
export interface OnboardingProgress {
  step: string
  agent?: string
  desktop?: boolean
  /** Whether the proxy step's suggestion was kept. */
  proxy?: boolean
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
   * they press Install now (whatever the run's outcome) or click "later".
   * Closing the wizard any other way (Esc, the overlay) leaves this false and
   * records `onboardingProgress` instead — a mis-click is not consent to never
   * be guided again. Preferences and ⌘K can reopen the wizard regardless.
   */
  onboarded: boolean
  /**
   * The step and answers a suspended wizard was on, or null when there's
   * nothing to resume. Cleared once `onboarded` goes true.
   */
  onboardingProgress: OnboardingProgress | null
  /**
   * Whether the user hid the Overview's Getting started checklist. Independent
   * of `onboarded`: the checklist carries whatever the first run left undone,
   * until every item it shows is measured done or the user hides it here.
   * Preferences can bring it back.
   */
  gettingStartedDismissed: boolean
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
  /**
   * The first-run wizard's Install now was pressed on this install. Such a
   * machine is a newcomer's, so the Getting started checklist shows its whole
   * path — ticked rows and the optional extras included — rather than only
   * what an existing user is missing. Optional for the same reason as
   * `osOverride`.
   */
  startedWithWizard?: boolean
  /** The guided tour has been opened and closed once, which ticks its checklist row. */
  tourSeen?: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoCheckUpdates: true,
  skippedVersion: null,
  lastCheckAt: null,
  onboarded: false,
  onboardingProgress: null,
  gettingStartedDismissed: false,
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
    // A proxy saved without `targets` (an older release wrote none) is filled
    // in the way `setProxy` fills it. Left raw, it never compared equal to the
    // plan's copy — the tray read "1 selected" on every launch and each review
    // rewrote the same proxy — and `hasTarget` would throw on the missing list.
    const proxy =
      saved?.proxy && !Array.isArray(saved.proxy.targets)
        ? { ...saved.proxy, targets: [...DEFAULT_PROXY.targets] }
        : undefined
    return {
      ...DEFAULT_SETTINGS,
      ...(migratedBackend ? { providerBackend: migratedBackend } : {}),
      ...(saved ?? {}),
      ...(proxy ? { proxy } : {}),
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
