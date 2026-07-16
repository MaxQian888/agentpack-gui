"use client"

import { useState } from "react"
import { ClipboardPaste, Plug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { mcpAddSpecStep } from "@/lib/agentpack/plan"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { existingIds } from "./helpers"
import { CustomServerForm, type CustomFormValue } from "./custom-form"
import { ImportDialog } from "./import-dialog"

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
  const [importing, setImporting] = useState(false)

  const addServer = async ({ id, spec, targets }: CustomFormValue) => {
    if (!paths) return
    await run(mcpAddSpecStep(id, spec, targets, paths, t))
    refresh()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Card className="flex-row items-center justify-between gap-4 p-5">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <ClipboardPaste className="size-4" /> {m.importCardTitle}
          </p>
          <p className="text-sm text-muted-foreground">{m.importCardHint}</p>
        </div>
        <Button variant="outline" className="shrink-0 gap-2" onClick={() => setImporting(true)}>
          <ClipboardPaste className="size-4" />
          {m.importOpen}
        </Button>
      </Card>

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

      <ImportDialog open={importing} onOpenChange={setImporting} scan={scan} refresh={refresh} />
    </div>
  )
}
