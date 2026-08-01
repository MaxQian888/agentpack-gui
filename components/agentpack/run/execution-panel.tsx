"use client"

import { Eye, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
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

/**
 * The review panel — the single door every write goes through.
 *
 * Its two exits are deliberately both spelled out rather than one button plus a
 * mode switch somewhere else in the window: **Preview only** renders what would
 * happen and touches nothing, **Apply changes** does it. A preview leaves the
 * steps staged, so reading the preview and then applying is one more click, not
 * a rebuild — which is the difference between a preview people use and a
 * preview people learn to skip.
 */
export function ExecutionPanel() {
  const t = useT()
  const open = useAppStore((s) => s.panelOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const {
    reports,
    running,
    previewing,
    awaitingConfirm,
    lastWasPreview,
    cancelled,
    previewPending,
    applyPending,
    abandonPending,
    retry,
    cancel,
  } = useRunnerCtx()
  const busy = running || previewing
  const finished = !busy && !awaitingConfirm && reports.length > 0
  // Also offered after a cancelled run: everything still to do is `skipped`, and
  // retry picks those up, so Retry is how you resume.
  const canRetry = reports.some((r) => r.status === "error" || r.status === "skipped")
  const doneCount = reports.filter((r) => r.status !== "pending" && r.status !== "running").length
  // A preview that has finished but is still staged: the log now holds "would …"
  // lines, and Apply is still the next step.
  const previewed = awaitingConfirm && !busy && lastWasPreview

  /**
   * Closing the panel while steps are staged abandons them. It has to: a caller
   * is awaiting the run, and leaving the promise open would hang whatever
   * dialog or card kicked it off.
   */
  const close = (next: boolean) => {
    if (!next && awaitingConfirm) abandonPending()
    setPanelOpen(next)
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{awaitingConfirm ? t.review.heading : t.shell.run}</SheetTitle>
          <SheetDescription>
            {previewed
              ? t.review.previewDone
              : awaitingConfirm
                ? t.review.stepCount(reports.length)
                : t.brand}
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
          {finished ? (
            <Completion reports={reports} dryRun={lastWasPreview} cancelled={cancelled} />
          ) : null}
          <StepLog reports={reports} />
        </div>

        <SheetFooter className="flex-row flex-wrap justify-end gap-2">
          {awaitingConfirm ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => close(false)}>
                {t.review.discard}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void previewPending()}>
                {previewing ? (
                  <>
                    <Spinner className="size-4" />
                    {t.review.previewing}
                  </>
                ) : (
                  <>
                    <Eye className="size-4" />
                    {t.review.previewOnly}
                  </>
                )}
              </Button>
              <Button disabled={busy} onClick={() => void applyPending()}>
                <Play className="size-4" />
                {t.review.apply}
              </Button>
            </>
          ) : busy ? (
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
              <Button variant="outline" onClick={() => close(false)}>
                {t.shell.close}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
