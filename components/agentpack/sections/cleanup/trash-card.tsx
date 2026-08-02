"use client"

import { useState } from "react"
import { RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { formatBytes, targetLabel } from "@/lib/agentpack/cleanup"
import { useT } from "@/lib/i18n/provider"
import {
  cleanupQuarantinePurge,
  cleanupQuarantineRestore,
  type QuarantineEntry,
} from "@/lib/tauri/commands"

/**
 * The recycle area: everything cleanup has moved but not yet destroyed.
 *
 * This card is what makes the default cleanup mode honest. Quarantining is a
 * rename, so a run "clears" 1.9 GB without freeing a byte of it — and a section
 * that reported the gigabytes as reclaimed while they sat in a hidden directory
 * would be lying in exactly the way disk-cleaner software is famous for. So the
 * held size is always on screen, and emptying is a separate, confirmed action
 * that says plainly it is the only copy.
 */
export function TrashCard({
  entries,
  onChanged,
}: {
  entries: QuarantineEntry[]
  onChanged: () => void | Promise<void>
}) {
  const t = useT()
  const c = t.cleanup.trash
  const [busy, setBusy] = useState(false)
  const held = entries.reduce((sum, e) => sum + e.bytes, 0)

  const restore = async (id: string) => {
    setBusy(true)
    try {
      const result = await cleanupQuarantineRestore(id)
      toast.success(c.restored(result.restored))
      // A path the CLI has written to again is skipped, not overwritten, and
      // saying so is the difference between "put back" and "put back most of it".
      if (result.errors.length > 0) toast.warning(c.restoreSkipped(result.errors.length))
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const purge = async (id?: string) => {
    setBusy(true)
    try {
      const freed = await cleanupQuarantinePurge(id)
      toast.success(c.purged(formatBytes(freed)))
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{c.title}</span>
            {entries.length > 0 ? (
              <Badge variant="secondary" className="font-normal">
                {c.holding(formatBytes(held), entries.length)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{c.subtitle}</p>
        </div>
        {entries.length > 0 ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5" disabled={busy}>
                <Trash2 className="size-3.5" />
                {c.purgeAll}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{c.purgeConfirmTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {c.purgeConfirmBody(formatBytes(held))}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void purge()}>{c.purgeAll}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{c.empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {entry.targetIds.map((id) => targetLabel(t, id)).join(" · ")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.batch(entry.items, formatBytes(entry.bytes))}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => void restore(entry.id)}
                >
                  <RotateCcw className="size-3.5" />
                  {c.restore}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void purge(entry.id)}
                >
                  {c.purge}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
