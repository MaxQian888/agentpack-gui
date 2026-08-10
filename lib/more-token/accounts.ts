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
