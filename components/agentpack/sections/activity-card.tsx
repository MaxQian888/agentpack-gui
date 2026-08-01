"use client"

import { History } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useLocale, useT } from "@/lib/i18n/provider"
import type { ActivityOutcome, ActivityRecord } from "@/lib/agentpack/activity"

const OUTCOME_DOT: Record<ActivityOutcome, string> = {
  done: "bg-[var(--hm-ok)]",
  warning: "bg-[var(--hm-warn)]",
  error: "bg-[var(--hm-danger)]",
  cancelled: "bg-[var(--hm-neutral)]",
}

/** Local date+time, in the viewer's own locale and zone. */
function when(at: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(at)
    )
  } catch {
    return new Date(at).toISOString()
  }
}

/**
 * What this app has actually done to this machine.
 *
 * Deliberately thin: a title, when, how it ended, how many steps, and whether a
 * restore point exists. It does not carry command output, config bodies or
 * anything a step printed — see `lib/agentpack/activity` for why that line is
 * where it is.
 *
 * "No automatic undo" is stated outright on runs that produced no restore
 * point. A CLI install can't be rolled back by us, and a row that stayed silent
 * about it would read as though it could.
 */
export function ActivityCard({
  records,
  available,
  onOpenPanel,
}: {
  records: ActivityRecord[]
  /** False in web mode, where there is no machine to have changed. */
  available: boolean
  onOpenPanel?: () => void
}) {
  const t = useT()
  const a = t.activity
  const { lang } = useLocale()

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium">{a.title}</h3>
      </div>
      {!available ? (
        <p className="text-sm text-muted-foreground">{a.notTauri}</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground">{a.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {records.slice(0, 6).map((r) => {
            const restorable = r.steps.some((s) => s.artifact)
            return (
              <li key={r.id} className="flex min-w-0 items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-[var(--hm-radius-dot)]",
                    OUTCOME_DOT[r.outcome]
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm [overflow-wrap:anywhere]">{r.title}</p>
                  <p className="mt-0.5 font-mono text-[var(--hm-text-2xs)] text-muted-foreground">
                    {when(r.at, lang)} · {a.outcome[r.outcome]} · {a.steps(r.steps.length)} ·{" "}
                    {restorable ? a.restorePoint : a.noUndo}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {onOpenPanel && records.length > 0 ? (
        <button
          type="button"
          onClick={onOpenPanel}
          className="self-start text-sm text-[var(--hm-accent)] hover:underline"
        >
          {a.viewAll}
        </button>
      ) : null}
    </Card>
  )
}
