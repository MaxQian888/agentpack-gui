import { escapeCsvCell } from "./client"
import { quotaAmountParts, quotaAmountWithRaw, quotaTransactionsCsvRows } from "./quota"

it("formats rational display amounts while preserving authoritative raw quota", () => {
  expect(
    quotaAmountWithRaw(500_000, {
      quota_per_unit: 500_000,
      display_currency: "USD",
      conversion_numerator: 7,
      conversion_denominator: 2,
      rate_valid_until: 0,
      version: 1,
    })
  ).toBe("USD 3.5 · 500,000 quota")
})

it("falls back to authoritative raw quota when the exchange rate expired", () => {
  expect(
    quotaAmountWithRaw(500_000, {
      quota_per_unit: 500_000,
      display_currency: "USD",
      conversion_numerator: 7,
      conversion_denominator: 2,
      rate_valid_until: 1,
      version: 1,
    })
  ).toBe("500,000 quota")
})

it("builds a complete ledger export whose user-controlled fields are CSV-safe", () => {
  const rows = quotaTransactionsCsvRows([
    {
      id: 7,
      operation_id: "0198fefe-1111-7111-8111-111111111111",
      type: "transfer",
      actor_id: 1,
      source_id: 2,
      target_id: 3,
      amount: 25,
      source_before: 100,
      source_after: 75,
      target_before: 10,
      target_after: 35,
      status: "committed",
      reason: '=HYPERLINK("https://evil.example")',
      request_id: "request-7",
      created_at: 1_700_000_000,
    },
  ])

  expect(rows[0]).toEqual([
    "id",
    "operation_id",
    "type",
    "actor_id",
    "source_id",
    "target_id",
    "amount_quota",
    "source_before",
    "source_after",
    "target_before",
    "target_after",
    "status",
    "reason",
    "reversal_of",
    "created_at",
  ])
  expect(rows[1]?.map(escapeCsvCell).join(",")).toContain(
    '"\'=HYPERLINK(""https://evil.example"")"'
  )
  expect(rows[1]).not.toContain("request-7")
})

it("splits a converted amount into its display half and its authoritative raw half", () => {
  expect(
    quotaAmountParts(500_000, {
      quota_per_unit: 500_000,
      display_currency: "USD",
      conversion_numerator: 7,
      conversion_denominator: 2,
      rate_valid_until: 0,
      version: 1,
    })
  ).toEqual({ primary: "USD 3.5", raw: "500,000 quota" })
})

it("reports no separate raw half when the raw quota is the only authoritative value", () => {
  expect(
    quotaAmountParts(500_000, {
      quota_per_unit: 500_000,
      display_currency: "USD",
      conversion_numerator: 7,
      conversion_denominator: 2,
      rate_valid_until: 1,
      version: 1,
    })
  ).toEqual({ primary: "500,000 quota", raw: null })
})
