"use client"

import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
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
export function ChangeTray({ onReview }: { onReview: () => void }) {
  const t = useT()
  const plan = useAppStore((s) => s.plan)
  const resetPlan = useAppStore((s) => s.resetPlan)
  const count = countSelections(plan)
  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label={t.tray.label}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t bg-[var(--hm-paper-2)] px-4 py-2.5 sm:px-6"
    >
      <span className="text-sm font-medium tabular-nums">{t.tray.count(count)}</span>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={resetPlan}>
        {t.tray.clear}
      </Button>
      <Button size="sm" onClick={onReview} data-tour="tray">
        {t.tray.review}
        <ArrowRight className="size-4" />
      </Button>
    </div>
  )
}
