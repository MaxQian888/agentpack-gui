/**
 * The models.dev price sync, as the app runs it: once at startup (if the
 * cached copy is over a day old and the preference allows), and on demand from
 * the usage dashboard or Preferences. State lives in the store (`priceSync`,
 * `pricesVersion`); the pure half is `lib/history/pricing-sync`, the disk and
 * network half `lib/tauri/pricing`.
 *
 * Not a reviewed write. The review panel gates changes to the agents' own
 * configuration; this is the app's own cache, like the history cache or
 * `settings.json`, and touches nothing an agent reads.
 */

import { syncDue } from "@/lib/history/pricing-sync"
import { downloadPrices, loadCachedPrices } from "@/lib/tauri/pricing"
import { useAppStore } from "@/store/app-store"

let inflight: Promise<boolean> | null = null

/**
 * Fetch fresh prices now. Resolves true when they were applied, false when the
 * sync failed — the failure is recorded in `priceSync` and the prices already
 * in use stay. A second call while one is running joins it.
 */
export function syncModelPrices(home: string): Promise<boolean> {
  if (inflight) return inflight
  const store = useAppStore.getState()
  store.setPriceSync({ status: "syncing", error: null })
  inflight = downloadPrices(home)
    .then((prices) => {
      useAppStore.getState().applyPrices(prices)
      return true
    })
    .catch((e: unknown) => {
      useAppStore
        .getState()
        .setPriceSync({ status: "failed", error: e instanceof Error ? e.message : String(e) })
      return false
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * Startup: install the cached copy at once (so costs are right before any
 * network round-trip), then refresh it in the background if it is due and the
 * user hasn't turned automatic syncing off.
 */
export async function initModelPrices(
  home: string,
  autoSync: boolean,
  now = Date.now()
): Promise<void> {
  const cached = await loadCachedPrices(home)
  if (cached) useAppStore.getState().applyPrices(cached)
  if (autoSync && syncDue(cached?.fetchedAt ?? null, now)) await syncModelPrices(home)
}
