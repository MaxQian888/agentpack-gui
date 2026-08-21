"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { ChevronRight, X } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { historyGetSession } from "@/lib/tauri/commands"
import {
  HISTORY_SOURCES,
  type HistorySource,
  type SessionDetail,
  type SessionSummary,
} from "@/lib/history/types"
import { dayKey, formatCost, formatTokens } from "@/lib/history/format"
import { matchesQuery, sessionCost } from "@/lib/history/stats"
import { SOURCE_COLORS } from "@/lib/history/display"
import { detailCacheKey, getCachedDetail, setCachedDetail } from "@/lib/history/detail-cache"
import { useIncremental } from "@/hooks/use-incremental"
import { Transcript } from "./transcript"
import { FilterField, FilterToolbar, MoreFilters, ScopeChip, SearchField } from "../filter-bar"

type SortKey = "recent" | "tokens" | "messages"

function SourceDot({ source }: { source: HistorySource }) {
  return (
    <span
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: SOURCE_COLORS[source] }}
      aria-hidden
    />
  )
}

/**
 * One session, as a row in a ruled list rather than its own bordered card.
 *
 * A few hundred sessions used to render as a few hundred separate boxes with a
 * gap between each — the stacked-tile shape design.md rules out, and at this
 * length it also costs a hairline plus 8px of air per session for no grouping
 * the eye actually uses. One panel, one rule between rows, reads as a list.
 *
 * The meta line is prose (what tool, which project, which model, how many
 * messages); the machine's numbers sit right-aligned in mono so the column
 * scans vertically. Tokens keep their unit word — a bare "1.2M" next to a bare
 * "$3.40" is two unlabelled figures, which is exactly what a newcomer can't
 * read.
 */
function SessionRow({
  session,
  subagentCount,
  onOpen,
}: {
  session: SessionSummary
  subagentCount: number
  onOpen: () => void
}) {
  const t = useT().history
  const cost = sessionCost(session)
  const meta = [
    t.sources[session.source] ?? session.source,
    session.projectName,
    session.model || null,
    t.messages(session.messageCount),
    session.updatedAt > 0 ? format(new Date(session.updatedAt), "yyyy-MM-dd HH:mm") : null,
  ].filter(Boolean) as string[]

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={session.title}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 border-b px-4 py-3 text-left last:border-b-0",
        "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out) hover:bg-muted",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      )}
    >
      <SourceDot source={session.source} />
      <span className="min-w-0 flex-1">
        {/* The title owns its whole line. The sub-agent badge used to sit beside
            it and, being `shrink-0`, ate ~100px of a 375px row — enough to
            truncate the title to four words on the one screen width where the
            title is all you have room for. It rides the meta line instead. */}
        <span className="block truncate font-medium">{session.title}</span>
        {/* One line that clips, not a wrapping bag of chips. Five meta items
            that wrap turn a 56px row into a 200px one the moment the window is
            phone-width — and a list whose row height depends on the viewport is
            unscannable. Clipped detail is one tap away in the transcript; the
            middots are safe here precisely because this never wraps. */}
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{meta.join(" · ")}</span>
          {subagentCount > 0 ? (
            // Dropped below `sm`: at phone width the badge is wider than what
            // is left of the meta line, and it says the least of the two — the
            // sub-agent runs are listed in the transcript this row opens.
            <span className="hidden shrink-0 rounded-(--hm-radius-dot) border px-1.5 py-0.5 text-2xs text-muted-foreground sm:inline-flex">
              {t.subagents(subagentCount)}
            </span>
          ) : null}
        </span>
      </span>
      {/* Never hidden on narrow: what a session cost is half of why this page
          exists, and a column that disappears below `sm` takes it with it. */}
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span className="font-mono text-xs tabular-nums">
          {t.rowTokens(formatTokens(session.usage.total))}
        </span>
        {cost.value > 0 ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {cost.estimated ? t.rowCostEst(formatCost(cost.value)) : formatCost(cost.value)}
          </span>
        ) : null}
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

/**
 * Fetches and renders one transcript. Mounted with a `key` per session so
 * switching sessions gives a fresh instance. A previously-viewed transcript is
 * served straight from the LRU cache (lazy initial state, no spinner flash); the
 * effect only hits Rust on a cache miss and stores the result for next time.
 */
function TranscriptBody({ session }: { session: SessionSummary }) {
  const t = useT().history
  const key = detailCacheKey(session.source, session.path, session.updatedAt)
  const [detail, setDetail] = useState<SessionDetail | null>(() => getCachedDetail(key) ?? null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (getCachedDetail(key)) return
    let cancelled = false
    historyGetSession(session.source, session.path)
      .then((d) => {
        setCachedDetail(key, d)
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [session, key])

  if (error) {
    return <p className="p-10 text-center text-sm text-muted-foreground">{t.loadFailed}</p>
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {t.loading}
      </div>
    )
  }
  return <Transcript detail={detail} />
}

function TranscriptDialog({
  session,
  subagents,
  onClose,
}: {
  session: SessionSummary | null
  subagents: SessionSummary[]
  onClose: () => void
}) {
  const t = useT().history
  // Which transcript the dialog shows: the parent session, or one of its
  // sub-agent runs. Held as a path and resolved against the *current* session's
  // sub-agents, so opening a different session falls back to its parent without
  // needing an effect to reset it.
  const [viewingPath, setViewingPath] = useState<string | null>(null)
  const viewing = subagents.find((s) => s.path === viewingPath) ?? null
  const shown = viewing ?? session

  const cost = shown ? sessionCost(shown) : null
  const meta = shown
    ? [
        t.sources[shown.source] ?? shown.source,
        shown.projectName,
        shown.model || t.noModel,
        `${formatTokens(shown.usage.total)} ${t.tokensLabel}`,
        ...(cost && cost.value > 0
          ? [
              `${cost.estimated ? "~" : ""}${formatCost(cost.value)}${cost.estimated ? ` (${t.estBadge})` : ""}`,
            ]
          : []),
      ].join("  ·  ")
    : ""

  return (
    <Dialog open={!!session} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b p-4 text-left">
          <DialogTitle className="flex items-center gap-2 truncate pr-6">
            {shown ? <SourceDot source={shown.source} /> : null}
            <span className="truncate">{shown?.title}</span>
          </DialogTitle>
          <DialogDescription className="truncate">{meta}</DialogDescription>
        </DialogHeader>
        {/* A session's sub-agent runs are separate transcripts on disk; surface
            them here rather than as peers in the list, which is where they'd
            otherwise bury the real sessions. */}
        {subagents.length > 0 && session ? (
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-2">
            <button
              type="button"
              onClick={() => setViewingPath(null)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                viewing === null
                  ? "border-primary bg-primary/10 font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {t.subagentParent}
            </button>
            {subagents.map((sub) => (
              <button
                key={sub.path}
                type="button"
                onClick={() => setViewingPath(sub.path)}
                className={cn(
                  "max-w-[16rem] truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  viewing?.path === sub.path
                    ? "border-primary bg-primary/10 font-medium"
                    : "text-muted-foreground hover:bg-accent/50"
                )}
              >
                {sub.agentName ?? sub.title}
              </button>
            ))}
          </div>
        ) : null}
        {/* Plain native scroll — Radix ScrollArea wraps content in a
            display:table element that widens to its widest child, overflowing
            the dialog. overflow-x-hidden keeps wide code blocks scrolling inside
            their own <pre> instead of stretching the layout. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {shown ? <TranscriptBody key={`${shown.source}:${shown.path}`} session={shown} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A drill-down request from the usage dashboard: "show me the sessions behind
 * this bar". `nonce` is what makes re-clicking the same bar work — the props are
 * otherwise identical, so without it the second click would change nothing.
 */
export interface BrowserFocus {
  /** Seeds the search box; matches title / project / cwd / model. */
  query?: string
  source?: HistorySource | "all"
  /** Restrict to sessions last active on this local day (`YYYY-MM-DD`). */
  day?: string
  nonce: number
}

export function SessionBrowser({
  sessions,
  focus,
}: {
  sessions: SessionSummary[]
  focus?: BrowserFocus
}) {
  const t = useT().history
  const [source, setSource] = useState<HistorySource | "all">("all")
  const [query, setQuery] = useState("")
  const [day, setDay] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>("recent")
  const [selected, setSelected] = useState<SessionSummary | null>(null)

  // Apply an incoming drill-down by adjusting state during render (React's
  // "changed a prop, reset some state" pattern) rather than in an effect, which
  // would render the stale filters first and then immediately re-render.
  // Keyed on the nonce so clicking the same chart element twice re-applies it,
  // and so editing the filters by hand afterwards isn't undone.
  // Starts `undefined`, not at the incoming nonce: switching tabs unmounts this
  // subtree, so a drill-down arrives on a *fresh* mount and must still apply.
  const [appliedNonce, setAppliedNonce] = useState<number | undefined>(undefined)
  if (focus && focus.nonce !== appliedNonce) {
    setAppliedNonce(focus.nonce)
    setQuery(focus.query ?? "")
    setSource(focus.source ?? "all")
    setDay(focus.day ?? null)
  }

  // Sub-agent runs are separate transcripts on disk but belong to the session
  // that spawned them — listing them as peers buries the real sessions (they
  // outnumber them). Nest them instead, keeping orphans (parent file gone)
  // visible at top level so nothing silently disappears.
  //
  // Codex agents spawn their own agents, so the chain can run several deep.
  // Every descendant is attached to the *root* ancestor rather than its
  // immediate parent: only top-level sessions get a card, so anything grouped
  // under a nested parent would have no card to appear on.
  const { roots, subagentsByParent } = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]))
    const byParent = new Map<string, SessionSummary[]>()
    const tops: SessionSummary[] = []
    for (const s of sessions) {
      let root = s
      const seen = new Set([s.id])
      while (root.parentId) {
        const parent = byId.get(root.parentId)
        if (!parent || seen.has(parent.id)) break // orphan, or a cycle on disk
        seen.add(parent.id)
        root = parent
      }
      if (root === s) {
        tops.push(s)
        continue
      }
      const group = byParent.get(root.id)
      if (group) group.push(s)
      else byParent.set(root.id, [s])
    }
    return { roots: tops, subagentsByParent: byParent }
  }, [sessions])

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: roots.length }
    for (const s of roots) map[s.source] = (map[s.source] ?? 0) + 1
    return map
  }, [roots])

  const filtered = useMemo(() => {
    const list = roots.filter(
      (s) =>
        (source === "all" || s.source === source) &&
        (day === null || dayKey(s.updatedAt) === day) &&
        matchesQuery(s, query)
    )
    const sorted = [...list]
    if (sort === "tokens") sorted.sort((a, b) => b.usage.total - a.usage.total)
    else if (sort === "messages") sorted.sort((a, b) => b.messageCount - a.messageCount)
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    return sorted
  }, [roots, source, query, day, sort])

  // Render the list in windows so a few thousand sessions don't all mount at
  // once. Window resets whenever the filter/sort changes.
  const { visible, sentinelRef, hasMore } = useIncremental(
    filtered.length,
    `${source}|${query}|${day}|${sort}`,
    50
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Two tiers, same vocabulary as the MCP and skills managers: the chips
          that say "which tool" stay out in the open and double as the colour
          legend for the rows, and sort — a refinement of a list you can already
          read — folds behind one button that says when it is non-default. */}
      <FilterToolbar
        scope={
          <>
            {(["all", ...HISTORY_SOURCES] as const).map((key) => (
              <ScopeChip
                key={key}
                active={source === key}
                onSelect={() => setSource(key)}
                dot={key !== "all" ? <SourceDot source={key} /> : undefined}
                label={key === "all" ? t.sourceAll : (t.sources[key] ?? key)}
                count={counts[key] ?? 0}
              />
            ))}
            {/* The day filter arrives from a chart click, so it has to be
                visible and self-cancelling — a hidden one would leave the list
                inexplicably short after switching tabs. */}
            {day !== null ? (
              <button
                type="button"
                onClick={() => setDay(null)}
                aria-label={t.clearDay}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs",
                  "border-[var(--hm-accent)] bg-[var(--hm-accent-soft)] font-medium text-[var(--hm-ink)]",
                  "transition-colors duration-(--hm-dur-fast) ease-(--hm-ease-out)",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                )}
              >
                {t.dayFilter(day)}
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </>
        }
      >
        <SearchField value={query} onChange={setQuery} label={t.searchPlaceholder} />
        <MoreFilters
          label={t.filtersLabel}
          resetLabel={t.filtersReset}
          active={sort === "recent" ? 0 : 1}
          onReset={() => setSort("recent")}
        >
          <FilterField label={t.sortLabel}>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-full" aria-label={t.sortLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t.sortRecent}</SelectItem>
                <SelectItem value="tokens">{t.sortTokens}</SelectItem>
                <SelectItem value="messages">{t.sortMessages}</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </MoreFilters>
      </FilterToolbar>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">{sessions.length === 0 ? t.empty : t.emptyFiltered}</p>
          {sessions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{t.emptyHint}</p>
          ) : null}
        </div>
      ) : (
        <>
          {/* How much of the history the toolbar above is currently showing.
              Without it a filtered list of 12 looks identical to a machine that
              only ever had 12 sessions. */}
          <p className="text-xs text-muted-foreground">
            {t.listCount(filtered.length, roots.length)}
          </p>
          <div
            role="list"
            aria-label={t.listPanel}
            className="min-w-0 overflow-hidden rounded-lg border"
          >
            {filtered.slice(0, visible).map((s) => (
              <SessionRow
                key={`${s.source}:${s.id}`}
                session={s}
                subagentCount={subagentsByParent.get(s.id)?.length ?? 0}
                onOpen={() => setSelected(s)}
              />
            ))}
            {hasMore ? <div ref={sentinelRef} className="h-1" aria-hidden /> : null}
          </div>
        </>
      )}

      <TranscriptDialog
        session={selected}
        subagents={selected ? (subagentsByParent.get(selected.id) ?? []) : []}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
