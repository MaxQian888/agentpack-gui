"use client"

import { MonitorDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * "This part needs the desktop app."
 *
 * Web mode (`pnpm dev`) is a first-class, e2e-tested target, but it can't read
 * or write the user's real machine — so several sections have nothing true to
 * show. Each of them said so in its own words and its own markup, and four
 * others said nothing at all: the config editor returned `null` and vanished,
 * while the CLI / runtime / preset lists simply rendered without their status
 * badges, which reads as "nothing is installed" rather than "not knowable here".
 *
 * The wording stays per-section on purpose — "MCP management is only available
 * in the desktop app" tells the user more than a generic line would. What's
 * shared is the shape: same icon, same tone, same place in the layout, so the
 * limitation is recognisable at a glance wherever it turns up.
 */
export function DesktopOnlyNote({
  children,
  className,
}: {
  /** The section's own explanation of what it can't do here. */
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground",
        className
      )}
    >
      <MonitorDown className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}
