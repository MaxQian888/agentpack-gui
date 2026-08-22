"use client"

import { XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import type { FailureGroup } from "@/lib/agentpack/failure"
import type { SectionKey } from "@/lib/agentpack/workspaces"

/**
 * Why the run failed, and where to go about it.
 *
 * The step log already says *that* something failed, in the tool's own words.
 * This says what those words mean and what to do — and it groups by cause
 * rather than by step, because five steps that all died on the same blocked
 * download are one problem with one fix.
 *
 * Severity is carried by a mark and the section's own name, not by a tinted
 * panel: a stack of red blocks stops meaning anything by the third one, which
 * is the same reason the diagnostics list is ruled rows rather than cards.
 *
 * The tool's own line is quoted under each reading. That is not decoration — it
 * is what lets someone see the explanation was drawn from their machine, and it
 * is what makes a *wrong* reading visibly wrong instead of merely wrong.
 */
export function FailureNotes({
  groups,
  onNavigate,
}: {
  groups: readonly FailureGroup[]
  /** Absent in contexts with nowhere to navigate to; the button is then omitted. */
  onNavigate?: (section: SectionKey) => void
}) {
  const t = useT()
  const f = t.failure

  if (groups.length === 0) return null

  return (
    <section aria-label={f.heading} className="rounded-[var(--hm-radius-surface)] border">
      <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {f.heading}
      </h3>
      <ul className="divide-y">
        {groups.map(({ diagnosis, steps }) => (
          <li key={diagnosis.cause} className="flex items-start gap-2.5 px-4 py-3">
            <XCircle
              className="mt-0.5 size-4 shrink-0 text-[var(--hm-danger)]"
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">{diagnosis.title}</p>
              {/* Which steps this one reading accounts for. Labels, not a count:
                  the label is the specific thing the user recognises. */}
              <ul className="flex flex-col gap-0.5">
                {steps.map((step) => (
                  <li
                    key={step.id}
                    className="text-xs text-muted-foreground [overflow-wrap:anywhere]"
                  >
                    {step.label}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {diagnosis.advice}
              </p>
              {diagnosis.evidence ? (
                <p className="text-xs text-muted-foreground">
                  <span className="mr-1">{f.evidenceLabel}</span>
                  <code className="font-mono [overflow-wrap:anywhere]">{diagnosis.evidence}</code>
                </p>
              ) : null}
              {diagnosis.destination && onNavigate ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-0.5 self-start"
                  onClick={() => onNavigate(diagnosis.destination!)}
                >
                  {diagnosis.actionLabel}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
