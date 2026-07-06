"use client"

import { useEffect, useRef, useState } from "react"

export interface Incremental {
  /** How many items to render right now (never exceeds `total`). */
  visible: number
  /** Attach to a sentinel <div> after the rendered slice; scrolling it into view grows the window. */
  sentinelRef: React.RefObject<HTMLDivElement | null>
  /** Whether more items remain beyond the current window. */
  hasMore: boolean
}

/**
 * Windowed rendering for long lists — render `step` items, then grow the window
 * by `step` whenever the sentinel scrolls near the viewport (via
 * IntersectionObserver, clipped by the nearest scroll container). Keeps opening a
 * thousand-message transcript or a huge session list from parsing/laying out
 * everything up front and blocking the main thread.
 *
 * `resetKey` snaps the window back to `step` when it changes (a new filter, a
 * different session) using a set-state-during-render — the blessed React pattern
 * for "reset state when a prop changes", not an effect.
 */
export function useIncremental(total: number, resetKey: unknown, step = 40): Incremental {
  const [count, setCount] = useState(step)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Reset the window when `resetKey` changes, via the React "adjust state during
  // render" pattern (a previous-value state, not a ref — cheaper than an effect
  // and it re-renders immediately with the reset window).
  const [prevKey, setPrevKey] = useState(resetKey)
  if (prevKey !== resetKey) {
    setPrevKey(resetKey)
    setCount(step)
  }

  const visible = Math.min(count, total)
  const hasMore = visible < total

  useEffect(() => {
    if (visible >= total) return
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    // Re-created each time `visible` grows so it re-evaluates immediately and can
    // load several steps in a row while the sentinel stays within the margin.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => c + step)
      },
      { rootMargin: "800px 0px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, total, step])

  return { visible, sentinelRef, hasMore }
}
