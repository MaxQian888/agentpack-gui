"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useT } from "@/lib/i18n/provider"
import { managementRequest, ManagementApiError, operationId } from "@/lib/more-token/client"
import { quotaAmountWithRaw } from "@/lib/more-token/quota"
import { AccountActionsMenu } from "./account-actions-menu"
import { authorizeManagementPreview } from "@/lib/more-token/step-up"
import type {
  Account,
  AccountAction,
  AccountDetail,
  ManagementCapabilities,
  ManagementOperation,
  MoreTokenInstance,
  QuotaDisplaySetting,
} from "@/lib/more-token/types"

function requestData<T>(instanceId: string, operation: ManagementOperation) {
  return managementRequest<T>(instanceId, operation).then((response) => response.data)
}

function errorText(error: unknown): string {
  if (error instanceof ManagementApiError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

function formatTime(value: number): string {
  if (!value) return "—"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000))
}

export function AccountDetailSheet({
  account,
  quotaDisplay,
  instance,
  capabilities,
  readOnly = false,
  onDone,
  onAction,
  onViewChildren,
  onOpenChange,
}: {
  account: AccountDetail | null
  quotaDisplay: QuotaDisplaySetting
  instance: MoreTokenInstance
  capabilities: ManagementCapabilities
  readOnly?: boolean
  onDone: () => void
  /** Opens the lifecycle dialog the account center owns. */
  onAction?: (account: Account, action: AccountAction | "close") => void
  onViewChildren?: (account: Account) => void
  onOpenChange: (open: boolean) => void
}) {
  const m = useT().management
  const lifecycleLabel = (state: AccountDetail["lifecycle_state"]) =>
    state === "closing" ? m.closing : state === "archived" ? m.archived : m.active
  const [invitationReason, setInvitationReason] = useState("")
  const invitation = useMutation({
    mutationFn: async (action: "resend" | "revoke") => {
      if (!account) throw new Error("ACCOUNT_NOT_SELECTED")
      const draft = {
        account_id: account.id,
        operation_id: operationId(),
        reason: invitationReason.trim(),
      }
      const preview = await requestData<{ preview_token: string }>(instance.id, {
        kind: "actionPreview",
        body: { action: `invitation_${action}`, payload: draft },
      })
      await authorizeManagementPreview(instance.id, preview.preview_token)
      const body = {
        operation_id: draft.operation_id,
        reason: draft.reason,
        preview_token: preview.preview_token,
      }
      return requestData(
        instance.id,
        action === "resend"
          ? { kind: "resendAccountInvitation", id: account.id, body }
          : { kind: "revokeAccountInvitation", id: account.id, body }
      )
    },
    onSuccess: () => {
      setInvitationReason("")
      onDone()
    },
    onError: (error) => toast.error(errorText(error)),
  })

  return (
    <Sheet open={account !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex min-w-0 items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <SheetTitle>{m.accountDetail}</SheetTitle>
              <SheetDescription>{account?.username}</SheetDescription>
            </div>
            {account && onAction ? (
              <AccountActionsMenu
                account={account}
                capabilities={capabilities}
                readOnly={readOnly}
                onAction={onAction}
                extra={
                  onViewChildren && account.is_master && account.children.length
                    ? [
                        {
                          key: "children",
                          label: m.viewChildren,
                          onSelect: () => onViewChildren(account),
                        },
                      ]
                    : undefined
                }
              />
            ) : null}
          </div>
        </SheetHeader>
        {account ? (
          <div className="space-y-4 px-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
              <dt className="text-muted-foreground">ID</dt>
              <dd className="tabular-nums">{account.id}</dd>
              <dt className="text-muted-foreground">{m.balance}</dt>
              <dd className="tabular-nums">{quotaAmountWithRaw(account.quota, quotaDisplay)}</dd>
              <dt className="text-muted-foreground">{m.usedQuota}</dt>
              <dd className="tabular-nums">
                {quotaAmountWithRaw(account.used_quota, quotaDisplay)}
              </dd>
              <dt className="text-muted-foreground">{m.role}</dt>
              <dd>
                {account.role >= 100
                  ? m.root
                  : account.role >= 10
                    ? m.admin
                    : account.is_master
                      ? m.master
                      : m.user}
              </dd>
              <dt className="text-muted-foreground">{m.relationship}</dt>
              <dd>
                {account.master_id
                  ? m.childOf(account.master_id)
                  : account.is_master
                    ? m.childrenCount(account.children_count ?? account.children.length)
                    : m.independent}
              </dd>
              <dt className="text-muted-foreground">{m.accessStatus}</dt>
              <dd>{account.status === 1 ? m.enabled : m.disabled}</dd>
              <dt className="text-muted-foreground">{m.lifecycle}</dt>
              <dd>{lifecycleLabel(account.lifecycle_state)}</dd>
              <dt className="text-muted-foreground">{m.group}</dt>
              <dd>{account.group || "—"}</dd>
              <dt className="text-muted-foreground">{m.created}</dt>
              <dd className="tabular-nums">{formatTime(account.created_at)}</dd>
              <dt className="text-muted-foreground">{m.lastLogin}</dt>
              <dd className="tabular-nums">{formatTime(account.last_login_at)}</dd>
              <dt className="text-muted-foreground">quota_version</dt>
              <dd className="font-mono text-xs">{account.quota_version}</dd>
              <dt className="text-muted-foreground">management_version</dt>
              <dd className="font-mono text-xs">{account.management_version}</dd>
              <dt className="text-muted-foreground">{m.email}</dt>
              <dd className="truncate">{account.email || "—"}</dd>
              <dt className="text-muted-foreground">{m.credentialState}</dt>
              <dd>
                {account.must_change_password
                  ? m.passwordChangeRequired
                  : account.invitation_status || m.ready}
              </dd>
            </dl>
            {account.parent ? (
              <section className="space-y-2 rounded-lg border p-3">
                <h3 className="text-sm font-medium">{m.directParent}</h3>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{account.parent.username}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {account.parent.display_name || `#${account.parent.id}`}
                    </p>
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {quotaAmountWithRaw(account.parent.quota, quotaDisplay)}
                  </span>
                </div>
              </section>
            ) : null}
            <section className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{m.directChildren}</h3>
                <Badge variant="secondary">{account.children.length}</Badge>
              </div>
              {account.children.length ? (
                <div className="divide-y">
                  {account.children.map((child) => (
                    <div
                      key={child.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{child.username}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {child.display_name || `#${child.id}`} ·{" "}
                          {lifecycleLabel(child.lifecycle_state)}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {quotaAmountWithRaw(child.quota, quotaDisplay)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{m.noChildren}</p>
              )}
              {account.children_truncated ? (
                <p className="text-xs text-muted-foreground">{m.childrenTruncated}</p>
              ) : null}
            </section>
            <section className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{m.activeBillingSessions}</h3>
                <Badge variant="secondary">{account.active_billing_sessions}</Badge>
              </div>
              {account.active_sessions.length ? (
                <div className="space-y-2">
                  {account.active_sessions.map((session) => (
                    <div key={session.id} className="rounded-md bg-muted/50 p-2.5 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{session.funding_source}</span>
                        <Badge variant="outline">{session.status}</Badge>
                      </div>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">{m.reservedQuota}</dt>
                        <dd className="text-right tabular-nums">
                          {quotaAmountWithRaw(session.reserved_quota, quotaDisplay)}
                        </dd>
                        <dt className="text-muted-foreground">{m.startedAt}</dt>
                        <dd className="text-right">{formatTime(session.started_at)}</dd>
                        <dt className="text-muted-foreground">{m.leaseExpires}</dt>
                        <dd className="text-right">{formatTime(session.lease_expires_at)}</dd>
                      </dl>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{m.noActiveSessions}</p>
              )}
              {account.active_sessions_truncated ? (
                <p className="text-xs text-muted-foreground">{m.activeSessionsTruncated}</p>
              ) : null}
            </section>
            {capabilities.features.account_invites_enabled &&
            capabilities.scopes.includes("accounts:write") &&
            account.invitation_status ? (
              <div className="space-y-3 rounded-md border p-3">
                <Label htmlFor="invitation-reason">{m.reason}</Label>
                <Input
                  id="invitation-reason"
                  value={invitationReason}
                  onChange={(event) => setInvitationReason(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!invitationReason.trim() || invitation.isPending || instance.readOnly}
                    onClick={() => invitation.mutate("resend")}
                  >
                    {m.resendInvitation}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!invitationReason.trim() || invitation.isPending || instance.readOnly}
                    onClick={() => invitation.mutate("revoke")}
                  >
                    {m.revokeInvitation}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
