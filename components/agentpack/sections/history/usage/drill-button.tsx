"use client"

import { cn } from "@/lib/utils"

/**
 * The keyboard way into a drillable table row.
 *
 * The row keeps the click handler, so a pointer can hit it anywhere across its
 * width; this button is what puts the row in the tab order and names it for
 * assistive tech. It deliberately has no handler of its own: its click — from a
 * pointer, or from Enter/Space — bubbles to the row's, so the two can never
 * both fire for one press.
 */
export function DrillButton({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        "block max-w-full min-w-0 truncate rounded-(--hm-radius-control) text-left font-medium",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        className
      )}
    >
      {children}
    </button>
  )
}
