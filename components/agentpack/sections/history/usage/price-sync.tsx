"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMounted } from "@/hooks/use-mounted"
import type { UnpricedModel } from "@/lib/history/stats"
import { useT } from "@/lib/i18n/provider"
import { isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import { syncModelPrices } from "../../../model-prices"

/** How many unpriced models are named before the rest become a count. */
const NAMED = 4

/**
 * Where the prices behind every estimate come from, and the way to refresh
 * them: models.dev with its date, or the built-in table when nothing has been
 * synced. With `unpriced`, it also names the models no price covers — the
 * reason a total reads as a lower bound.
 */
export function PriceSync({
  unpriced,
  className,
}: {
  unpriced?: readonly UnpricedModel[]
  className?: string
}) {
  const t = useT().history.prices
  const mounted = useMounted()
  const desktop = mounted && isTauri()
  const sync = useAppStore((s) => s.priceSync)
  const home = useAppStore((s) => s.paths?.home)
  const syncing = sync.status === "syncing"
  const named = (unpriced ?? []).slice(0, NAMED).map((m) => m.model)
  const more = (unpriced?.length ?? 0) - named.length

  return (
    <div className={cn("flex flex-col gap-1.5 text-xs text-muted-foreground", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground">{t.title}</span>
        <span className="font-mono">
          {sync.fetchedAt
            ? t.synced(new Date(sync.fetchedAt).toLocaleString(), sync.models)
            : t.builtin}
        </span>
        {desktop && home ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2"
            disabled={syncing}
            onClick={() => void syncModelPrices(home)}
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} aria-hidden="true" />
            {syncing ? t.syncing : t.syncNow}
          </Button>
        ) : mounted && !desktop ? (
          <span>{t.desktopOnly}</span>
        ) : null}
      </div>
      {sync.status === "failed" && sync.error ? (
        <p role="status" className="text-[var(--hm-warn)]">
          {t.failed(sync.error)}
        </p>
      ) : null}
      {named.length > 0 ? <p className="font-mono">{t.unpriced(named.join(", "), more)}</p> : null}
    </div>
  )
}
