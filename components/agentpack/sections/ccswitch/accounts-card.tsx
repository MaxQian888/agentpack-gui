"use client"

import { useState } from "react"
import { Users } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { useT } from "@/lib/i18n/provider"
import { missingPicks, type AccountProfile } from "@/lib/agentpack/ccswitch/accounts"
import type { Provider, ProviderApp } from "@/lib/agentpack/ccswitch/types"

const APPS = ["claude", "codex", "opencode"] as const
const UNCHANGED = "__unchanged__"

export function AccountsCard({
  accounts,
  providers,
  newAccount,
  hasCurrent,
  editingBlocked,
  onNewAccountChange,
  onSave,
  onUpdate,
  onApply,
  onDelete,
}: {
  accounts: AccountProfile[]
  providers: Provider[] | null
  newAccount: string
  hasCurrent: boolean
  editingBlocked: boolean
  onNewAccountChange: (value: string) => void
  onSave: () => void
  onUpdate: (profile: AccountProfile) => void
  onApply: (profile: AccountProfile) => void
  onDelete: (profile: AccountProfile) => void
}) {
  const c = useT().ccswitch
  const [editing, setEditing] = useState<AccountProfile | null>(null)
  const [editName, setEditName] = useState("")
  const [editPicks, setEditPicks] = useState<AccountProfile["picks"]>({})

  const openEditor = (profile: AccountProfile) => {
    setEditing(profile)
    setEditName(profile.name)
    setEditPicks(profile.picks)
  }

  const setPick = (app: ProviderApp, id: string) => {
    setEditPicks((current) => {
      const next = { ...current }
      if (id === UNCHANGED) delete next[app]
      else next[app] = id
      return next
    })
  }

  const saveEdit = () => {
    if (!editing || !editName.trim()) return
    onUpdate({ ...editing, name: editName.trim(), picks: editPicks })
    setEditing(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Users data-icon="inline-start" />
          {c.accountsTitle}
        </CardTitle>
        <CardDescription>{c.accountsHint}</CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length > 0 ? (
          <Table>
            <TableBody>
              {accounts.map((account) => {
                const stale = missingPicks(account, providers ?? [])
                return (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      {account.name}
                      {stale.length ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.accountStale(stale.join(", "))}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Object.entries(account.picks)
                        .map(
                          ([app, id]) =>
                            `${app}: ${providers?.find((provider) => provider.id === id)?.name ?? "?"}`
                        )
                        .join(" · ")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={editingBlocked}
                          onClick={() => onApply(account)}
                        >
                          {c.accountApply}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={editingBlocked}
                          onClick={() => openEditor(account)}
                        >
                          {c.rowActionEdit}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" disabled={editingBlocked}>
                              {c.rowActionDelete}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{c.rowActionDelete}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {c.accountDeleteConfirm(account.name)}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{c.accountCancel}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDelete(account)}>
                                {c.rowActionDelete}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{c.accountEmpty}</p>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Input
          aria-label={c.accountNewLabel}
          placeholder={c.accountNewLabel}
          value={newAccount}
          onChange={(event) => onNewAccountChange(event.target.value)}
        />
        <Button variant="outline" onClick={onSave} disabled={!newAccount.trim() || !hasCurrent}>
          {c.accountSave}
        </Button>
      </CardFooter>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.accountEditTitle}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="account-name">{c.accountNewLabel}</FieldLabel>
              <Input
                id="account-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </Field>
            {APPS.map((app) => (
              <Field key={app}>
                <FieldLabel htmlFor={`account-${app}`}>{c.accountPick(app)}</FieldLabel>
                <Select
                  value={editPicks[app] ?? UNCHANGED}
                  onValueChange={(value) => setPick(app, value)}
                >
                  <SelectTrigger id={`account-${app}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={UNCHANGED}>{c.accountLeaveUnchanged}</SelectItem>
                      {(providers ?? [])
                        .filter((provider) => provider.app_type === app)
                        .map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ))}
          </FieldGroup>
          <DialogFooter>
            <Button onClick={saveEdit} disabled={!editName.trim()}>
              {c.accountUpdate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
