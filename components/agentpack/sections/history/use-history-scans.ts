"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { isTauri } from "@/lib/tauri"
import { historyListSessions, historyUsageSeries } from "@/lib/tauri/commands"
import {
  WHOLE_SCAN,
  type ListResult,
  type ScanProgress,
  type SourceError,
  type UsageSeriesResult,
} from "@/lib/history/types"

/** A rejected scan, as the one error it is — never as an empty machine. */
function scanFailure(error: unknown): SourceError {
  return { source: WHOLE_SCAN, message: error instanceof Error ? error.message : String(error) }
}

export interface HistoryScans {
  /** The session summaries; null until the startup scan has come back. */
  result: ListResult | null
  /** A manual Rescan is running (the startup scan is signalled by `result === null`). */
  loading: boolean
  /** Streamed while the caches are being rebuilt; null when idle. */
  progress: ScanProgress | null
  /** The per-message series; null until someone asks for it, and again after a Rescan. */
  series: UsageSeriesResult | null
  seriesLoading: boolean
  rescan: () => Promise<void>
  /** Fetch the series; a no-op while one is in flight or already loaded. */
  loadSeries: () => Promise<void>
}

/**
 * The chat-history scans, owned by the shell so returning to History reuses
 * them: the summaries at startup, the per-message series the first time a
 * surface asks for it.
 *
 * Every scan is stamped with the generation it started in, and a Rescan starts
 * a new one. A result from an older generation is dropped rather than applied,
 * because it was read before the files the Rescan was asked to re-read — a slow
 * startup scan landing after a fast Rescan used to put the older reading back.
 */
export function useHistoryScans(): HistoryScans {
  const [result, setResult] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(false)
  // Rebuilding the caches means re-parsing gigabytes of JSONL, so the scan
  // streams how far it has got rather than leaving a bare spinner up.
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  // The per-message series is one to two orders of magnitude larger than the
  // summaries, so it loads only when a surface actually asks.
  const [series, setSeries] = useState<UsageSeriesResult | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)

  const generation = useRef(0)
  // The generation whose series is loaded or in flight. A ref rather than
  // `seriesLoading`: two surfaces asking in the same commit would both read the
  // state before either update landed, and start two full scans.
  const seriesGeneration = useRef<number | null>(null)

  const rescan = useCallback(async () => {
    if (!isTauri()) return
    // No blanket transcript-cache clear on Rescan: transcript keys fold in each
    // session's `updatedAt`, so a session that grew on disk misses its stale
    // entry and refetches, while unchanged sessions stay warm.
    const gen = ++generation.current
    setLoading(true)
    // Drop the series too: it was built from the same files, so keeping it
    // would leave the dashboard showing pre-rescan numbers. Whoever wants it
    // asks again; the new generation makes that request a real one.
    setSeries(null)
    setSeriesLoading(false)
    try {
      const next = await historyListSessions(setProgress)
      if (gen === generation.current) setResult(next)
    } catch (error) {
      if (gen === generation.current) setResult({ sessions: [], errors: [scanFailure(error)] })
    } finally {
      if (gen === generation.current) {
        setLoading(false)
        setProgress(null)
      }
    }
  }, [])

  const loadSeries = useCallback(async () => {
    if (!isTauri() || seriesGeneration.current === generation.current) return
    const gen = generation.current
    seriesGeneration.current = gen
    setSeriesLoading(true)
    try {
      const next = await historyUsageSeries(setProgress)
      if (gen === generation.current) setSeries(next)
    } catch (error) {
      // Recorded, not retried: a non-null series stops the dashboard asking
      // again in a loop, and the error tells the user Rescan is the way back.
      if (gen === generation.current) setSeries({ sessions: [], errors: [scanFailure(error)] })
    } finally {
      if (gen === generation.current) {
        setSeriesLoading(false)
        setProgress(null)
      }
    }
  }, [])

  // Scan chat history once at startup — not gated on opening the History
  // section, because the dashboard's spend card is the first thing rendered and
  // it reads these summaries. Cold that costs ~17s (every JSONL plus the
  // OpenCode DB), so progress streams and the card holds a skeleton until it
  // lands; warm it returns from cache in ~200ms. `result === null` IS the
  // loading signal — state is set only in the async continuation, so no
  // setState runs synchronously inside the effect.
  useEffect(() => {
    if (!isTauri() || result !== null) return
    const gen = generation.current
    let cancelled = false
    const current = () => !cancelled && gen === generation.current
    historyListSessions(setProgress)
      .then((next) => {
        if (current()) setResult(next)
      })
      .catch((error: unknown) => {
        if (current()) setResult({ sessions: [], errors: [scanFailure(error)] })
      })
      .finally(() => {
        if (current()) setProgress(null)
      })
    return () => {
      cancelled = true
    }
  }, [result])

  return { result, loading, progress, series, seriesLoading, rescan, loadSeries }
}
