/**
 * The cleanup section's disk scan.
 *
 * Split out of the component so the "what is on this machine" question has one
 * answer with one shape, and so the section can be tested by handing it rows
 * rather than by mocking the bridge twice over.
 */

import {
  CLEANUP_CONFIG_TARGETS,
  CLEANUP_TARGETS,
  rowsFrom,
  specsForAll,
  type CleanupConfigTarget,
  type CleanupRoots,
  type CleanupRow,
} from "@/lib/agentpack/cleanup"
import type { OS, Paths } from "@/lib/agentpack/types"
import { cleanupRoots, cleanupScan, readTextFile } from "@/lib/tauri/commands"

export interface CleanupScanResult {
  roots: CleanupRoots
  /** One row per path target that exists and holds something. */
  rows: CleanupRow[]
  /** Config-key targets whose file currently has something to clear. */
  configTargets: CleanupConfigTarget[]
  /**
   * A path target that couldn't be read at all. Same honesty rule as the
   * dashboard: "couldn't read" is never rendered as "nothing here", because the
   * user would then believe a clean machine that isn't.
   */
  degraded: boolean
}

/**
 * Measure every catalog candidate, then keep the ones that turned out to be real.
 *
 * `olderThanDays` is passed straight through so the numbers on screen are the
 * numbers the age filter would actually remove — a row that says "1.9 GB" while
 * the slider says "keep the last 30 days" is a lie the user only discovers after
 * pressing the button.
 */
export async function scanCleanup(
  paths: Paths,
  os: OS,
  olderThanDays?: number
): Promise<CleanupScanResult> {
  const roots = await cleanupRoots()
  const stats = await cleanupScan(specsForAll(CLEANUP_TARGETS, roots, os, olderThanDays))
  const rows = rowsFrom(CLEANUP_TARGETS, stats)

  // Config targets are decided by reading the file, not by `stat`ing it: an
  // existing settings.json with no `hooks` key has nothing to offer, and a row
  // that stays on screen doing nothing is worse than no row.
  const configTargets: CleanupConfigTarget[] = []
  for (const target of CLEANUP_CONFIG_TARGETS) {
    try {
      const text = await readTextFile(paths[target.file])
      if (target.present(text)) configTargets.push(target)
    } catch {
      // Unreadable config: leave it out rather than offer to rewrite a file we
      // could not parse. `mergeFile` would read it again anyway and fail there.
    }
  }

  return {
    roots,
    rows,
    configTargets,
    degraded: rows.some((r) => r.degraded),
  }
}
