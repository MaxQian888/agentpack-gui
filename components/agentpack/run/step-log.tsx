"use client"

import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { StepReport, StepStatus } from "@/lib/agentpack/types"

/** Status colour from the tokens (design.md § 3): a mark, never a fill. */
function StatusIcon({ status }: { status: StepStatus }) {
  const props = { className: "size-4 shrink-0", "aria-hidden": true } as const
  switch (status) {
    case "running":
      return (
        <Loader2
          {...props}
          className={cn(props.className, "animate-spin text-[var(--hm-accent)]")}
        />
      )
    case "done":
      return <CheckCircle2 {...props} className={cn(props.className, "text-[var(--hm-ok)]")} />
    case "error":
      return <XCircle {...props} className={cn(props.className, "text-[var(--hm-danger)]")} />
    case "warning":
      return <AlertTriangle {...props} className={cn(props.className, "text-[var(--hm-warn)]")} />
    case "skipped":
      return <MinusCircle {...props} className={cn(props.className, "text-[var(--hm-neutral)]")} />
    default:
      return <Circle {...props} className={cn(props.className, "text-muted-foreground/50")} />
  }
}

export function StepLog({ reports }: { reports: StepReport[] }) {
  const t = useT()
  return (
    <ol className="flex flex-col gap-2">
      {reports.map((r) => (
        <li key={r.id} className="rounded-md border bg-card p-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={r.status} />
            {/* The icon is colour and shape only; this is the same fact as a
                word, so a screen reader can tell which step failed. */}
            <span className="sr-only">{t.review.status[r.status]}: </span>
            <span
              className={cn(
                "text-sm",
                r.status === "error" && "text-[var(--hm-danger)]",
                r.status === "warning" && "text-[var(--hm-warn)]"
              )}
            >
              {r.label}
            </span>
            {typeof r.durationMs === "number" && r.durationMs >= 100 ? (
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                {(r.durationMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>
          {r.output.length > 0 || r.error ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-xs text-muted-foreground">
              {[...r.output, ...(r.error ? [r.error] : [])].join("\n")}
            </pre>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
