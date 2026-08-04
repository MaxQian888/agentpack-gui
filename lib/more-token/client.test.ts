jest.mock("@/lib/tauri/commands", () => ({
  moreTokenCredentialState: jest.fn(),
  moreTokenForgetCredential: jest.fn(),
  moreTokenListInstances: jest.fn(),
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
import {
  ManagementApiError,
  managementRequest,
  operationId,
  quotaCurrencyLabel,
  quotaDisplayAmount,
} from "./client"

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
  }
  expect(quotaDisplayAmount(500_000, display)).toBe(7)
  expect(quotaDisplayAmount(38_000, display)).toBeCloseTo(0.532)
  expect(quotaCurrencyLabel(500_000, display)).toContain("7.00")
})

it("refuses an expired monetary conversion and falls back to quota units", () => {
  const display = {
    quota_per_unit: 500_000,
    display_currency: "USD",
    conversion_numerator: 7,
    conversion_denominator: 1,
    rate_valid_until: 1,
  }
  expect(quotaDisplayAmount(500_000, display)).toBeNull()
  expect(quotaCurrencyLabel(500_000, display)).toBe("1")
})

it("unwraps a successful management envelope", async () => {
  ;(moreTokenRequest as jest.Mock).mockResolvedValue({
    status: 200,
    body: { success: true, data: { role: "admin" }, request_id: "req-1", server_time: 1 },
  })
  await expect(managementRequest("primary", { kind: "capabilities" })).resolves.toMatchObject({
    data: { role: "admin" },
    request_id: "req-1",
  })
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
