"use client"

import { summarize } from "@/lib/agentpack/report"
import type { StepReport } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"

export function Summary({ reports, dryRun }: { reports: StepReport[]; dryRun: boolean }) {
  const t = useT()
  const plan = useAppStore((s) => s.plan)
  const lines = summarize(reports, plan, t, dryRun)
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <pre className="whitespace-pre-wrap font-mono text-xs">{lines.join("\n")}</pre>
    </div>
  )
}
