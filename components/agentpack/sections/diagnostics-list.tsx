"use client"

import { AlertTriangle, CircleAlert, Info } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { DiagnosticItem, DiagnosticSeverity } from "@/lib/agentpack/diagnostics"

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
 * the review panel like everything else. There is deliberately no "fix all":
 * across a mixed list of upgrades, restores and installs there is no honest
 * label for what such a button would do.
 *
 * It renders nothing when there is nothing to say. "All clear", "still
 * scanning" and "web mode can't look" are all one statement about this machine,
 * and the overview's status band is where that statement is made — an empty box
 * repeating it under the band was one panel of pure restatement.
 */
export function DiagnosticsList({
  items,
  onAct,
}: {
  items: DiagnosticItem[]
  onAct: (item: DiagnosticItem) => void
}) {
  const t = useT()
  const g = t.diagnostics

  if (items.length === 0) return null

  return (
    <section aria-label={g.title} className="rounded-[var(--hm-radius-surface)] border">
      {/* No visible heading: the band directly above already counts these, and
          the region keeps its name through aria-label. */}
      <ul className="divide-y">
        {items.map((item) => {
          const { icon: Icon, className } = SEVERITY[item.severity]
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
            >
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
    </section>
  )
}
