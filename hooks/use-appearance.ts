"use client"

import { useEffect } from "react"
import { normalizeUiScale } from "@/lib/agentpack/appearance"
import { useAppStore } from "@/store/app-store"

/**
 * Apply the two appearance preferences that live on the document rather than in
 * React: interface scale and the reduced-motion override.
 *
 * Both are attributes on `<html>`, matched by rules in `app/globals.css`, so the
 * values themselves stay in `tokens.css` and nothing here writes a px size or a
 * duration. Called once from the shell, which means it covers both paths that
 * set them — Preferences changing one live, and startup restoring what was
 * persisted — without either having to know about the DOM.
 *
 * A default is expressed by *removing* the attribute, not by writing "100": an
 * install that has never opened Preferences renders off the plain stylesheet.
 */
export function useAppearance(): void {
  const uiScale = useAppStore((s) => s.settings.uiScale)
  const reduceMotion = useAppStore((s) => s.settings.reduceMotion)

  useEffect(() => {
    const root = document.documentElement
    const scale = normalizeUiScale(uiScale)
    if (scale === 100) delete root.dataset.uiScale
    else root.dataset.uiScale = String(scale)
  }, [uiScale])

  useEffect(() => {
    const root = document.documentElement
    if (reduceMotion) root.dataset.reduceMotion = "true"
    else delete root.dataset.reduceMotion
  }, [reduceMotion])
}
