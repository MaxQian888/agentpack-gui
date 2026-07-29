"use client"

import { Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { useT } from "@/lib/i18n/provider"
import { missingPicks, type AccountProfile } from "@/lib/agentpack/ccswitch/accounts"
import type { Provider } from "@/lib/agentpack/ccswitch/types"

/**
 * Named combinations of provider selections — "work" versus "personal",
 * switched in one click.
 *
 * A profile stores *which provider row* each app points at, never a copy of its
 * config: `is_current` in the cc-switch DB stays the one real switch, so
 * applying a profile is just a batch of the same set-current the list does.
 */
export function AccountsCard({
  accounts,
  providers,
  newAccount,
  hasCurrent,
  editingBlocked,
  onNewAccountChange,
  onSave,
  onApply,
  onDelete,
}: {
  accounts: AccountProfile[]
  providers: Provider[] | null
  newAccount: string
  /** At least one provider is current, so there is something to capture. */
  hasCurrent: boolean
  editingBlocked: boolean
  onNewAccountChange: (value: string) => void
  onSave: () => void
  onApply: (profile: AccountProfile) => void
  onDelete: (profile: AccountProfile) => void
}) {
  const c = useT().ccswitch

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-1.5 font-medium">
        <Users className="size-4" />
        {c.accountsTitle}
      </div>
      <p className="text-xs text-muted-foreground">{c.accountsHint}</p>

      {accounts.length > 0 ? (
        <Table>
          <TableBody>
            {accounts.map((a) => {
              const stale = missingPicks(a, providers ?? [])
              return (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.name}
                    {stale.length ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.accountStale(stale.join(", "))}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {Object.entries(a.picks)
                      .map(
                        ([app, id]) => `${app}: ${providers?.find((p) => p.id === id)?.name ?? "?"}`
                      )
                      .join(" · ")}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={editingBlocked}
                      onClick={() => onApply(a)}
                    >
                      {c.accountApply}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500"
                      onClick={() => onDelete(a)}
                    >
                      {c.rowActionDelete}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : null}

      <div className="flex gap-2">
        <Input
          aria-label={c.accountNewLabel}
          placeholder={c.accountNewLabel}
          value={newAccount}
          onChange={(e) => onNewAccountChange(e.target.value)}
        />
        <Button variant="outline" onClick={onSave} disabled={!newAccount.trim() || !hasCurrent}>
          {c.accountSave}
        </Button>
      </div>
    </Card>
  )
}
