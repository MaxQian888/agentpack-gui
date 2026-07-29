/**
 * Five-hour billing windows — the unit Claude Code actually rate-limits on.
 *
 * A window ("block") opens with your first message and lasts five hours; a new
 * one opens when a message arrives more than five hours after the current
 * block's start, **or** after more than five hours of silence. Block starts are
 * floored to the hour so the boundaries are stable, and blocks are cut across
 * the whole flattened event stream rather than per session, because the limit
 * is per account, not per conversation.
 *
 * This mirrors ccusage's `identify_session_blocks`. Where it differs on purpose:
 * flooring uses the **local** hour rather than UTC, which agrees with ccusage
 * everywhere outside the half-hour time zones and matches how the rest of this
 * dashboard buckets time.
 *
 * Deliberately *not* modelled: "percent of your plan used". The published limits
 * are denominated in prompts and compute hours rather than tokens, they doubled
 * on 2026-05-06, and the quota is shared with claude.ai and Cowork — which local
 * transcripts can't see. `p90Tokens` gives a reference line drawn from your own
 * history instead, which is honest about what the data supports.
 */
import type { TokenUsage } from "./types"
import { addUsage, emptyUsage } from "./format"
import { percentile } from "./stats"

export const BLOCK_HOURS = 5
const HOUR_MS = 3_600_000
export const BLOCK_MS = BLOCK_HOURS * HOUR_MS

/** One usage record on the flattened, account-wide timeline. */
export interface TimelineEntry {
  ts: number
  model: string
  usage: TokenUsage
  /** 0 when `unpriced` — a placeholder, not a measured zero. */
  cost: number
  /** The model has no known rate, so this entry's spend is unknown. */
  unpriced: boolean
}

export interface UsageBlock {
  /** Local-hour-floored window start. */
  start: number
  /** `start + 5h` — when the window lapses, not when activity stopped. */
  end: number
  /** First and last activity actually seen inside the window. */
  firstActivity: number
  lastActivity: number
  usage: TokenUsage
  /**
   * Summed spend over the entries we could price. When `unpricedEntries > 0`
   * this is a lower bound, not the window's real cost.
   */
  cost: number
  entries: number
  /** Entries whose model has no known rate — absent from `cost`. */
  unpricedEntries: number
  models: string[]
  /** True while `now` still falls inside the window. */
  active: boolean
}

/** Floor an instant to the start of its local hour. */
export function floorToHour(ts: number): number {
  const d = new Date(ts)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

/**
 * Cut a time-ordered timeline into five-hour blocks. Input need not be sorted —
 * it is sorted here, since callers assemble it from several sessions.
 */
export function identifyBlocks(timeline: TimelineEntry[], now = Date.now()): UsageBlock[] {
  const sorted = [...timeline].sort((a, b) => a.ts - b.ts)
  const blocks: UsageBlock[] = []
  let current: UsageBlock | null = null
  let lastTs = 0

  for (const e of sorted) {
    // Inlined rather than hoisted into a `startsNew` boolean: TypeScript only
    // narrows `current` through the condition itself, not through an alias of
    // it that a `let` reassignment could invalidate.
    if (current === null || e.ts - current.start >= BLOCK_MS || e.ts - lastTs >= BLOCK_MS) {
      const start = floorToHour(e.ts)
      current = {
        start,
        end: start + BLOCK_MS,
        firstActivity: e.ts,
        lastActivity: e.ts,
        usage: emptyUsage(),
        cost: 0,
        entries: 0,
        unpricedEntries: 0,
        models: [],
        active: false,
      }
      blocks.push(current)
    }
    const block = current
    addUsage(block.usage, e.usage)
    block.cost += e.cost
    block.entries += 1
    if (e.unpriced) block.unpricedEntries += 1
    block.lastActivity = e.ts
    if (e.model && !block.models.includes(e.model)) block.models.push(e.model)
    lastTs = e.ts
  }

  for (const b of blocks) b.active = now >= b.start && now < b.end
  return blocks
}

/**
 * Consumption rate of a block, measured from its first *activity* rather than
 * its floored start — otherwise the up-to-59 minutes the flooring invents would
 * silently deflate the rate.
 *
 * `null` for a block with no elapsed time yet (a single instantaneous entry),
 * where a rate would be a division by zero dressed up as data.
 */
export interface BurnRate {
  tokensPerMinute: number
  costPerHour: number
  elapsedMs: number
}

export function burnRate(block: UsageBlock, now = Date.now()): BurnRate | null {
  const until = block.active ? Math.min(now, block.end) : block.lastActivity
  const elapsedMs = until - block.firstActivity
  if (elapsedMs <= 0) return null
  const minutes = elapsedMs / 60_000
  return {
    tokensPerMinute: block.usage.total / minutes,
    costPerHour: (block.cost / minutes) * 60,
    elapsedMs,
  }
}

export interface BlockProjection {
  /** Tokens the block would end on if the current rate held to its close. */
  totalTokens: number
  totalCost: number
  remainingMs: number
}

/** Extrapolate an active block to its close. `null` for a finished block. */
export function projectBlock(block: UsageBlock, now = Date.now()): BlockProjection | null {
  if (!block.active) return null
  const rate = burnRate(block, now)
  const remainingMs = Math.max(0, block.end - now)
  if (!rate) return { totalTokens: block.usage.total, totalCost: block.cost, remainingMs }
  const remainingMinutes = remainingMs / 60_000
  return {
    totalTokens: block.usage.total + rate.tokensPerMinute * remainingMinutes,
    totalCost: block.cost + (rate.costPerHour / 60) * remainingMinutes,
    remainingMs,
  }
}

/**
 * 90th-percentile token total across completed blocks — the reference line the
 * active block is compared against. Uses nearest-rank on the sorted totals, so
 * it is a value that actually occurred rather than an interpolation.
 *
 * Returns 0 with fewer than five completed blocks: a percentile over three
 * samples is noise, and a reference line drawn from noise is worse than none.
 */
export function p90BlockTokens(blocks: UsageBlock[]): number {
  const finished = blocks.filter((b) => !b.active).map((b) => b.usage.total)
  if (finished.length < 5) return 0
  return percentile(finished, 0.9)
}
