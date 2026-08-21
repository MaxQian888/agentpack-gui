"use client"

import { Ellipsis } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useT } from "@/lib/i18n/provider"
import { availableAccountActions } from "@/lib/more-token/accounts"
import type { Account, AccountAction, ManagementCapabilities } from "@/lib/more-token/types"

/**
 * The lifecycle menu for one account. It lives in its own module because both
 * the account table and the detail sheet open it, and the sheet is imported by
 * the table's own file.
 */
export function AccountActionsMenu({
  account,
  capabilities,
  readOnly,
  onAction,
  extra,
}: {
  account: Account
  capabilities: ManagementCapabilities
  readOnly: boolean
  onAction: (account: Account, action: AccountAction | "close") => void
  /** Navigation items that are always available, above the lifecycle actions. */
  extra?: Array<{ key: string; label: string; onSelect: () => void }>
}) {
  const m = useT().management
  const actions = availableAccountActions(account, capabilities, readOnly)
  if (!actions.length && !extra?.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${m.actions}: ${account.username}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {extra?.map((item) => (
          <DropdownMenuItem key={item.key} onClick={item.onSelect}>
            {item.label}
          </DropdownMenuItem>
        ))}
        {actions.map((action) => (
          <DropdownMenuItem
            key={action}
            className={action === "close" ? "text-destructive" : undefined}
            onClick={() => onAction(account, action)}
          >
            {m[action === "password" ? "changePassword" : action]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
