/**
 * Reading, fetching and caching model prices — the disk and network half of
 * `lib/history/pricing-sync`. A failed read degrades to "never synced" rather
 * than throwing: the built-in table still prices what it knows, and an
 * unreadable cache must never be the reason the usage dashboard won't render.
 */

import { isTauri } from "@/lib/tauri"
import { fetchModelCatalog, readTextFile, writeTextFile } from "@/lib/tauri/commands"
import {
  extractVendorPrices,
  parseSyncedPrices,
  serializeSyncedPrices,
  syncedPricesPath,
  type SyncedPrices,
} from "@/lib/history/pricing-sync"

/** The cached copy from the last sync, or null. */
export async function loadCachedPrices(home: string): Promise<SyncedPrices | null> {
  if (!isTauri()) return null
  try {
    return parseSyncedPrices(await readTextFile(syncedPricesPath(home)))
  } catch {
    return null
  }
}

/**
 * Fetch the catalog, keep the vendor prices, and cache them. Rejects when the
 * fetch or the catalog fails — the caller keeps whatever it had. A failed
 * cache write does not: the prices were fetched, and using them this session
 * is better than discarding them because the file couldn't be written.
 */
export async function downloadPrices(home: string, now = Date.now()): Promise<SyncedPrices> {
  const prices = extractVendorPrices(JSON.parse(await fetchModelCatalog()), now)
  try {
    await writeTextFile(syncedPricesPath(home), serializeSyncedPrices(prices))
  } catch {
    // Next launch syncs again; nothing else depends on the file existing.
  }
  return prices
}
