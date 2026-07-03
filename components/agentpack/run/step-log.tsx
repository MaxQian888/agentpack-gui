"use client"

import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { StepReport, StepStatus } from "@/lib/agentpack/types"

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-4 animate-spin text-blue-500" />
    case "done":
      return <CheckCircle2 className="size-4 text-emerald-500" />
    case "error":
      return <XCircle className="size-4 text-red-500" />
    case "warning":
      return <AlertTriangle className="size-4 text-amber-500" />
    case "skipped":
      return <MinusCircle className="size-4 text-muted-foreground" />
    default:
      return <Circle className="size-4 text-muted-foreground/50" />
  }
}

export function StepLog({ reports }: { reports: StepReport[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {reports.map((r) => (
        <li key={r.id} className="rounded-md border bg-card p-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={r.status} />
            <span
              className={cn(
                "text-sm",
                r.status === "error" && "text-red-500",
                r.status === "warning" && "text-amber-600"
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
