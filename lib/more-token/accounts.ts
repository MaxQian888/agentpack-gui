import type { Account, AccountAction, ManagementCapabilities } from "./types"

export type AccountMenuAction = AccountAction | "close"

export function availableAccountActions(
  account: Account,
  capabilities: ManagementCapabilities,
  readOnly: boolean
): AccountMenuAction[] {
  if (
    readOnly ||
    !capabilities.features.management_api_enabled ||
    !capabilities.scopes.includes("accounts:write")
  ) {
    return []
  }
  if (account.lifecycle_state === "archived") return ["restore"]
  if (account.lifecycle_state === "closing") return account.status === 1 ? ["disable"] : []

  const actions: AccountMenuAction[] = [account.status === 1 ? "disable" : "enable", "archive"]
  if (account.master_id > 0) {
    actions.push("detach")
  } else if (
    account.role < 10 &&
    account.is_master &&
    account.children_count === 0 &&
    (capabilities.role === "root" || capabilities.role === "admin")
  ) {
    actions.push("attach")
  }
  actions.push("password", "close")
  return actions
}

/**
 * The account page as data, for an export. It carries raw quota rather than a
 * converted amount: the display rate can expire, the quota units cannot, and a
 * spreadsheet has no way to say which one it is looking at.
 */
export function accountsCsvRows(accounts: Account[]): Array<Array<string | number>> {
  return [
    [
      "id",
      "username",
      "display_name",
      "role",
      "is_master",
      "master_id",
      "children_count",
      "quota",
      "used_quota",
      "access_status",
      "lifecycle_state",
      "group",
      "created_at",
      "last_login_at",
    ],
    ...accounts.map((account) => [
      account.id,
      account.username,
      account.display_name,
      account.role,
      account.is_master ? "true" : "false",
      account.master_id,
      account.children_count ?? 0,
      account.quota,
      account.used_quota,
      account.status === 1 ? "enabled" : "disabled",
      account.lifecycle_state || "active",
      account.group ?? "",
      account.created_at ? new Date(account.created_at * 1000).toISOString() : "",
      account.last_login_at ? new Date(account.last_login_at * 1000).toISOString() : "",
    ]),
  ]
}
