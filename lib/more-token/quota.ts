import type { QuotaDisplaySetting, QuotaTransaction } from "./types"

export function quotaTransactionsCsvRows(
  transactions: QuotaTransaction[]
): Array<Array<string | number>> {
  return [
    [
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
    ],
    ...transactions.map((transaction) => [
      transaction.id,
      transaction.operation_id,
      transaction.type,
      transaction.actor_id,
      transaction.source_id,
      transaction.target_id,
      transaction.amount,
      transaction.source_before,
      transaction.source_after,
      transaction.target_before,
      transaction.target_after,
      transaction.status,
      transaction.reason,
      transaction.reversal_of ?? "",
      new Date(transaction.created_at * 1000).toISOString(),
    ]),
  ]
}

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

/**
 * The same authoritative string as `quotaAmountWithRaw`, split so a table cell
 * can set the converted amount on one line and the raw quota — which stays
 * authoritative when the display rate expires — as its meta line. `raw` is null
 * exactly when there is nothing to convert from, i.e. the primary IS the raw
 * quota.
 */
export function quotaAmountParts(
  value: number,
  display: QuotaDisplaySetting
): { primary: string; raw: string | null } {
  const text = quotaAmountWithRaw(value, display)
  const separator = text.indexOf(" · ")
  if (separator < 0) return { primary: text, raw: null }
  return { primary: text.slice(0, separator), raw: text.slice(separator + 3) }
}
