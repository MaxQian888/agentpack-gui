import type { Lang } from "@/lib/i18n/types"

/** Normalize a raw locale string (e.g. "zh_CN.UTF-8", "en-US") to a Lang. */
export function normalizeLang(raw: string | undefined): Lang | undefined {
  if (!raw) return undefined
  const v = raw.toLowerCase()
  if (v.startsWith("zh")) return "zh-CN"
  if (v.startsWith("en")) return "en"
  return undefined
}

/** Detect UI language from the browser; falls back to English. */
export function detectBrowserLang(): Lang {
  const nav = typeof navigator !== "undefined" ? navigator.language : undefined
  return normalizeLang(nav) ?? "en"
}
