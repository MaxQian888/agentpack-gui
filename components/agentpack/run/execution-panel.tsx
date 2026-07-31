"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
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
import { Completion } from "./completion"

export function ExecutionPanel() {
  const t = useT()
  const open = useAppStore((s) => s.panelOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const { reports, running, dryRun, awaitingConfirm, cancelled, confirm, retry, cancel } =
    useRunnerCtx()
  const finished = !running && !awaitingConfirm && reports.length > 0
  // Also offered after a cancelled run: everything still to do is `skipped`, and
  // retry picks those up, so Retry is how you resume.
  const canRetry = reports.some((r) => r.status === "error" || r.status === "skipped")
  const doneCount = reports.filter((r) => r.status !== "pending" && r.status !== "running").length

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
          <SheetDescription>
            {awaitingConfirm ? t.review.title : dryRun ? t.review.dryRunSuffix.trim() : t.brand}
          </SheetDescription>
        </SheetHeader>

        {reports.length > 0 && !awaitingConfirm ? (
          <div className="flex items-center gap-3 px-4 pb-3">
            <Progress value={(doneCount / reports.length) * 100} className="h-1.5 flex-1" />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {doneCount}/{reports.length}
            </span>
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-auto px-4">
          {finished ? <Completion reports={reports} dryRun={dryRun} cancelled={cancelled} /> : null}
          <StepLog reports={reports} />
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          {awaitingConfirm ? (
            <>
              <Button variant="outline" onClick={() => setPanelOpen(false)}>
                {t.shell.cancel}
              </Button>
              <Button onClick={() => void confirm()}>{t.shell.proceed}</Button>
            </>
          ) : running ? (
            <Button variant="outline" onClick={cancel}>
              {t.shell.cancel}
            </Button>
          ) : (
            <>
              {finished && canRetry ? (
                <Button variant="outline" onClick={() => void retry()}>
                  {t.shell.retry}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setPanelOpen(false)}>
                {t.shell.close}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
