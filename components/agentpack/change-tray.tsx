"use client"

import { ArrowRight } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useT } from "@/lib/i18n/provider"
import { countSelections } from "@/lib/agentpack/plan"
import { useAppStore } from "@/store/app-store"

/**
 * The change tray.
 *
 * It exists because the selection used to be invisible: you ticked four things
 * across three sections and the only evidence was a header button that said
 * "Run plan" whether the plan held four items or none. The tray states the
 * count, offers the way out, and puts the way forward — review, never apply —
 * where a shopping cart's total would be.
 *
 * Rendered only when something is selected. A permanently docked bar with
 * "0 selected" in it is furniture, and furniture stops being read.
 */
/**
 * The tray's count: selections measured against what is already on the machine.
 * Shared with the ⌘K palette, whose "Review N changes" must be the same number
 * for the same button.
 */
export function useTrayCount(): number {
  const plan = useAppStore((s) => s.plan)
  const appliedProxy = useAppStore((s) => s.settings.proxy)
  const appliedNpmRegistry = useAppStore((s) => s.appliedNpmRegistry)
  return countSelections(plan, { proxy: appliedProxy, npmRegistry: appliedNpmRegistry })
}

export function ChangeTray({
  onReview,
  preparing = false,
  running = false,
  onShowRun,
}: {
  onReview: () => void
  /** Review was clicked and the panel is being prepared (detection, scan). */
  preparing?: boolean
  /**
   * A run is executing. The selection can't be reviewed until it ends, so the
   * one action becomes the way back to the run instead of a button that would
   * only be refused.
   */
  running?: boolean
  onShowRun?: () => void
}) {
  const t = useT()
  const clearSelection = useAppStore((s) => s.clearSelection)
  // Measured against what is already on the machine: a proxy applied last week
  // is not something the user picked, and counting it kept this tray open on
  // every launch with a Clear button that couldn't clear it.
  const count = useTrayCount()
  const ref = useRef<HTMLDivElement>(null)
  const shown = count > 0

  // Toasts stack bottom-right — exactly where this tray's one primary button
  // sits — so for four seconds after any toast, "Review changes" was under it.
  // Publishing the tray's height lets the toaster (components/ui/sonner.tsx)
  // stand on top of the tray instead of on top of its button.
  useLayoutEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!shown || !el) return
    const publish = () => root.style.setProperty("--hm-tray-h", `${el.offsetHeight}px`)
    publish()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish)
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      root.style.removeProperty("--hm-tray-h")
    }
  }, [shown])

  if (!shown) return null

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t.tray.label}
      className="hm-tray-in flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t bg-[var(--hm-paper-2)] px-4 py-2.5 sm:px-6"
    >
      <span className="text-sm font-medium tabular-nums">{t.tray.count(count)}</span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
        {t.tray.clear}
      </Button>
      {/* On a phone the three don't fit one row, and the primary used to wrap
          alone onto the second, flush left under the count. It takes that row
          whole instead, where a thumb finds it. */}
      <Button
        size="sm"
        className="max-[420px]:w-full"
        onClick={running && onShowRun ? onShowRun : onReview}
        disabled={preparing}
        data-tour="tray"
      >
        {running && onShowRun ? (
          <>
            <Spinner aria-hidden className="size-4" />
            {t.shell.showRun}
          </>
        ) : preparing ? (
          <>
            <Spinner aria-hidden className="size-4" />
            {t.shell.preparing}
          </>
        ) : (
          <>
            {t.tray.review}
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>
    </div>
  )
}
