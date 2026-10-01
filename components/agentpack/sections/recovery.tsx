"use client"

import { useCallback, useEffect, useState } from "react"
import { CircleAlert, HelpCircle, RefreshCw, ShieldCheck } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useMounted } from "@/hooks/use-mounted"
import { isTauri } from "@/lib/tauri"
import { backupList, cleanupQuarantineList, fileStat, listSkillBackups } from "@/lib/tauri/commands"
import { BACKUP_SUFFIX, fileRestoreStep } from "@/lib/agentpack/plan"
import { runApplied } from "@/lib/agentpack/report"
import type { Paths, StepDescriptor } from "@/lib/agentpack/types"
import type { NavigateIntent, SectionKey } from "@/lib/agentpack/workspaces"
import {
  buildTimeline,
  configBackupCandidates,
  countBySafety,
  emptyTimeline,
  pathsToCheck,
  restoreSafety,
  type LiveFileStat,
  type RecoveryKind,
  type RecoveryPoint,
  type RecoveryTimeline,
  type RestoreSafety,
} from "@/lib/agentpack/recovery"
import type { DashboardScan } from "./dashboard"
import { SectionShell } from "./section-shell"
import { SectionStatus } from "./section-status"
import { useRunnerCtx } from "../run/runner-context"

const SAFETY: Record<RestoreSafety, { icon: LucideIcon; className: string }> = {
  stale: { icon: CircleAlert, className: "text-[var(--hm-danger)]" },
  unknown: { icon: HelpCircle, className: "text-[var(--hm-ink-3)]" },
  safe: { icon: ShieldCheck, className: "text-[var(--hm-ink-3)]" },
}

/** An unmeasured value is an em dash — never a plausible-looking zero. */
const UNMEASURED = "—"

/**
 * Which section owns the two restores this page hands off.
 *
 * Not a shortcut: `restoreSkillBackup` needs the list of agents to restore
 * *into*, and a quarantine batch is a bag of paths worth reading before putting
 * back. Neither answer is one this page can ask for, and a Restore button that
 * silently picked one would be the page deciding something the user hasn't.
 */
const OWNER: Partial<Record<RecoveryKind, SectionKey>> = {
  skillBackup: "skills",
  quarantineBatch: "cleanup",
}

/**
 * The recovery centre: every way back this app has left behind, in one list.
 *
 * Four mechanisms take backups here — provider-store snapshots, skill backups,
 * quarantined cleanup batches, and the `.agentpack.bak` written beside an edited
 * config — and until this page each was listed only by whichever screen happened
 * to own it. `lib/agentpack/recovery` folds them; this renders them.
 *
 * The column that justifies the page is the verdict. Restoring a snapshot over a
 * config the user edited by hand an hour ago throws that hour away silently, and
 * none of the four mechanisms notices, because each only knows about its own
 * writes. So each row is measured against the live file and says one of three
 * things — and "can't tell" is one of them, because the reading this must never
 * produce is a confident "nothing to lose" drawn from an absence of information.
 *
 * The config backups are found and dated by stat'ing the `.agentpack.bak`
 * sibling of every file the app edits, on every read. The dashboard scan only
 * reports one for two of those files and is cached, so listing from it hid most
 * of them and kept showing one after it was gone. An undated point can never be
 * judged safe — one extra stat is the whole difference between a warning and a
 * shrug.
 */
/** What one pass over the four stores produced. */
interface Reading {
  timeline: RecoveryTimeline
  live: readonly LiveFileStat[]
}

/**
 * Read all four backup stores and measure what a restore would write over.
 *
 * Deliberately outside the component and free of React state: the startup read
 * runs from an effect, and setting state synchronously inside one cascades
 * renders (the same reason the shell's own startup scan sets state in its async
 * continuation).
 *
 * Each source is caught on its own — one unreadable store must not blank the
 * three that opened — and `degraded` is what keeps that honest: a short list
 * that says it is short beats a short list that looks complete.
 */
async function readSources(paths: Paths | null): Promise<Reading> {
  let degraded = false
  const guard = async <T,>(read: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read
    } catch {
      degraded = true
      return fallback
    }
  }

  const [configSnapshots, skillBackups, quarantine] = await Promise.all([
    guard(backupList(), []),
    guard(listSkillBackups(), []),
    guard(cleanupQuarantineList(), []),
  ])
  // Find and date each config backup from its own `.agentpack.bak` sibling. An
  // undated point can never be judged safe, so the stat that finds it also
  // dates it.
  const found = await Promise.all(
    (paths ? configBackupCandidates(paths) : []).map(async (backup) => ({
      backup,
      stat: await guard(fileStat(`${backup.path}${BACKUP_SUFFIX}`), MISSING),
    }))
  )
  const configBackups = found
    .filter(({ stat }) => stat.exists)
    .map(({ backup, stat }) => ({ ...backup, takenAt: stat.modifiedMs }))
  const timeline = buildTimeline({
    configSnapshots,
    skillBackups,
    quarantine,
    configBackups,
    measured: true,
    degraded,
  })
  const live = await Promise.all(
    pathsToCheck(timeline.points).map(async (path) => ({
      path,
      ...(await guard(fileStat(path), MISSING)),
    }))
  )
  return { timeline, live }
}

/** What an unreadable path reads as: absent, and with no usable date. */
const MISSING = { exists: false, bytes: 0, modifiedMs: 0 }

export function RecoverySection({
  scan,
  onNavigate,
}: {
  /**
   * The last dashboard scan. Only its arrival is used — as the cue to re-read,
   * since a new scan means a run just finished. What exists is stat'ed here.
   */
  scan: DashboardScan | null
  /** Follow a hand-off to the section that owns that kind of restore. */
  onNavigate?: (section: SectionKey, intent?: NavigateIntent) => void
}) {
  const t = useT()
  const r = t.recoveryCentre
  const mounted = useMounted()
  const paths = useAppStore((s) => s.paths)
  const [timeline, setTimeline] = useState<RecoveryTimeline>(emptyTimeline())
  const [live, setLive] = useState<readonly LiveFileStat[]>([])
  const [refreshing, setRefreshing] = useState(false)
  /** The point a stale-restore confirmation is currently about, or null. */
  const [confirming, setConfirming] = useState<RecoveryPoint | null>(null)
  const { run } = useRunnerCtx()

  const apply = useCallback((reading: Reading) => {
    setTimeline(reading.timeline)
    setLive(reading.live)
  }, [])

  // Fire and forget, with state set in the continuation. `cancelled` keeps a
  // read that outlives the section from writing into an unmounted tree. `scan`
  // is not read — a new one means a run just finished and may have left a
  // backup behind, which is reason enough to look again.
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    void readSources(paths).then((reading) => {
      if (!cancelled) apply(reading)
    })
    return () => {
      cancelled = true
    }
  }, [scan, paths, apply])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      apply(await readSources(paths))
    } finally {
      setRefreshing(false)
    }
  }, [paths, apply])

  /**
   * The step a restore amounts to, or null for the two kinds this page hands
   * off. Both of these overwrite live config in one shot, which is why they go
   * through the review panel rather than firing on a dialog — the same reason
   * the provider-store restore does, and the same panel.
   */
  const stepFor = (point: RecoveryPoint): StepDescriptor | null => {
    if (point.kind === "configSnapshot") {
      return {
        kind: "snapshotRestore",
        id: `snapshot-restore-${point.restoreId}`,
        label: t.steps.snapshotRestore(point.restoreId),
        snapshotId: point.restoreId,
      }
    }
    if (point.kind === "configBackupFile") return fileRestoreStep(point.restoreId, t)
    return null
  }

  const doRestore = async (point: RecoveryPoint) => {
    const step = stepFor(point)
    if (!step) return
    const reports = await run([step], {
      activity: { title: step.label, source: "restore" },
    })
    // Walked away from the panel: nothing ran, so there is nothing to report.
    if (reports.length === 0) return
    if (reports.some((report) => report.status === "error")) toast.error(r.restoreFailed)
    // Stopped before the step ran: it comes back `skipped`, and "Restored."
    // would be a success toast for a write that never happened.
    else if (!runApplied(reports)) toast.message(r.restoreCancelled)
    else {
      // No toast: the review panel says the restore went through.
      // The list is now wrong about this machine — a restore changes the very
      // mtimes every verdict on this page was measured against.
      await refresh()
    }
  }

  /**
   * A stale restore is the one destructive case on this page, so it asks first
   * and the review panel still asks after. Two gates for the case that actually
   * loses work is proportionate; asking twice for every restore would teach
   * people to click through both.
   */
  const requestRestore = (point: RecoveryPoint, safety: RestoreSafety) => {
    if (safety === "stale") setConfirming(point)
    else void doRestore(point)
  }

  const desktop = mounted && isTauri()
  const counts = countBySafety(timeline.points, live)
  const newest = timeline.points.find((p) => p.takenAt > 0)
  const readout = (value: string | number) => (timeline.measured ? String(value) : UNMEASURED)

  return (
    // Wide like the three tabs beside it. At the reading measure its heading
    // sat ~50px right of theirs, so switching tabs made the page jump sideways.
    <SectionShell
      wide
      title={r.title}
      subtitle={r.subtitle}
      actions={
        desktop ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            {refreshing ? r.refreshing : r.refresh}
          </Button>
        ) : undefined
      }
    >
      <SectionStatus
        label={r.summaryLabel}
        facts={[
          { label: r.metricTotal, value: readout(timeline.points.length) },
          { label: r.metricStale, value: readout(counts.stale) },
          {
            label: r.metricNewest,
            value: newest ? formatWhen(newest.takenAt) : readout(r.undated),
          },
        ]}
        notes={[
          !desktop && mounted ? r.notTauri : null,
          // The first read is in flight: say why the facts are dashes.
          desktop && !timeline.measured ? r.loadingNote : null,
          timeline.degraded ? r.degradedNote : null,
        ]}
      />

      {desktop && timeline.measured && timeline.points.length === 0 ? (
        <p className="text-sm text-muted-foreground">{r.empty}</p>
      ) : null}

      {timeline.points.length > 0 ? (
        <section aria-label={r.listPanel} className="rounded-[var(--hm-radius-surface)] border">
          <ul className="divide-y">
            {timeline.points.map((point) => (
              <Row
                key={point.id}
                point={point}
                safety={restoreSafety(point, live)}
                onRestore={requestRestore}
                onOpen={onNavigate}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{r.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {r.confirmBody(confirming ? formatWhen(confirming.takenAt) : "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const point = confirming
                setConfirming(null)
                if (point) void doRestore(point)
              }}
            >
              {r.confirmProceed}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  )
}

/**
 * One restore point. The verdict is a mark plus a word — the mark is
 * `aria-hidden`, so the word is what actually carries it.
 */
function Row({
  point,
  safety,
  onRestore,
  onOpen,
}: {
  point: RecoveryPoint
  safety: RestoreSafety
  onRestore: (point: RecoveryPoint, safety: RestoreSafety) => void
  /** Absent when nothing was wired up; the hand-off button is then omitted. */
  onOpen?: (section: SectionKey, intent?: NavigateIntent) => void
}) {
  const t = useT()
  const r = t.recoveryCentre
  const { icon: Icon, className } = SAFETY[safety]
  const owner = OWNER[point.kind]
  const handOff = point.kind === "skillBackup" ? r.handOffSkill : r.handOffQuarantine
  const meta = [
    r.kind[point.kind],
    point.name,
    point.takenAt > 0 ? formatWhen(point.takenAt) : r.undated,
    point.items ? r.covers(point.items) : undefined,
    point.reason,
  ].filter(Boolean)

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{r.safety[safety]}</p>
        {/* One clipped line: five wrapping meta items turn a 56px row into a
            200px one at phone width, and a list whose row height follows the
            viewport can't be scanned. */}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
        <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {owner ? handOff : r.safetyHint[safety]}
        </p>
      </div>
      {owner ? (
        onOpen ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap"
            // A skill backup lands on the Skills backups list itself, where the
            // restore asks which agents to go back into — not on the skills
            // page with the Backups button left to be found.
            onClick={() =>
              owner === "skills" ? onOpen(owner, { skills: "backups" }) : onOpen(owner)
            }
          >
            {r.restoreIn(t.menu[owner === "skills" ? "skills" : "cleanup"])}
          </Button>
        ) : null
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={() => onRestore(point, safety)}
        >
          {r.restore}
        </Button>
      )}
    </li>
  )
}

/** Epoch ms as a plain local date-time. Locale-formatted, not hand-assembled. */
function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString()
}
