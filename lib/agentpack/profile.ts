import type { Plan } from "./types"
import { readStoreRecords } from "./store-json"

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

/**
 * Strip `apiBaseUrl` / `apiToken` from a profile saved before relay config moved
 * into the provider list. Applying such a profile must not re-introduce a second
 * writer for the agent CLIs' endpoint; the endpoint itself is unaffected, it is
 * just managed from the provider list now.
 */
function dropLegacyRelay(plan: Plan): Plan {
  const net = plan.network
  if (!net) return plan
  // Rebuilt from known fields rather than spread, so nothing a future (or older)
  // shape smuggles in survives.
  return { ...plan, network: { npmRegistry: net.npmRegistry, proxy: net.proxy } }
}

export function serializeProfiles(store: ProfileStore): string {
  return JSON.stringify(store, null, 2) + "\n"
}

/**
 * Parse a profiles.json text. Defensive via {@link readStoreRecords}: invalid /
 * empty / wrong-shape input degrades to an empty store rather than throwing, so
 * a corrupt file never blocks the UI. Only entries with an id, name and plan
 * object are kept.
 */
export function parseProfiles(json: string): ProfileStore {
  const profiles: Profile[] = []
  for (const rec of readStoreRecords(json)) {
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
        plan: dropLegacyRelay(rec["plan"] as Plan),
      })
    }
  }
  return { version: PROFILE_VERSION, profiles }
}
