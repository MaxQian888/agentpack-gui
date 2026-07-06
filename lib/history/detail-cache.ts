/**
 * In-memory cache for fully-loaded session transcripts. Reading a transcript
 * means parsing a whole JSONL file or a SQLite session in Rust, so reopening the
 * same session (or flipping back to one just viewed) should not pay that cost
 * again. Bounded LRU — transcripts can be large, so we keep only the most
 * recently viewed handful.
 *
 * The key folds in the session's `updatedAt`, so a session that grew on disk
 * (new `updatedAt` from a rescan) naturally misses its stale entry and refetches,
 * while unchanged sessions stay warm across a Rescan — no blanket clear needed.
 */
import type { SessionDetail } from "./types"

const MAX_ENTRIES = 24

// Map preserves insertion order, so the first key is the least-recently used.
const cache = new Map<string, SessionDetail>()

/**
 * Stable cache key for a session. The `path` handle is unique per source, and
 * `updatedAt` (epoch ms of the last activity) invalidates the entry whenever the
 * underlying transcript changes.
 */
export function detailCacheKey(source: string, path: string, updatedAt: number): string {
  return `${source}:${path}:${updatedAt}`
}

/** Return the cached transcript, marking it most-recently used, or undefined. */
export function getCachedDetail(key: string): SessionDetail | undefined {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

/** Store a transcript, evicting the least-recently used entry past the cap. */
export function setCachedDetail(key: string, detail: SessionDetail): void {
  cache.delete(key)
  cache.set(key, detail)
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/** Drop everything — call when the underlying sessions are re-scanned. */
export function clearDetailCache(): void {
  cache.clear()
}
