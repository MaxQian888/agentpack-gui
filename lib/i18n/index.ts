import { en } from "./en"
import { zhCN } from "./zh-CN"
import type { Lang, Messages } from "./types"

/** Per-language catalogs. */
export const catalogs: Record<Lang, Messages> = {
  en,
  "zh-CN": zhCN,
}

/** Resolve the catalog for a language, falling back to English. */
export function getMessages(lang: Lang): Messages {
  return catalogs[lang] ?? en
}

export type { Lang, Messages, CoreOutput } from "./types"
