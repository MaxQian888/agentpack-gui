/**
 * The recovery timeline: every way back, in one list.
 *
 * This app takes four *different* kinds of backup, each written by a different
 * part of it and each listed by its own command — provider-store snapshots
 * (`backup.rs`), skill backups (`skills.rs`), quarantined cleanup batches
 * (`cleanup.rs`), and the `.agentpack.bak` sibling `mergeFile` leaves next to a
 * config it edits. Four lists in four places is four chances for someone to
 * conclude there is no way back from a change there has been a way back from all
 * along.
 *
 * Pure and browser-safe, like `inventory` and `preflight`: the four sources are
 * read by their own commands and folded here.
 *
 * Four rules the shape enforces:
 *
 * 1. **A restore point is a claim that a restore is possible.** Nothing enters
 *    this list that the source didn't report as present, and nothing here
 *    carries an id its own restore command wouldn't accept.
 * 2. **A backup older than the file it would overwrite is dangerous, and says
 *    so.** `restoreSafety` is the whole reason `file_stat` exists: restoring a
 *    snapshot over a config the user edited in a text editor an hour ago throws
 *    that hour away, silently, at the exact moment they were trying to undo
 *    something else.
 * 3. **Unknown is a verdict, not a default.** An undated point, a path nothing
 *    measured, an mtime the platform wouldn't report — each yields `unknown`,
 *    never `safe`. The one reading this model must never produce is a confident
 *    "nothing to lose" drawn from an absence of information.
 * 4. **No content, ever.** A point carries what a restore would touch and when
 *    it was taken. Not the file bodies, not the diff, not the command output —
 *    the same line `activity.ts` draws, for the same reason: this is the model an
 *    export or a disaster-recovery bundle would be built from.
 */

/** Schema version of a folded timeline, for anything that persists one. */
export const RECOVERY_VERSION = 1

/**
 * Which mechanism took the backup. It decides which restore command the id goes
 * to, so it is a closed set rather than a label.
 */
export type RecoveryKind = "configSnapshot" | "configBackupFile" | "skillBackup" | "quarantineBatch"

/** Fold and render order for a tie; the timeline itself is sorted by date. */
export const RECOVERY_KINDS: readonly RecoveryKind[] = [
  "configSnapshot",
  "configBackupFile",
  "skillBackup",
  "quarantineBatch",
]

export interface RecoveryPoint {
  /** `${kind}:${localId}`, unique in a timeline. */
  id: string
  kind: RecoveryKind
  /** The id its own restore command takes — NOT this record's `id`. */
  restoreId: string
  /**
   * When it was taken (epoch ms). **0 means unknown**: a `.agentpack.bak` is
   * found by existence and carries no date of its own. Sorted last, and never
   * compared against an mtime — see `restoreSafety`.
   */
  takenAt: number
  /**
   * Real filesystem paths a restore would write over. Empty when the source
   * doesn't say, which makes the safety verdict `unknown` rather than `safe`.
   */
  paths: readonly string[]
  /** Catalog / target ids this point relates to, for naming it in the UI. */
  targets: readonly string[]
  /** Bytes it holds, when the source measured it. */
  bytes?: number
  /** How many items it covers, when the source counted them. */
  items?: number
  /** Why it was taken, as the source recorded it. Never command output. */
  reason?: string
  /** The user-facing name of the thing, when it has one (a skill's folder). */
  name?: string
  /**
   * True when the restore command itself refuses to overwrite what it finds.
   * `cleanup_quarantine_restore` skips a path the CLI has reoccupied rather than
   * clobbering it, so a quarantine batch cannot destroy newer work — and telling
   * the user it might would train them to ignore the warning that matters.
   */
  selfGuarded?: boolean
}

export interface RecoveryTimeline {
  version: number
  /** Newest first; undated points last. */
  points: readonly RecoveryPoint[]
  /**
   * Whether anything actually listed the sources. False in web mode and before
   * the first read, where an empty timeline means "we haven't looked", not
   * "there is no way back" — and those must be rendered differently.
   */
  measured: boolean
  /** At least one source could not be read, so this list may be short. */
  degraded: boolean
}

/** A provider-store snapshot, as `backup_list` reports it. */
export interface ConfigSnapshotLike {
  id: string
  ts: number
  reason: string
  files: readonly { originalPath: string }[]
}

/** A skill backup, as `list_skill_backups` reports it. */
export interface SkillBackupLike {
  id: string
  name: string
  dirName: string
  source: string
  bytes: number
  createdAt: number
  /**
   * Where restoring it would land, when the caller resolved it (the skill roots
   * live in `lib/skills/paths`). Absent leaves the safety verdict `unknown`
   * rather than inventing a path.
   */
  path?: string
}

/** A quarantined cleanup batch, as `cleanup_quarantine_list` reports it. */
export interface QuarantineBatchLike {
  id: string
  ts: number
  bytes: number
  items: number
  targetIds: readonly string[]
}

/** A config file whose `.agentpack.bak` sibling exists, from the dashboard scan. */
export interface ConfigBackupLike {
  /** The live config's path — what `fileRestoreStep` takes. */
  path: string
  /** Which agent's config this is, for naming it. */
  target: string
  /**
   * When the `.agentpack.bak` sibling was last written, if the caller stat'ed
   * it. The scan only reports that a backup exists, and an undated point can
   * never be judged safe — so a caller that can afford one extra stat should.
   */
  takenAt?: number
}

export interface RecoveryInput {
  configSnapshots?: readonly ConfigSnapshotLike[]
  configBackups?: readonly ConfigBackupLike[]
  skillBackups?: readonly SkillBackupLike[]
  quarantine?: readonly QuarantineBatchLike[]
  /** Whether the sources were actually listed. See `RecoveryTimeline.measured`. */
  measured: boolean
  /**
   * At least one source could not be read — as opposed to being empty. Without
   * it, "you have no skill backups" and "we could not open the skill-backup
   * store" are the same screen, and only one of them means what it says.
   */
  degraded?: boolean
}

export function recoveryId(kind: RecoveryKind, localId: string): string {
  return `${kind}:${localId}`
}

/** Nothing looked at yet. Not "there is no way back". */
export function emptyTimeline(): RecoveryTimeline {
  return { version: RECOVERY_VERSION, points: [], measured: false, degraded: false }
}

/**
 * Fold the four sources into one list, newest first.
 *
 * Undated points sort last rather than first: a `.agentpack.bak` with no date is
 * not "from 1970", and putting it at the top of a timeline would say it is the
 * most recent thing that happened to the machine.
 */
export function buildTimeline(input: RecoveryInput): RecoveryTimeline {
  const points: RecoveryPoint[] = []

  for (const snapshot of input.configSnapshots ?? []) {
    points.push({
      id: recoveryId("configSnapshot", snapshot.id),
      kind: "configSnapshot",
      restoreId: snapshot.id,
      takenAt: snapshot.ts,
      paths: snapshot.files.map((f) => f.originalPath),
      targets: [],
      items: snapshot.files.length,
      reason: snapshot.reason,
    })
  }

  for (const backup of input.configBackups ?? []) {
    points.push({
      id: recoveryId("configBackupFile", backup.path),
      kind: "configBackupFile",
      // `fileRestoreStep` takes the live path and appends the suffix itself.
      restoreId: backup.path,
      takenAt: backup.takenAt ?? 0,
      paths: [backup.path],
      targets: [backup.target],
      items: 1,
    })
  }

  for (const backup of input.skillBackups ?? []) {
    points.push({
      id: recoveryId("skillBackup", backup.id),
      kind: "skillBackup",
      restoreId: backup.id,
      takenAt: backup.createdAt,
      paths: backup.path ? [backup.path] : [],
      targets: [backup.source],
      bytes: backup.bytes,
      name: backup.name,
    })
  }

  for (const batch of input.quarantine ?? []) {
    points.push({
      id: recoveryId("quarantineBatch", batch.id),
      kind: "quarantineBatch",
      restoreId: batch.id,
      takenAt: batch.ts,
      // The original paths aren't in the listing, and they don't need to be: the
      // restore refuses to overwrite anything it finds occupied.
      paths: [],
      targets: [...batch.targetIds],
      bytes: batch.bytes,
      items: batch.items,
      selfGuarded: true,
    })
  }

  return {
    version: RECOVERY_VERSION,
    points: sortPoints(points),
    measured: input.measured,
    degraded: input.degraded ?? false,
  }
}

/**
 * Newest first, undated last, and stable within a timestamp so a refresh doesn't
 * reshuffle rows under the cursor.
 */
export function sortPoints(points: readonly RecoveryPoint[]): RecoveryPoint[] {
  return [...points].sort((a, b) => {
    if (a.takenAt === b.takenAt) return 0
    if (a.takenAt === 0) return 1
    if (b.takenAt === 0) return -1
    return b.takenAt - a.takenAt
  })
}

/**
 * - `safe` — every path this would write over is older than the backup, or
 *   isn't there at all.
 * - `stale` — at least one is NEWER. Restoring discards whatever produced that.
 * - `unknown` — we could not tell. Never rendered as safe.
 */
export type RestoreSafety = "safe" | "stale" | "unknown"

/** One path as it is right now — the shape `fileStat` returns, plus its path. */
export interface LiveFileStat {
  path: string
  exists: boolean
  /** Epoch ms; 0 means the platform wouldn't say, which is not "1970". */
  modifiedMs: number
}

/**
 * Whether restoring this point would throw away newer work.
 *
 * The dangerous case is specific and common: someone edits `~/.claude/settings.json`
 * in a text editor, then comes back here to undo something else, and a restore
 * puts the file back to before their edit. Nothing in the four backup mechanisms
 * notices, because each of them only knows about its own writes.
 *
 * Worst verdict wins, and the absence of information is never `safe`:
 * an undated point, a point that names no path, a path nothing measured, or an
 * mtime the platform wouldn't report all come back `unknown`. A self-guarded
 * point is `safe` because its own restore command refuses to overwrite.
 */
export function restoreSafety(point: RecoveryPoint, live: readonly LiveFileStat[]): RestoreSafety {
  if (point.selfGuarded) return "safe"
  // Nothing to compare against: an undated backup could be older or newer than
  // anything, and saying which would be a guess.
  if (point.takenAt === 0) return "unknown"
  if (point.paths.length === 0) return "unknown"

  const byPath = new Map(live.map((stat) => [stat.path, stat]))
  let sawUnknown = false
  for (const path of point.paths) {
    const stat = byPath.get(path)
    if (!stat) {
      sawUnknown = true
      continue
    }
    // Nothing there means nothing to lose, whatever its recorded mtime says.
    if (!stat.exists) continue
    if (stat.modifiedMs === 0) {
      sawUnknown = true
      continue
    }
    if (stat.modifiedMs > point.takenAt) return "stale"
  }
  return sawUnknown ? "unknown" : "safe"
}

/**
 * Every path a caller must `fileStat` before it can judge these points.
 *
 * Deduped, and self-guarded points contribute nothing — statting paths whose
 * restore refuses to overwrite them anyway is work whose answer changes no
 * verdict.
 */
export function pathsToCheck(points: readonly RecoveryPoint[]): string[] {
  const paths = new Set<string>()
  for (const point of points) {
    if (point.selfGuarded) continue
    for (const path of point.paths) paths.add(path)
  }
  return [...paths]
}

/** How many points sit at each safety verdict, for a summary line. */
export function countBySafety(
  points: readonly RecoveryPoint[],
  live: readonly LiveFileStat[]
): Record<RestoreSafety, number> {
  const counts: Record<RestoreSafety, number> = { stale: 0, unknown: 0, safe: 0 }
  for (const point of points) counts[restoreSafety(point, live)] += 1
  return counts
}
