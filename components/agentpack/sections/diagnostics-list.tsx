"use client"

import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react"
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
 */
export function DiagnosticsList({
  items,
  loading,
  available,
  onAct,
}: {
  items: DiagnosticItem[]
  loading?: boolean
  /** False in web mode, where nothing has been read from a machine. */
  available: boolean
  onAct: (item: DiagnosticItem) => void
}) {
  const t = useT()
  const g = t.diagnostics

  if (!available) {
    return (
      <section aria-label={g.title} className="rounded-[var(--hm-radius-surface)] border p-4">
        <p className="text-sm text-muted-foreground">{g.notScanned}</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section aria-label={g.title} className="rounded-[var(--hm-radius-surface)] border p-4">
        <div className="h-4 w-48 animate-pulse rounded-[var(--hm-radius-control)] bg-muted" />
      </section>
    )
  }

  if (items.length === 0) {
    return (
      <section
        aria-label={g.title}
        className="flex items-start gap-2.5 rounded-[var(--hm-radius-surface)] border p-4"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--hm-ok)]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{g.clean}</p>
          <p className="text-sm text-muted-foreground">{g.cleanDetail}</p>
        </div>
      </section>
    )
  }

  return (
    <section aria-label={g.title} className="rounded-[var(--hm-radius-surface)] border">
      <h3 className="border-b px-4 py-2.5 text-sm font-medium">{g.title}</h3>
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
