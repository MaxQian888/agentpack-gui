/**
 * Pure helpers for the "update installed skills" flow: extract the update-check
 * queries from grouped rows and map results back onto rows/sources. Unit-tested;
 * the network round-trip itself lives in Rust (`check_repo_updates`).
 */
import { SKILL_SOURCES } from "./browse"
import type { SkillOrigin, SkillRow, SkillSource, SkillUpdateResult } from "./types"

/** One installed entry to check: its path + the provenance to re-fetch. */
export interface UpdateQuery {
  path: string
  origin: SkillOrigin
}

/** Every installed entry (across sources) that carries GitHub provenance. */
export function updateQueries(rows: SkillRow[]): UpdateQuery[] {
  const out: UpdateQuery[] = []
  for (const row of rows) {
    for (const source of SKILL_SOURCES) {
      const entry = row.entries[source]
      if (entry?.origin) out.push({ path: entry.path, origin: entry.origin })
    }
  }
  return out
}

/** Whether a row has any updatable (origin-bearing) entry. */
export function isManaged(row: SkillRow): boolean {
  return SKILL_SOURCES.some((s) => Boolean(row.entries[s]?.origin))
}

/** Build a path→result lookup from a check response. */
export function indexUpdates(results: SkillUpdateResult[]): Map<string, SkillUpdateResult> {
  return new Map(results.map((r) => [r.path, r]))
}

/** Sources of a row that have a pending update, given a path→result map. */
export function rowUpdateTargets(
  row: SkillRow,
  byPath: Map<string, SkillUpdateResult>
): SkillSource[] {
  return SKILL_SOURCES.filter((s) => {
    const entry = row.entries[s]
    return entry ? Boolean(byPath.get(entry.path)?.hasUpdate) : false
  })
}
