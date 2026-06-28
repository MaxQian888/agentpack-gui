import type { Plan } from "./types"

/**
 * Named, switchable setups. A profile is just a snapshot of a Plan plus an id /
 * name / timestamp, stored locally at `~/.agentpack/profiles.json`. Secrets are
 * kept (this is the user's own machine — same trust level as the cc-switch DB),
 * so applying a profile restores keys without re-entry.
 */
export interface Profile {
  id: string
  name: string
  /** Unix epoch ms when the profile was saved (stamped by the caller). */
  createdAt: number
  plan: Plan
}

export interface ProfileStore {
  version: 1
  profiles: Profile[]
}

export const PROFILE_VERSION = 1 as const

/** Path to the on-disk profile store under the user's home directory. */
export function profilesPath(home: string): string {
  return `${home}/.agentpack/profiles.json`
}

export function emptyProfileStore(): ProfileStore {
  return { version: PROFILE_VERSION, profiles: [] }
}

export function serializeProfiles(store: ProfileStore): string {
  return JSON.stringify(store, null, 2) + "\n"
}

/**
 * Parse a profiles.json text. Defensive: invalid / empty / wrong-shape input
 * degrades to an empty store rather than throwing, so a corrupt file never
 * blocks the UI. Only entries with an id, name and plan object are kept.
 */
export function parseProfiles(json: string): ProfileStore {
  if (!json.trim()) return emptyProfileStore()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return emptyProfileStore()
  }
  const raw = Array.isArray(data["profiles"]) ? (data["profiles"] as unknown[]) : []
  const profiles: Profile[] = []
  for (const p of raw) {
    if (!p || typeof p !== "object") continue
    const rec = p as Record<string, unknown>
    if (
      typeof rec["id"] === "string" &&
      typeof rec["name"] === "string" &&
      rec["plan"] &&
      typeof rec["plan"] === "object"
    ) {
      profiles.push({
        id: rec["id"],
        name: rec["name"],
        createdAt: typeof rec["createdAt"] === "number" ? rec["createdAt"] : 0,
        plan: rec["plan"] as Plan,
      })
    }
  }
  return { version: PROFILE_VERSION, profiles }
}
