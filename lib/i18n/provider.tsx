"use client"

import { createContext, useContext, useSyncExternalStore } from "react"
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
 * The UI language lives in a tiny external store rather than component state so
 * it can be read through `useSyncExternalStore`. That hook keeps the build-time
 * render (server snapshot → always English) separate from the client render
 * (persisted/browser language), so React hydrates against the English HTML and
 * only swaps to the real language *after* hydration — no mismatch, no
 * post-mount `setState` effect.
 */
let currentLang: Lang | null = null
const listeners = new Set<() => void>()

function getSnapshot(): Lang {
  if (currentLang === null) {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null
    currentLang = saved ?? detectBrowserLang()
  }
  return currentLang
}

function getServerSnapshot(): Lang {
  return "en"
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setLang(l: Lang) {
  currentLang = l
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, l)
  listeners.forEach((fn) => fn())
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

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
