"use client"

import { Plug } from "lucide-react"
import { Card } from "@/components/ui/card"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { mcpAddSpecStep } from "@/lib/agentpack/plan"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { existingIds } from "./helpers"
import { CustomServerForm, type CustomFormValue } from "./custom-form"

export function AddCustomTab({
  scan,
  refresh,
}: {
  scan: DashboardScan | null
  refresh: () => void
}) {
  const t = useT()
  const m = t.mcp
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

  const addServer = async ({ id, spec, targets }: CustomFormValue) => {
    if (!paths) return
    await run(mcpAddSpecStep(id, spec, targets, paths, t))
    refresh()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Card className="gap-4 p-5">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Plug className="size-4" /> {m.addTitle}
          </p>
          <p className="text-sm text-muted-foreground">{m.addHint}</p>
        </div>
        <CustomServerForm
          key={scan ? "ready" : "loading"}
          mode="add"
          takenIds={existingIds(scan)}
          onSubmit={(v) => void addServer(v)}
        />
      </Card>
    </div>
  )
}
