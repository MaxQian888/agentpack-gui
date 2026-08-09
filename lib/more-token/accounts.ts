import type { Account, AccountAction, ManagementCapabilities } from "./types"

export function availableAccountActions(
  account: Account,
  actorRole: ManagementCapabilities["role"]
): AccountAction[] {
  if (account.lifecycle_state === "archived") return ["restore"]
  if (account.lifecycle_state === "closing") return account.status === 1 ? ["disable"] : []

  const actions: AccountAction[] = [account.status === 1 ? "disable" : "enable", "archive"]
  if (account.master_id > 0) actions.push("detach")
  else if (
    account.role < 10 &&
    account.is_master &&
    account.children_count === 0 &&
    (actorRole === "root" || actorRole === "admin")
  ) {
    actions.push("attach")
  }
  actions.push("password")
  return actions
}
