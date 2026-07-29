"use client"

import { History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-1.5 font-medium">
        <History className="size-4" />
        {c.backupsTitle}
      </div>
      <p className="text-xs text-muted-foreground">{c.backupsHint}</p>
      {backups.length > 0 ? (
        <Table>
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
        <LoadingLine />
      ) : (
        <p className="text-sm text-muted-foreground">{c.noBackups}</p>
      )}
    </Card>
  )
}
