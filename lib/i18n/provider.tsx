"use client"

import { createContext, useContext, useState } from "react"
import { getMessages, type Lang, type Messages } from "./index"
import { detectBrowserLang } from "@/lib/agentpack/locale"

interface I18nContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: Messages
}

const Ctx = createContext<I18nContextValue | null>(null)
const STORAGE_KEY = "agentpack.lang"

/**
 * Resolve the initial language without a post-mount effect (which would trip
 * the set-state-in-effect lint). On the build-time render `window` is undefined
 * → English; the Tauri webview then loads the persisted/browser language.
 */
function readInitialLang(): Lang {
  if (typeof window === "undefined") return "en"
  const saved = localStorage.getItem(STORAGE_KEY) as Lang | null
  return saved ?? detectBrowserLang()
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang)

  const setLang = (l: Lang) => {
    setLangState(l)
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, l)
  }

  return <Ctx.Provider value={{ lang, setLang, t: getMessages(lang) }}>{children}</Ctx.Provider>
}

export function useT(): Messages {
  const c = useContext(Ctx)
  if (!c) throw new Error("useT must be used within an I18nProvider")
  return c.t
}

export function useLocale(): { lang: Lang; setLang: (l: Lang) => void } {
  const c = useContext(Ctx)
  if (!c) throw new Error("useLocale must be used within an I18nProvider")
  return { lang: c.lang, setLang: c.setLang }
}
