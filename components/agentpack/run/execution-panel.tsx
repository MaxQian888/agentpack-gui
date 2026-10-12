"use client"

import { useRef } from "react"
import { Eye, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import type { InventoryInput } from "@/lib/agentpack/inventory"
import type { NavigateIntent, SectionKey } from "@/lib/agentpack/workspaces"
import { RunBody, RunProgress, useRunView } from "./run-view"

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
  // Shared with the first-run wizard, which draws the same review inline. It
  // reads the detection slices itself, which is what keeps the shell off them.
  const view = useRunView(scan)
  const {
    reports,
    previewing,
    awaitingConfirm,
    runTitle,
    previewPending,
    applyPending,
    abandonPending,
    retry,
    cancel,
    busy,
    finished,
    canRetry,
    previewed,
  } = view

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

        <div className="px-4 pb-3 empty:hidden">
          <RunProgress view={view} />
        </div>

        <div
          ref={logRef}
          tabIndex={-1}
          className="flex-1 space-y-4 overflow-auto px-4 outline-none"
        >
          <RunBody
            view={view}
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
