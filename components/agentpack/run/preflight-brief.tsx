"use client"

import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { PreflightReport, PreflightTone } from "@/lib/agentpack/preflight"

const TONE: Record<PreflightTone, { icon: LucideIcon; className: string }> = {
  blocked: { icon: CircleAlert, className: "text-[var(--hm-danger)]" },
  warn: { icon: TriangleAlert, className: "text-[var(--hm-warn)]" },
  info: { icon: Info, className: "text-[var(--hm-ink-3)]" },
}

/**
 * What is about to happen, in sentences, above the step list that says it in
 * commands.
 *
 * The panel's job is to get an informed yes. A column of labels like
 * `claude mcp add context7` gets that from someone who already knows what they
 * are approving, and gets a nervous yes from everyone else — so the three
 * things a first-time user is actually about to be surprised by (a password
 * prompt, a Node install they never asked for, a server that will need a key
 * before it does anything) are stated here in advance instead of discovered
 * during the run.
 *
 * It renders nothing when there is nothing to say. A brief that always appears
 * teaches people to scroll past it, and then it isn't there when it matters.
 *
 * The icons are `aria-hidden`, so every row states its tone in words — the same
 * rule the setup checklist follows for its status markers.
 */
export function PreflightBrief({ report }: { report: PreflightReport }) {
  const t = useT()
  const p = t.preflight

  if (report.notes.length === 0) return null

  return (
    <section
      aria-label={p.title}
      className="rounded-[var(--hm-radius-surface)] border bg-muted/30 px-4 py-3"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {p.title}
      </h3>
      <ul className="mt-2 flex flex-col gap-2.5">
        {report.notes.map((note) => {
          const { icon: Icon, className } = TONE[note.tone]
          return (
            <li key={note.id} className="flex items-start gap-2.5">
              <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm [overflow-wrap:anywhere]">
                  <span className="sr-only">{p.tone[note.tone]}: </span>
                  {note.title}
                </p>
                {note.detail ? (
                  <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {note.detail}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
