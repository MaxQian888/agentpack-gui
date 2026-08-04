jest.mock("@/lib/tauri/commands", () => ({
  moreTokenCredentialState: jest.fn(),
  moreTokenForgetCredential: jest.fn(),
  moreTokenListInstances: jest.fn(),
  moreTokenPair: jest.fn(),
  moreTokenRemoveInstance: jest.fn(),
  moreTokenRequest: jest.fn(),
  moreTokenSaveInstance: jest.fn(),
}))

import { moreTokenRequest } from "@/lib/tauri/commands"
import { ManagementApiError, managementRequest, operationId } from "./client"

it("creates UUIDv7 operation identifiers", () => {
  const id = operationId()
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
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
