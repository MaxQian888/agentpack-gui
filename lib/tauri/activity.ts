/**
 * Reading and writing `~/.agentpack/activity.json`.
 *
 * The shape rules and the redaction live in `lib/agentpack/activity` (pure and
 * unit-tested); this is only the disk half. Everything here degrades to "no
 * history" rather than throwing — an unreadable log must never be the reason
 * the overview won't render, and a failed write must never be the reason an
 * install that already succeeded reports failure.
 */

import { isTauri } from "@/lib/tauri"
import { readTextFile, writeTextFile } from "@/lib/tauri/commands"
import {
  ACTIVITY_VERSION,
  activityPath,
  parseActivity,
  pushRecord,
  serializeActivity,
  type ActivityRecord,
} from "@/lib/agentpack/activity"

export async function loadActivity(home: string): Promise<ActivityRecord[]> {
  if (!isTauri()) return []
  try {
    return parseActivity(await readTextFile(activityPath(home))).profiles
  } catch {
    return []
  }
}

/**
 * Append one run and persist. Returns the new list so the caller can put it
 * straight into the store without a re-read.
 *
 * Read-modify-write rather than append-in-memory: the file is the truth, and a
 * second window (or a hand edit between runs) would otherwise be clobbered.
 */
export async function appendActivity(
  home: string,
  record: ActivityRecord
): Promise<ActivityRecord[]> {
  if (!isTauri()) return []
  const existing = await loadActivity(home)
  const next = pushRecord(existing, record)
  try {
    await writeTextFile(
      activityPath(home),
      serializeActivity({ version: ACTIVITY_VERSION, profiles: next })
    )
  } catch {
    // Keep the in-memory list: the run really did happen, and showing it for
    // this session is better than pretending it didn't because a write failed.
  }
  return next
}
