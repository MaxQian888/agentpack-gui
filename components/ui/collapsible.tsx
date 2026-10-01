"use client"

import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />
}

// Disclosed content arrives the way a panel does (design.md § 6): a short fade
// and a 4px rise, transform and opacity only — never a height tween. It leaves
// instantly, so a collapse never keeps stale controls on screen.
function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn(
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 data-[state=open]:duration-(--hm-dur-base) data-[state=open]:ease-(--hm-ease-out)",
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
