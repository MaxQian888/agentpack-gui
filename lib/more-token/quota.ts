import type { QuotaDisplaySetting } from "./types"

export function quotaAmountWithRaw(value: number, display: QuotaDisplaySetting): string {
  const raw = `${new Intl.NumberFormat().format(value)} quota`
  if (display.rate_valid_until > 0 && display.rate_valid_until < Math.floor(Date.now() / 1000)) {
    return raw
  }
  const denominator = BigInt(display.quota_per_unit) * BigInt(display.conversion_denominator)
  if (denominator <= BigInt(0)) return raw
  const sign = value < 0 ? "-" : ""
  const scaled =
    (BigInt(Math.abs(value)) * BigInt(display.conversion_numerator) * BigInt(10_000)) / denominator
  const whole = scaled / BigInt(10_000)
  const fraction = (scaled % BigInt(10_000)).toString().padStart(4, "0").replace(/0+$/, "")
  return `${display.display_currency} ${sign}${whole.toString()}${fraction ? `.${fraction}` : ""} · ${raw}`
}
