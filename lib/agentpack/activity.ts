/**
 * The activity log: what this app has actually done to this machine.
 *
 * The app writes to a developer's home directory, so "what did it change, and
 * when?" is a question it has to be able to answer after the toast is gone and
 * the run panel is closed. Until now the answer was nowhere — the step log
 * lived in React state and died with the panel.
 *
 * **What is recorded** is deliberately narrow: a title, where it came from,
 * when, the overall verdict, and per-step status + duration. **What is not
 * recorded** is everything that would turn a convenience into a liability —
 * command output, config file bodies, environment variables, API keys, paths
 * beyond what a step's own label already says. A step's label is written for a
 * human and is already on screen; its output is not, and can contain a token
 * that a CLI echoed back.
 *
 * Previews write nothing. A preview didn't happen to the machine, and a log
 * that records intentions alongside facts can't be trusted for either.
 */

import type { StepReport, StepStatus } from "./types"
import { readStoreRecords } from "./store-json"

export const ACTIVITY_VERSION = 1

/** How many runs are kept. Oldest are dropped, newest first. */
export const ACTIVITY_LIMIT = 50

export function activityPath(home: string): string {
  return `${home}/.agentpack/activity.json`
}

/** Where a run was started from. Free-form, but these are the ones we emit. */
export type ActivitySource = "quick-config" | "section" | "recovery" | "restore" | "unknown"

/** The verdict for a whole run, read from all four step statuses plus cancel. */
export type ActivityOutcome = "done" | "warning" | "error" | "cancelled"

export interface ActivityStep {
  id: string
  label: string
  status: StepStatus
  /** Milliseconds, when the runner measured it. */
  durationMs?: number
  /** A restore point this step created, if any — see `StepReport.artifact`. */
  artifact?: string
}

export interface ActivityRecord {
  id: string
  title: string
  source: ActivitySource
  /** Epoch milliseconds. */
  at: number
  outcome: ActivityOutcome
  steps: ActivityStep[]
}

export interface ActivityStore {
  version: number
  /** Newest first. */
  profiles: ActivityRecord[]
}

/**
 * A run's verdict.
 *
 * All four statuses are read, not just done/error: a run that was stopped
 * halfway leaves everything remaining `skipped`, and calling that "done"
 * because nothing errored is exactly the lie the run panel used to tell. The
 * caller passes `cancelled` because `skipped` alone can't distinguish a stopped
 * run from a step dropped by a failed prerequisite.
 */
export function outcomeOf(reports: StepReport[], cancelled: boolean): ActivityOutcome {
  if (cancelled) return "cancelled"
  if (reports.some((r) => r.status === "error")) return "error"
  if (reports.some((r) => r.status === "warning" || r.status === "skipped")) return "warning"
  return "done"
}

/**
 * Build the record for a finished run.
 *
 * `title` falls back to the first step's own label, which is already written
 * for a human to read — better than a generated "Run of 7 steps", and it never
 * invents a description of work the app didn't do.
 */
export function recordRun(input: {
  id: string
  at: number
  reports: StepReport[]
  cancelled: boolean
  title?: string
  source?: ActivitySource
}): ActivityRecord {
  const { id, at, reports, cancelled } = input
  return {
    id,
    title: input.title?.trim() || reports[0]?.label || "",
    source: input.source ?? "unknown",
    at,
    outcome: outcomeOf(reports, cancelled),
    // Explicit field-by-field copy, NOT a spread. A spread here would silently
    // start persisting whatever the next field added to `StepReport` happens to
    // be — and the fields it already carries include `output`, the command's
    // raw stdout.
    steps: reports.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      ...(typeof r.durationMs === "number" ? { durationMs: r.durationMs } : {}),
      ...(r.artifact ? { artifact: r.artifact } : {}),
    })),
  }
}

/** Newest first, capped. Returns a new array. */
export function pushRecord(
  existing: ActivityRecord[],
  record: ActivityRecord,
  limit = ACTIVITY_LIMIT
): ActivityRecord[] {
  return [record, ...existing].slice(0, limit)
}

const STATUSES: readonly StepStatus[] = [
  "pending",
  "running",
  "done",
  "warning",
  "error",
  "skipped",
]

function parseStep(raw: Record<string, unknown>): ActivityStep | null {
  const id = raw.id
  const label = raw.label
  const status = raw.status
  if (typeof id !== "string" || typeof label !== "string") return null
  if (typeof status !== "string" || !STATUSES.includes(status as StepStatus)) return null
  const step: ActivityStep = { id, label, status: status as StepStatus }
  if (typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)) {
    step.durationMs = raw.durationMs
  }
  if (typeof raw.artifact === "string" && raw.artifact) step.artifact = raw.artifact
  return step
}

/**
 * Read the store, dropping anything that doesn't validate.
 *
 * Same contract as the profile store: a corrupt or hand-edited file yields
 * fewer records, never an exception. An activity log is a convenience — it must
 * never be the reason the overview won't render.
 */
export function parseActivity(json: string): ActivityStore {
  const records: ActivityRecord[] = []
  for (const raw of readStoreRecords(json)) {
    const { id, title, source, at, outcome } = raw
    if (typeof id !== "string" || typeof title !== "string") continue
    if (typeof at !== "number" || !Number.isFinite(at)) continue
    if (
      outcome !== "done" &&
      outcome !== "warning" &&
      outcome !== "error" &&
      outcome !== "cancelled"
    ) {
      continue
    }
    const steps = Array.isArray(raw.steps)
      ? raw.steps
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
          .map(parseStep)
          .filter((s): s is ActivityStep => s !== null)
      : []
    records.push({
      id,
      title,
      source: typeof source === "string" ? (source as ActivitySource) : "unknown",
      at,
      outcome,
      steps,
    })
  }
  // Trust the file's order for equal timestamps, but re-sort so a hand-edited
  // or concurrently-written file still reads newest-first.
  records.sort((a, b) => b.at - a.at)
  return { version: ACTIVITY_VERSION, profiles: records.slice(0, ACTIVITY_LIMIT) }
}

export function serializeActivity(store: ActivityStore): string {
  return `${JSON.stringify(store, null, 2)}\n`
}
