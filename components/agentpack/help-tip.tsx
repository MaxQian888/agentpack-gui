"use client"

import { HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * A small ⓘ affordance next to a jargon-heavy label. Hovering (or focusing, for
 * keyboard users) reveals a plain-language, one-line explanation — the core of
 * making sections approachable to a newcomer without cluttering the layout.
 *
 * It bundles its own `TooltipProvider` so it's a true drop-in — usable in any
 * section (or a test) without depending on an ancestor provider. The trigger is
 * a real `<button>` so it's reachable by keyboard and announced to assistive
 * tech via `aria-label`.
 */
export function HelpTip({
  text,
  label,
  className,
}: {
  text: string
  /** Accessible name for the trigger; defaults to the tooltip text. */
  label?: string
  className?: string
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={label ?? text}
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <HelpCircle className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-pretty">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
