/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
"use client"

import { ExternalLink, Loader2, Power } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

/**
 * Open and quit the cc-switch desktop app, plus its live state.
 *
 * It lives in the aside rather than the checklist because it is not a step:
 * once cc-switch is installed there is nothing here to complete, only a thing
 * to run. It matters because cc-switch holds a lock on the SQLite database
 * agentpack writes — quitting it from here is what unblocks editing.
 */
export function AppCard({
  running,
  busy,
  onOpen,
  onQuit,
}: {
  running: boolean | null
  busy: "open" | "quit" | null
  onOpen: () => void
  onQuit: () => void
}) {
  const t = useT()
  const c = t.ccswitch

  return (
    <section aria-label={c.appTitle} className="min-w-0 rounded-lg border p-4">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-medium">{c.appTitle}</h3>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-[var(--hm-radius-dot)]",
              running ? "bg-[var(--hm-ok)]" : "bg-[var(--hm-neutral)]"
            )}
          />
          {running === null ? c.checking : running ? c.appRunning : c.appStopped}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={onOpen}
          disabled={busy !== null}
        >
          {busy === "open" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ExternalLink className="size-3.5" />
          )}
          {c.appOpen}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={onQuit}
          disabled={busy !== null || running === false}
        >
          {busy === "quit" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Power className="size-3.5" />
          )}
          {c.appQuit}
        </Button>
      </div>
    </section>
  )
}
