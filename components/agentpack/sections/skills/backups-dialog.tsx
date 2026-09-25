"use client"

import { useEffect, useState } from "react"
import { format } from "date-fns"
import { toast } from "sonner"
import { RotateCcw, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useT } from "@/lib/i18n/provider"
import type { Messages } from "@/lib/i18n/types"
import { useAppStore } from "@/store/app-store"
import { deleteSkillBackup, listSkillBackups } from "@/lib/tauri/commands"
import type { Paths, SkillRestoreStep } from "@/lib/agentpack/types"
import { SKILL_SOURCES } from "@/lib/skills/browse"
import { skillDestPath } from "@/lib/skills/paths"
import type { InstalledSkill, SkillBackup, SkillSource } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { useInstallGuard } from "./install-conflict-dialog"

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Put a backup back into each target root, as a step the review panel shows. */
export function skillRestoreStep(
  backup: Pick<SkillBackup, "id" | "name" | "dirName">,
  targets: SkillSource[],
  paths: Paths,
  messages: Messages
): SkillRestoreStep {
  return {
    kind: "skillRestore",
    id: `skill-restore-${backup.id}`,
    label: messages.skillsBrowser.restoreStep(backup.name, targets.join(", ")),
    backupId: backup.id,
    dirName: backup.dirName,
    targets,
    dests: targets.map((target) => skillDestPath(paths, target, backup.dirName)),
  }
}

/**
 * Restorable skill backups (created automatically before each delete).
 *
 * `backups` is the list, `null` while it loads, or `{ error }` when listing
 * failed — which used to render as "No backups yet", i.e. told someone looking
 * for a way back that there wasn't one.
 */
export function BackupsDialog({
  open,
  onOpenChange,
  skills,
  refresh,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is installed now — a restore over any of it asks first. */
  skills: InstalledSkill[]
  refresh: () => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()
  const { guard, dialog: guardDialog } = useInstallGuard()
  const [backups, setBackups] = useState<SkillBackup[] | { error: string } | null>(null)
  const [restoring, setRestoring] = useState<SkillBackup | null>(null)
  const [targets, setTargets] = useState<Set<SkillSource>>(new Set())
  const [toDelete, setToDelete] = useState<SkillBackup | null>(null)

  const reload = () => {
    setBackups(null)
    listSkillBackups()
      .then(setBackups)
      .catch((e) => setBackups({ error: String(e) }))
  }

  // Load on open. The list-load setState lives in the async callback (not the
  // effect body) so it doesn't trigger a synchronous cascading render.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    listSkillBackups()
      .then((b) => {
        if (!cancelled) setBackups(b)
      })
      .catch((e) => {
        if (!cancelled) setBackups({ error: String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const openRestore = (b: SkillBackup) => {
    // Default to the source it came from when that's a real skill root.
    const from = SKILL_SOURCES.find((s) => s === b.source)
    setTargets(new Set<SkillSource>(from ? [from] : ["claude"]))
    setRestoring(b)
  }

  // A restore replaces `<root>/<dirName>` wholesale, so it goes where every
  // other overwrite goes: past the install guard, then through the review
  // panel. It used to call the backend directly — the one skill write that did.
  const doRestore = async () => {
    if (!restoring || targets.size === 0 || !paths) return
    const b = restoring
    setRestoring(null)
    const resolved = await guard([{ dirName: b.dirName, targets: [...targets] }], skills)
    if (!resolved || resolved.length === 0) return
    await run([skillRestoreStep(b, resolved[0].targets, paths, t)])
    refresh()
  }

  const doDelete = async (b: SkillBackup) => {
    setToDelete(null)
    try {
      await deleteSkillBackup(b.id)
      toast.success(sb.backupDeleted)
      reload()
    } catch (e) {
      toast.error(sb.backupActionFailed(String(e)))
    }
  }

  const toggle = (s: SkillSource) =>
    setTargets((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{sb.backupsTitle}</DialogTitle>
            <DialogDescription>{sb.backupsSubtitle}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {backups === null ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                {sb.backupsLoading}
              </div>
            ) : "error" in backups ? (
              <div className="flex flex-col items-start gap-3 p-4 text-sm">
                <p className="text-destructive">{sb.backupsLoadFailed(backups.error)}</p>
                <Button variant="outline" size="sm" onClick={reload}>
                  {sb.retry}
                </Button>
              </div>
            ) : backups.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                {sb.backupsEmpty}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{sb.backupName}</TableHead>
                    <TableHead>{sb.backupSource}</TableHead>
                    <TableHead>{sb.backupCreated}</TableHead>
                    <TableHead>{sb.backupSize}</TableHead>
                    <TableHead className="text-right">{sb.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {sb.sources[b.source] ?? b.source}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {b.createdAt > 0 ? format(new Date(b.createdAt), "yyyy-MM-dd HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmtBytes(b.bytes)}</TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => openRestore(b)}
                        >
                          <RotateCcw className="size-3.5" /> {sb.restore}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-destructive"
                          onClick={() => setToDelete(b)}
                        >
                          <Trash2 className="size-3.5" /> {sb.deleteBackup}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore → pick targets */}
      <AlertDialog open={restoring !== null} onOpenChange={(o) => !o && setRestoring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {restoring ? sb.restore + ` "${restoring.name}"` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>{sb.restoreInto}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {SKILL_SOURCES.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={targets.has(s)} onCheckedChange={() => toggle(s)} />
                {sb.sources[s]}
              </label>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{sb.cancel}</AlertDialogCancel>
            <AlertDialogAction disabled={targets.size === 0} onClick={() => void doRestore()}>
              {sb.restore}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete backup */}
      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toDelete ? sb.deleteBackupConfirm(toDelete.name) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>{sb.deleteBackupBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{sb.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && void doDelete(toDelete)}>
              {sb.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {guardDialog}
    </>
  )
}
