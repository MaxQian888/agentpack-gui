import { availableAccountActions } from "./accounts"
import type { Account, ManagementCapabilities } from "./types"

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

const capabilities: ManagementCapabilities = {
  management_api_version: 2,
  minimum_desktop_version: "0.14.5",
  role: "root",
  scopes: ["accounts:read", "accounts:write"],
  features: {
    management_api_enabled: true,
    personal_api_enabled: true,
    quota_transfer_enabled: true,
    quota_policy_automation_enabled: true,
    distribution_detail_enabled: true,
    step_up_required: true,
    account_invites_enabled: true,
    remote_revoke_enabled: true,
  },
  quota_display: {
    quota_per_unit: 500_000,
    display_currency: "USD",
    conversion_numerator: 1,
    conversion_denominator: 1,
    rate_valid_until: 0,
    version: 1,
  },
  quota_display_version: "1",
}

it("limits account actions by lifecycle, relation, scope, and actor role", () => {
  expect(
    availableAccountActions({ ...account, lifecycle_state: "archived" }, capabilities, false)
  ).toEqual(["restore"])
  expect(availableAccountActions(account, capabilities, false)).toEqual([
    "disable",
    "archive",
    "attach",
    "password",
    "close",
  ])
  expect(
    availableAccountActions(account, { ...capabilities, role: "master" }, false)
  ).not.toContain("attach")
  expect(availableAccountActions({ ...account, role: 10 }, capabilities, false)).not.toContain(
    "attach"
  )
  expect(
    availableAccountActions(
      { ...account, master_id: 2, is_master: false },
      { ...capabilities, role: "master" },
      false
    )
  ).toContain("detach")
  expect(
    availableAccountActions(account, { ...capabilities, scopes: ["accounts:read"] }, false)
  ).toEqual([])
  expect(availableAccountActions(account, capabilities, true)).toEqual([])
  expect(
    availableAccountActions(
      account,
      {
        ...capabilities,
        features: { ...capabilities.features, distribution_detail_enabled: false },
      },
      false
    )
  ).toContain("attach")
  expect(
    availableAccountActions(
      { ...account, lifecycle_state: "closing", status: 2 },
      capabilities,
      false
    )
  ).toEqual([])
})
