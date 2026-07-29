"use client"

import { Loader2 } from "lucide-react"
import { useT } from "@/lib/i18n/provider"

/**
 * "Loading…" with a spinner — the placeholder every cc-switch card shows while
 * the first scan is in flight. One component so the three cards can't drift
 * apart on spinner size or spacing.
 */
export function LoadingLine() {
  const c = useT().ccswitch
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {c.loading}
    </p>
  )
}
