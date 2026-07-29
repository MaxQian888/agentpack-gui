/**
 * Shared reader for the `~/.agentpack/*.json` stores.
 *
 * `profiles.json` and `accounts.json` are different shapes but the same kind of
 * file: a versioned wrapper around a `profiles` array, written by us, sitting
 * somewhere a user can hand-edit it. Both must degrade identically — unreadable
 * or wrong-shape input yields no entries rather than throwing, so a corrupt file
 * slows nobody down and never blocks a section from rendering.
 *
 * Only the per-record validation differs between them, and that stays with each
 * store, which is the part that actually knows its own shape.
 */
export function readStoreRecords(json: string): Record<string, unknown>[] {
  if (!json.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return []
  }
  if (!data || typeof data !== "object") return []
  const raw = (data as Record<string, unknown>)["profiles"]
  if (!Array.isArray(raw)) return []
  // Non-object entries are dropped here so each caller's loop only ever deals
  // with a record it can index.
  return raw.filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
}
