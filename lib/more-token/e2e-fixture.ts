import { createMemoryMoreTokenPort, type MoreTokenPort } from "./port"
import type { Account, ManagementOperation, PersonalSession } from "./types"

export type MoreTokenFixtureRole = "root" | "master" | "child"

const quotaDisplay = {
  quota_per_unit: 500_000,
  display_currency: "CNY",
  conversion_numerator: 1,
  conversion_denominator: 1,
  rate_valid_until: 0,
  version: 1,
}

const master: Account = {
  id: 1,
  username: "master-a",
  display_name: "Master A",
  role: 1,
  status: 1,
  quota: 1_000,
  used_quota: 200,
  is_master: true,
  master_id: 0,
  lifecycle_state: "active",
  quota_version: 3,
  management_version: 2,
  children_count: 1,
  created_at: 1_700_000_000,
  last_login_at: 1_700_000_500,
  group: "default",
}

const child: Account = {
  id: 2,
  username: "child-a",
  display_name: "Child A",
  role: 1,
  status: 1,
  quota: 80,
  used_quota: 20,
  is_master: false,
  master_id: 1,
  lifecycle_state: "active",
  quota_version: 2,
  management_version: 1,
  children_count: 0,
  created_at: 1_700_000_100,
  last_login_at: 1_700_000_600,
  group: "default",
}

const independent: Account = {
  ...master,
  id: 3,
  username: "independent-a",
  display_name: "Independent A",
  quota: 400,
  used_quota: 10,
  children_count: 0,
  quota_version: 1,
  management_version: 1,
}

function envelope(data: unknown) {
  return {
    status: 200,
    body: {
      success: true,
      data,
      request_id: "e2e-request",
      server_time: 1_700_001_000,
    },
  }
}

function managementData(
  role: Exclude<MoreTokenFixtureRole, "child">,
  operation: ManagementOperation,
  accounts: Account[]
) {
  switch (operation.kind) {
    case "capabilities":
      return {
        management_api_version: 2,
        minimum_desktop_version: "0.14.5",
        role,
        scopes: [
          "accounts:read",
          "accounts:write",
          "quota:read",
          "quota:transfer",
          "audit:read",
          "alerts:write",
        ],
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
        quota_display: quotaDisplay,
        quota_display_version: "1",
      }
    case "notifications":
      return []
    case "accounts": {
      const items =
        role === "root" ? accounts : accounts.filter((item) => item.id !== independent.id)
      return { items, page: 1, page_size: operation.pageSize, total: items.length }
    }
    case "account": {
      const account = accounts.find((item) => item.id === operation.id) ?? master
      return {
        account: {
          ...account,
          email: `${account.username}@example.com`,
          must_change_password: false,
          active_billing_sessions: account.id === child.id ? 1 : 0,
          invitation_status: "",
          parent:
            account.id === child.id
              ? (accounts.find((item) => item.id === master.id) ?? null)
              : null,
          children:
            account.id === master.id ? accounts.filter((item) => item.master_id === master.id) : [],
          children_truncated: false,
          active_sessions:
            account.id === child.id
              ? [
                  {
                    id: 41,
                    status: "ACTIVE",
                    funding_source: "wallet",
                    reserved_quota: 25,
                    lease_expires_at: 2_000_000_000,
                    started_at: 1_700_000_400,
                  },
                ]
              : [],
          active_sessions_truncated: false,
        },
      }
    }
    case "actionPreview":
      return {
        preview_token: "e2e-preview-token-00000000000000000000000000000000",
        impact: accounts
          .filter((item) => item.id === Number(operation.body.payload.account_id ?? 0))
          .map((item) => ({ id: item.id, quota: item.quota, quota_version: item.quota_version })),
      }
    case "createAccount": {
      const id = Math.max(...accounts.map((item) => item.id)) + 1
      accounts.push({
        ...child,
        id,
        username: operation.body.username,
        display_name: operation.body.display_name,
        master_id: operation.body.master_id,
        quota: operation.body.initial_quota,
        used_quota: 0,
        created_at: Math.floor(Date.now() / 1000),
      })
      return {
        credential_mode: "temporary_password",
        temporary_password: "E2E-temporary-9x!Q",
      }
    }
    case "accountAction": {
      const account = accounts.find((item) => item.id === operation.id)
      if (account && operation.action === "disable") account.status = 2
      if (account && operation.action === "enable") account.status = 1
      return { account }
    }
    case "quotaTransfer":
      return { transaction_id: 91, operation_id: operation.body.operation_id, status: "committed" }
    default:
      return {}
  }
}

function childData(operation: ManagementOperation, sessions: PersonalSession[]) {
  switch (operation.kind) {
    case "personalCapabilities":
      return {
        personal_api_version: "1.2",
        role: "user",
        scopes: ["profile:read", "balance:read", "sessions:read"],
        features: {
          profile_edit_enabled: true,
          password_change_enabled: true,
          account_close_enabled: true,
          billing_portal_enabled: true,
          browser_oauth_enabled: true,
          model_marketplace_enabled: true,
          usage_details_enabled: true,
          remote_revoke_enabled: true,
        },
        must_change_password: false,
        current_session_id: 9,
        password_policy: { minimum_length: 8, maximum_length: 20 },
        billing_portal_path: "/console/topup",
      }
    case "personalOverview":
      return {
        account: {
          ...child,
          email: "child-a@example.com",
          request_count: 42,
        },
        balance: { available: 80, used: 20, total: 100 },
        quota_display: quotaDisplay,
        parent: { id: master.id, username: master.username, display_name: master.display_name },
        ledger_entries: 1,
        security: {
          two_factor_enabled: true,
          active_desktop_sessions: 1,
          auth_methods: ["password", "totp"],
        },
        access: {
          group: "default",
          active_api_keys: 1,
          available_models: 2,
          last_login_at: child.last_login_at,
        },
      }
    case "personalBalance":
      return {
        available: 80,
        used: 20,
        total: 100,
        request_count: 42,
        quota_display: quotaDisplay,
      }
    case "personalLedger":
      return {
        items: [
          {
            id: 1,
            operation_id: "0198fefe-1111-7111-8111-111111111111",
            type: "initial_allocation",
            amount: 100,
            delta: 100,
            balance_before: 0,
            balance_after: 100,
            counterparty: "master-a",
            reason: "initial allocation",
            status: "committed",
            created_at: 1_700_000_100,
          },
        ],
        page: 1,
        page_size: operation.pageSize,
        total: 1,
      }
    case "personalSessions":
      return sessions
    case "revokePersonalSession": {
      const session = sessions.find((item) => item.id === operation.id)
      if (session) session.revoked_at = Math.floor(Date.now() / 1000)
      return { revoked: true }
    }
    default:
      return {}
  }
}

export function createMoreTokenE2EPort(role: MoreTokenFixtureRole): MoreTokenPort {
  if (process.env.NEXT_PUBLIC_AGENTPACK_E2E_FIXTURES !== "1") {
    throw new Error("MORE_TOKEN_E2E_FIXTURE_DISABLED")
  }
  const personal = role === "child"
  const accounts = [{ ...master }, { ...child }, { ...independent }]
  const sessions: PersonalSession[] = [
    {
      id: 10,
      public_id: "session-other",
      user_id: child.id,
      client_id: "desktop-other",
      client_label: "Other desktop",
      scopes: "profile:read balance:read",
      expires_at: 2_000_000_000,
      last_used_at: 1_700_000_900,
      revoked_at: 0,
      created_at: 1_700_000_000,
    },
  ]
  return createMemoryMoreTokenPort({
    listInstances: async () => [
      {
        id: `fixture-${role}`,
        name: `${role} fixture`,
        baseUrl: "https://more-token.example",
        caFingerprint: null,
        readOnly: false,
        displayCurrency: "CNY",
        package: personal ? "personal" : "management",
      },
    ],
    credentialState: async () => ({ connected: true, persistent: false }),
    managementStepUpStart: async () => ({
      handle: "e2e-step-up",
      authorizationUrl: "about:blank",
      expiresAt: Math.floor(Date.now() / 1000) + 120,
      intervalSeconds: 0,
    }),
    managementStepUpPoll: async () => ({ status: "authorized" }),
    request: async (_instanceId, operation) =>
      envelope(
        role === "child"
          ? childData(operation, sessions)
          : managementData(role, operation, accounts)
      ),
  })
}
