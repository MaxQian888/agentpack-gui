"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useRunnerCtx } from "./runner-context"
import { StepLog } from "./step-log"
import { Summary } from "./summary"

export function ExecutionPanel() {
  const t = useT()
  const open = useAppStore((s) => s.panelOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const { reports, running, dryRun, cancel } = useRunnerCtx()
  const finished = !running && reports.length > 0

  return (
    <Sheet open={open} onOpenChange={setPanelOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {t.shell.run}
            {dryRun ? (
              <Badge variant="secondary" className="font-normal">
                {t.shell.preview}
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>{dryRun ? t.review.dryRunSuffix.trim() : t.brand}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-auto px-4">
          {finished ? <Summary reports={reports} dryRun={dryRun} /> : null}
          <StepLog reports={reports} />
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          {running ? (
            <Button variant="outline" onClick={cancel}>
              {t.shell.cancel}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setPanelOpen(false)}>
              {t.shell.close}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
