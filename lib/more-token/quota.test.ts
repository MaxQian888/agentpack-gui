import { quotaAmountWithRaw } from "./quota"

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
