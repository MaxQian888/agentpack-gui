"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CircleAlert, Info } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { DiagnosticItem, DiagnosticSeverity } from "@/lib/agentpack/diagnostics"
import { batchFor, selectableIds, type InboxBatch } from "@/lib/agentpack/inbox"

const SEVERITY: Record<DiagnosticSeverity, { icon: LucideIcon; className: string }> = {
  critical: { icon: CircleAlert, className: "text-[var(--hm-danger)]" },
  warning: { icon: AlertTriangle, className: "text-[var(--hm-warn)]" },
  info: { icon: Info, className: "text-[var(--hm-ink-3)]" },
}

/**
 * The overview's to-do list, leading the page.
 *
 * A list with rules rather than a grid of cards: these items are ranked, and
 * anything laid out as equal tiles reads as unranked. Severity is carried by
 * one small mark and one word, not by a tinted panel — four coloured blocks
 * stacked down a page stop meaning anything by the third one.
 *
 * Each row offers exactly one action, and every action that writes goes through
 * the review panel like everything else. There is still deliberately no "fix
 * all": across a mixed list of upgrades, restores and installs there is no
 * honest label for what such a button would do. What there *is* — when `onBatch`
 * is given — is a tick box on the rows whose repairs are the same kind of thing,
 * and one footer button that names exactly what it will do to all of them.
 * `batchFor` is what decides that a selection has an honest label; a mix of two
 * kinds returns null and the footer never appears.
 *
 * The list stays ranked by severity while a batch is being assembled. Grouping
 * it by category instead would put a blocking finding underneath an optional
 * one, and a to-do list that buries the blocking item is not a to-do list.
 *
 * It renders nothing when there is nothing to say. "All clear", "still
 * scanning" and "web mode can't look" are all one statement about this machine,
 * and the overview's status band is where that statement is made — an empty box
 * repeating it under the band was one panel of pure restatement.
 */
export function DiagnosticsList({
  items,
  onAct,
  onBatch,
}: {
  items: DiagnosticItem[]
  onAct: (item: DiagnosticItem) => void
  /**
   * Apply one repair to several findings at once. Omit it and no tick box is
   * drawn at all — a checkbox that leads to no action is a control that does
   * nothing.
   */
  onBatch?: (batch: InboxBatch) => void
}) {
  const t = useT()
  const g = t.diagnostics
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const selectable = useMemo(
    () => (onBatch ? selectableIds(items) : new Set<string>()),
    [items, onBatch]
  )

  // Intersect against what is on screen right now. A rescan drops findings, and
  // a tick left behind on one of them would silently block the footer button
  // for the rows that are still there.
  const live = useMemo(
    () => new Set([...selected].filter((id) => selectable.has(id))),
    [selected, selectable]
  )
  const batch = useMemo(() => batchFor(items, live), [items, live])

  if (items.length === 0) return null

  const toggle = (id: string) => {
    const next = new Set(live)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
  }

  return (
    <section aria-label={g.title} className="rounded-[var(--hm-radius-surface)] border">
      {/* No visible heading: the band directly above already counts these, and
          the region keeps its name through aria-label. */}
      <ul className="divide-y">
        {items.map((item) => {
          const { icon: Icon, className } = SEVERITY[item.severity]
          const canSelect = selectable.has(item.id)
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
            >
              {onBatch ? (
                // A fixed slot on every row, filled only where a batch is
                // possible: without it the titles of the un-batchable rows step
                // left and the list reads as two lists.
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                  {canSelect ? (
                    <Checkbox
                      checked={live.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                      aria-label={g.selectRow(item.title)}
                    />
                  ) : null}
                </span>
              ) : null}
              <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">{item.title}</p>
                {item.detail ? (
                  <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {item.detail}
                  </p>
                ) : null}
                <span className="sr-only">{g.severity[item.severity]}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto shrink-0 whitespace-nowrap"
                onClick={() => onAct(item)}
              >
                {item.action.label}
              </Button>
            </li>
          )
        })}
      </ul>
      {onBatch && batch ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3">
          <span className="text-sm text-muted-foreground">{g.selected(batch.items.length)}</span>
          <Button
            size="sm"
            className="ml-auto shrink-0 whitespace-nowrap"
            onClick={() => {
              onBatch(batch)
              setSelected(new Set())
            }}
          >
            {g.batch[batch.key](batch.items.length)}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {g.clearSelection}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
