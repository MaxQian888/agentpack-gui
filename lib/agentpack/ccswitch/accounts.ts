import type { Provider, ProviderApp, ProviderBackend } from "./types"
import { readStoreRecords } from "../store-json"

/**
 * Named combinations of provider selections — "work" (company gateway for
 * Claude, official login for Codex) versus "personal", switched in one click.
 *
 * A profile stores *which provider row* each app should point at, never a copy
 * of its config and never a credential. `is_current` in the cc-switch DB stays
 * the one real switch; a profile is a preset for it. That is deliberate: two
 * independent switches would drift, and the list's "current" badge would start
 * disagreeing with the profile the user just applied.
 */

export interface AccountProfile {
  id: string
  name: string
  /** Provider ids are backend-local and must never be resolved across stores. */
  backend: ProviderBackend
  /** Provider row id per app. An app that's absent is left untouched. */
  picks: Partial<Record<ProviderApp, string>>
}

export interface AccountStore {
  version: 2
  profiles: AccountProfile[]
}

export const ACCOUNTS_VERSION = 2 as const

/** Path to the on-disk store, beside the existing setup profiles. */
export function accountsPath(home: string): string {
  return `${home}/.agentpack/accounts.json`
}

export function emptyAccountStore(): AccountStore {
  return { version: ACCOUNTS_VERSION, profiles: [] }
}

export function serializeAccounts(store: AccountStore): string {
  return JSON.stringify(store, null, 2) + "\n"
}

/**
 * Parse an accounts.json text. Defensive via {@link readStoreRecords}, the same
 * reader `profile.ts` uses: bad input degrades to an empty store rather than
 * throwing, so a corrupt file never blocks the section from rendering.
 */
export function parseAccounts(json: string): AccountStore {
  const profiles: AccountProfile[] = []
  for (const rec of readStoreRecords(json)) {
    if (typeof rec["id"] !== "string" || typeof rec["name"] !== "string") continue
    const rawPicks = (rec["picks"] ?? {}) as Record<string, unknown>
    const picks: AccountProfile["picks"] = {}
    for (const [app, id] of Object.entries(rawPicks)) {
      if (typeof id === "string" && id) picks[app as ProviderApp] = id
    }
    // Version 1 predated the native store, so every legacy id necessarily
    // points into cc-switch. Treat unknown values the same way instead of ever
    // resolving them against the native store by accident.
    const backend = rec["backend"] === "native" ? "native" : "ccswitch"
    profiles.push({ id: rec["id"], name: rec["name"], backend, picks })
  }
  return { version: ACCOUNTS_VERSION, profiles }
}

/** Snapshot which provider is current for each app right now. */
export function captureAccount(
  id: string,
  name: string,
  backend: ProviderBackend,
  providers: Provider[]
): AccountProfile {
  const picks: AccountProfile["picks"] = {}
  for (const p of providers) if (p.is_current) picks[p.app_type] = p.id
  return { id, name, backend, picks }
}

/** Profiles whose ids belong to the active provider store. */
export function accountsForBackend(
  profiles: AccountProfile[],
  backend: ProviderBackend
): AccountProfile[] {
  return profiles.filter((profile) => profile.backend === backend)
}

/**
 * The providers a profile needs to make current.
 *
 * Picks whose row no longer exists are dropped rather than failing the switch —
 * a profile saved before a provider was deleted should still apply to the apps
 * it can. Apps already pointing at the right row are skipped so applying a
 * profile twice is a no-op instead of a pile of redundant writes (each of which
 * would take a backup snapshot).
 */
export function resolveAccount(profile: AccountProfile, providers: Provider[]): Provider[] {
  const byId = new Map(providers.map((p) => [p.id, p]))
  const out: Provider[] = []
  for (const id of Object.values(profile.picks)) {
    const p = byId.get(id)
    if (p && !p.is_current) out.push(p)
  }
  return out
}

/** Picks that no longer resolve, so the UI can say a profile is partly stale. */
export function missingPicks(profile: AccountProfile, providers: Provider[]): ProviderApp[] {
  const ids = new Set(providers.map((p) => p.id))
  return Object.entries(profile.picks)
    .filter(([, id]) => !ids.has(id))
    .map(([app]) => app as ProviderApp)
}
