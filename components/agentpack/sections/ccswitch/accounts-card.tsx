"use client"

import { useState } from "react"
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
import { PROVIDER_APPS, type Provider, type ProviderApp } from "@/lib/agentpack/ccswitch/types"

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
    <section aria-label={c.accountsTitle} className="min-w-0 rounded-lg border p-4">
      <h3 className="font-medium">{c.accountsTitle}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.accountsHint}</p>
      <div className="mt-3 min-w-0">
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
      </div>
      {/* Naming the current selection is what creates a profile, so the field
          sits under the list it adds to rather than in a panel of its own. */}
      <div className="mt-3 flex min-w-0 gap-2 border-t pt-3">
        <Input
          aria-label={c.accountNewLabel}
          placeholder={c.accountNewLabel}
          value={newAccount}
          onChange={(event) => onNewAccountChange(event.target.value)}
        />
        <Button variant="outline" onClick={onSave} disabled={!newAccount.trim() || !hasCurrent}>
          {c.accountSave}
        </Button>
      </div>

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
            {PROVIDER_APPS.map((app) => (
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
    </section>
  )
}
