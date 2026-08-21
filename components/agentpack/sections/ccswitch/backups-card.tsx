"use client"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
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
import { useT } from "@/lib/i18n/provider"
import type { BackupEntry } from "@/lib/tauri/commands"
import { LoadingLine } from "./loading-line"

/**
 * Snapshots taken before every write, with one-click restore.
 *
 * Restore is behind a confirm dialog because it overwrites live config files —
 * the one action here the user can't undo by clicking again.
 */
export function BackupsCard({
  backups,
  loading,
  onRestore,
}: {
  backups: BackupEntry[]
  loading: boolean
  onRestore: (id: string) => void
}) {
  const t = useT()
  const c = t.ccswitch

  return (
    <section aria-label={c.backupsTitle} className="min-w-0 rounded-lg border p-4">
      <h3 className="font-medium">{c.backupsTitle}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.backupsHint}</p>
      {backups.length > 0 ? (
        <Table className="mt-2">
          <TableBody>
            {backups.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="text-sm">
                  {new Date(b.ts).toLocaleString()}
                  <span className="ml-2 text-muted-foreground">{b.reason}</span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.backupFiles(b.files.length)}
                </TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        {c.restore}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{c.restore}</AlertDialogTitle>
                        <AlertDialogDescription>{c.restoreConfirm}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t.shell.cancel}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onRestore(b.id)}>
                          {c.restore}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : loading ? (
        <div className="mt-3">
          <LoadingLine />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{c.noBackups}</p>
      )}
    </section>
  )
}
