/**
 * The maintenance inbox: how a user works through the findings, once there are
 * more of them than a glance can handle.
 *
 * `diagnostics.ts` decides *what is wrong*. This decides *how you get through
 * it* — grouping, selection, and the one thing a to-do list of machine repairs
 * needs that a plain list can't give: fixing several at once without lying
 * about what the button does.
 *
 * Four rules the shape enforces:
 *
 * 1. **A batch is defined by its action, not by its topic.** `batchKeyOf` reads
 *    the action and nothing else, so the two findings that both say "an update
 *    is out" land in different places when one of them is really a *navigate*
 *    (the Node-floor case, where npm would refuse the upgrade). A batch keyed
 *    off the item's family would have swept that one in and staged a command
 *    already known to fail.
 * 2. **A batch must be describable by one label.** That is the whole reason
 *    `diagnostics` has no "fix all": across upgrades, restores and installs
 *    there is no honest sentence for what one button would do. Restricting a
 *    batch to a single action kind is what makes "Upgrade 3 tools" honest — and
 *    `batchFor` returns null rather than a mixed batch, so the dishonest button
 *    cannot be rendered.
 * 3. **A batch of one is not a batch.** The row's own button already does
 *    exactly that, and a second control beside it doing the same thing is two
 *    ways to say one thing. Both the suggested batches and an explicit
 *    selection require two.
 * 4. **Nothing here executes.** Like `diagnostics`, this returns actions as
 *    data. The caller maps them onto steps, and every step still goes through
 *    the review panel — a batch is a shortcut to the change, never past the gate.
 */

import {
  CATEGORY_ORDER,
  SEVERITY_ORDER,
  type DiagnosticAction,
  type DiagnosticCategory,
  type DiagnosticItem,
  type DiagnosticSeverity,
} from "./diagnostics"

/**
 * The action kinds that can be applied to several findings at once.
 *
 * Only repairs appear here. `rescan`, `openOnboarding` and `navigate` are
 * absent on purpose: navigating to three sections at once is not a thing, and
 * a "batch" that lands the user on one page while silently dropping the other
 * two selections would be worse than no batch at all.
 */
export type BatchKey = "upgrade-cli" | "restore-config"

/** Smallest batch worth offering. Below it, the row's own button is the control. */
export const MIN_BATCH = 2

/**
 * Which batch an item may join, read off its action.
 *
 * Undefined means this finding is only ever fixed on its own — which is the
 * default, and the safe one: a new action kind is un-batchable until someone
 * writes down the label that would describe a batch of it.
 */
export function batchKeyOf(item: DiagnosticItem): BatchKey | undefined {
  switch (item.action.run.kind) {
    case "upgradeCli":
      return "upgrade-cli"
    case "restoreFile":
      return "restore-config"
    default:
      return undefined
  }
}

export interface InboxBatch {
  key: BatchKey
  /** In the order they appear in the list, so the preview reads top to bottom. */
  items: readonly DiagnosticItem[]
}

export interface InboxGroup {
  category: DiagnosticCategory
  items: readonly DiagnosticItem[]
  /** The worst severity inside, for the group's own mark. */
  severity: DiagnosticSeverity
  /** Batches worth offering here — same action kind, at least `MIN_BATCH` of them. */
  batches: readonly InboxBatch[]
}

/**
 * Group findings by what they are about, keeping each group in the order it was
 * given — which is severity order, because that is the order `buildDiagnostics`
 * returns and the order a to-do list has to keep.
 *
 * Only categories that actually have findings come back. An inbox is a list of
 * what is wrong, and a row of empty category headers reads as eight problems.
 */
export function groupInbox(items: readonly DiagnosticItem[]): InboxGroup[] {
  const groups: InboxGroup[] = []
  for (const category of CATEGORY_ORDER) {
    const inCategory = items.filter((i) => i.category === category)
    if (inCategory.length === 0) continue
    groups.push({
      category,
      items: inCategory,
      severity: worstOf(inCategory),
      batches: suggestedBatches(inCategory),
    })
  }
  return groups
}

/** The worst severity in a non-empty list. */
function worstOf(items: readonly DiagnosticItem[]): DiagnosticSeverity {
  for (const severity of SEVERITY_ORDER) {
    if (items.some((i) => i.severity === severity)) return severity
  }
  // Unreachable while every item carries one of the three severities; the
  // fallback keeps this total rather than returning undefined into a render.
  return "info"
}

/** Batches the UI may offer without being asked: same key, at least two. */
function suggestedBatches(items: readonly DiagnosticItem[]): InboxBatch[] {
  const byKey = new Map<BatchKey, DiagnosticItem[]>()
  for (const item of items) {
    const key = batchKeyOf(item)
    if (!key) continue
    const bucket = byKey.get(key) ?? []
    bucket.push(item)
    byKey.set(key, bucket)
  }
  return [...byKey.entries()]
    .filter(([, group]) => group.length >= MIN_BATCH)
    .map(([key, group]) => ({ key, items: group }))
}

/** The ids a user is allowed to tick. Everything else is a single-row repair. */
export function selectableIds(items: readonly DiagnosticItem[]): Set<string> {
  return new Set(items.filter((i) => batchKeyOf(i)).map((i) => i.id))
}

/**
 * The batch a selection amounts to, or null when it isn't one.
 *
 * Null covers every way a selection fails to be describable by a single label:
 * fewer than `MIN_BATCH` items, an id that isn't in the list, an item whose
 * action can't be batched, or a mix of two action kinds. Returning null rather
 * than a partial batch is deliberate — quietly dropping the items that didn't
 * fit would run a button whose label counted them.
 */
export function batchFor(
  items: readonly DiagnosticItem[],
  selected: ReadonlySet<string>
): InboxBatch | null {
  const chosen = items.filter((i) => selected.has(i.id))
  // An id that matched nothing means the selection and the list disagree —
  // usually a rescan that dropped a finding out from under a ticked row.
  if (chosen.length !== selected.size) return null
  if (chosen.length < MIN_BATCH) return null
  const keys = chosen.map(batchKeyOf)
  const key = keys[0]
  if (!key || keys.some((k) => k !== key)) return null
  return { key, items: chosen }
}

/**
 * A batch as a list of actions, in list order. Still just data: the caller maps
 * each onto a step, and the review panel is what actually decides they run.
 */
export function batchActions(batch: InboxBatch): DiagnosticAction[] {
  return batch.items.map((i) => i.action.run)
}

export interface InboxSummary {
  total: number
  bySeverity: Record<DiagnosticSeverity, number>
  /** The worst severity present, or null for a clean list. */
  worst: DiagnosticSeverity | null
}

/** Counts for the status band. Every severity present, including the zeroes. */
export function inboxSummary(items: readonly DiagnosticItem[]): InboxSummary {
  const bySeverity: Record<DiagnosticSeverity, number> = { critical: 0, warning: 0, info: 0 }
  for (const item of items) bySeverity[item.severity] += 1
  const worst = SEVERITY_ORDER.find((s) => bySeverity[s] > 0) ?? null
  return { total: items.length, bySeverity, worst }
}
