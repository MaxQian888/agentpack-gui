import { availableAccountActions } from "./accounts"
import type { Account } from "./types"

const account: Account = {
  id: 1,
  username: "master",
  display_name: "Master",
  role: 1,
  status: 1,
  group: "default",
  quota: 100,
  used_quota: 0,
  master_id: 0,
  is_master: true,
  lifecycle_state: "active",
  quota_version: 1,
  management_version: 1,
  children_count: 0,
  created_at: 1,
  last_login_at: 0,
}

it("limits account actions by lifecycle, relation, and actor role", () => {
  expect(availableAccountActions({ ...account, lifecycle_state: "archived" }, "root")).toEqual([
    "restore",
  ])
  expect(availableAccountActions(account, "admin")).toContain("attach")
  expect(availableAccountActions(account, "master")).not.toContain("attach")
  expect(availableAccountActions({ ...account, role: 10 }, "root")).not.toContain("attach")
})
