"use client"

import { useRef } from "react"
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
import { preflight } from "@/lib/agentpack/preflight"
import { buildInventory } from "@/lib/agentpack/inventory"
import type { InventoryInput } from "@/lib/agentpack/inventory"
import type { NavigateIntent, SectionKey } from "@/lib/agentpack/workspaces"
import { useRunnerCtx } from "./runner-context"
import { StepLog } from "./step-log"
import { Completion } from "./completion"
import { PreflightBrief } from "./preflight-brief"

/**
 * The review panel — the single door every write goes through.
 *
 * Its two exits are deliberately both spelled out rather than one button plus a
 * mode switch somewhere else in the window: **Preview only** renders what would
 * happen and touches nothing, **Apply changes** does it. A preview leaves the
 * steps staged, so reading the preview and then applying is one more click, not
 * a rebuild — which is the difference between a preview people use and a
 * preview people learn to skip.
 *
 * Above the step list, `PreflightBrief` says the same thing in sentences. The
 * step log is the record of what will run; the brief is the part a first-time
 * user can actually act on before saying yes.
 */
export function ExecutionPanel({
  scan = null,
  onNavigate,
}: {
  /**
   * The last dashboard scan, for the brief's "already installed" count. Null is
   * an *unmeasured* machine, which makes the brief say nothing about it rather
   * than claim it is empty.
   */
  scan?: InventoryInput["scan"]
  /** Follow a failure's reading (or a to-do) to the page that fixes it. */
  onNavigate?: (section: SectionKey, intent?: NavigateIntent) => void
} = {}) {
  const t = useT()
  const open = useAppStore((s) => s.panelOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  // Folded here rather than in the shell, and read from the store here too.
  // `refreshDetections` writes `latestVersions` and `cliManagers` once per
  // installed CLI, un-batched — subscribing the shell to those slices made every
  // one of ~20 startup writes re-render the whole window, `<main>` and the
  // section the user was scrolling included.
  const detections = useAppStore((s) => s.detections)
  const latestVersions = useAppStore((s) => s.latestVersions)
  const cliManagers = useAppStore((s) => s.cliManagers)
  const networkProbe = useAppStore((s) => s.networkProbe)
  const paths = useAppStore((s) => s.paths)
  const {
    reports,
    pendingSteps,
    running,
    previewing,
    awaitingConfirm,
    lastWasPreview,
    cancelled,
    runPlan,
    runTitle,
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
  // Only while the decision is still the user's. During the run the log is the
  // thing to read, and a brief about what is "about to" happen would be stale
  // the moment the first step starts.
  const brief = awaitingConfirm
    ? busy
      ? null
      : preflight(t, pendingSteps, {
          // The run's own plan, or none: an MCP add must not be briefed about
          // the API keys of whatever preset is sitting in the tray.
          plan: runPlan ?? undefined,
          // Only folded while the panel is actually asking — the readings are
          // otherwise recomputed on every store write for a panel nobody sees.
          inventory: buildInventory({
            scan,
            detections,
            latestVersions,
            cliManagers,
            networkProbe,
            paths,
          }),
        })
    : null

  /**
   * Closing the panel while steps are staged abandons them. It has to: a caller
   * is awaiting the run, and leaving the promise open would hang whatever
   * dialog or card kicked it off.
   */
  const close = (next: boolean) => {
    if (!next && awaitingConfirm) abandonPending()
    setPanelOpen(next)
  }

  // Where the keyboard starts. Left to Radix it was the first focusable element —
  // Discard — so a reflexive Enter threw the staged steps away. The log is what
  // there is to read, so it takes focus; the decision stays one Tab away.
  const logRef = useRef<HTMLDivElement>(null)

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          logRef.current?.focus()
        }}
      >
        <SheetHeader>
          <SheetTitle>{awaitingConfirm ? t.review.heading : (runTitle ?? t.shell.run)}</SheetTitle>
          <SheetDescription>
            {previewed
              ? t.review.previewDone
              : awaitingConfirm
                ? t.review.stepCount(reports.length)
                : busy
                  ? t.shell.runningDesc
                  : t.shell.finishedDesc}
          </SheetDescription>
        </SheetHeader>

        {reports.length > 0 && !awaitingConfirm ? (
          <div className="flex items-center gap-3 px-4 pb-3">
            <Progress value={(doneCount / reports.length) * 100} className="h-1.5 flex-1" />
            <span
              aria-live="polite"
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {doneCount}/{reports.length}
            </span>
          </div>
        ) : null}

        <div
          ref={logRef}
          tabIndex={-1}
          className="flex-1 space-y-4 overflow-auto px-4 outline-none"
        >
          {brief ? <PreflightBrief report={brief} /> : null}
          {finished ? (
            <Completion
              reports={reports}
              plan={runPlan}
              dryRun={lastWasPreview}
              cancelled={cancelled}
              onNavigate={
                onNavigate
                  ? (section, intent) => {
                      // Leaving for the fix closes the panel behind you: a sheet
                      // left open over the page it just sent you to is a page
                      // you cannot use.
                      setPanelOpen(false)
                      if (intent) onNavigate(section, intent)
                      else onNavigate(section)
                    }
                  : undefined
              }
            />
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
              {/* On a phone the three don't share a row; the primary takes the
                  last one whole rather than wrapping alone, flush right. */}
              <Button
                className="max-[420px]:w-full"
                disabled={busy}
                onClick={() => void applyPending()}
              >
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
