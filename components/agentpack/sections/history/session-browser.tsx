"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { dayKey, formatCostFigure, formatTokens } from "@/lib/history/format"
import { inRange } from "@/lib/history/range"
import { matchesQuery, projectKey, sessionCost, sessionCostFigure } from "@/lib/history/stats"
import { SOURCE_COLORS } from "@/lib/history/display"
import { detailCacheKey, getCachedDetail, setCachedDetail } from "@/lib/history/detail-cache"
import { branchOptions, messagesForLeaf } from "@/lib/history/tree"
import { useIncremental } from "@/hooks/use-incremental"
import { Transcript } from "./transcript"
import type { UsageDrilldown } from "./usage"
import {
  FilterField,
  FilterToolbar,
  MoreFilters,
  ScopeChip,
  SearchField,
  scopeChipClass,
} from "../filter-bar"

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
    (session.branchCount ?? 1) > 1 ? t.branches(session.branchCount ?? 1) : null,
    session.updatedAt > 0 ? format(new Date(session.updatedAt), "yyyy-MM-dd HH:mm") : null,
  ].filter(Boolean) as string[]

  return (
    // No `aria-label`: it replaced the row's whole content with the title, so a
    // screen reader heard neither the tool, the project nor what it cost.
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left",
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
            {formatCostFigure(sessionCostFigure(session))}
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
  // The reason as the system gave it; null while there is no failure.
  const [error, setError] = useState<string | null>(null)
  // Bumped by Retry: the effect below re-runs on it, and on nothing else new.
  const [attempt, setAttempt] = useState(0)
  const [selectedLeaf, setSelectedLeaf] = useState<string | null>(null)

  useEffect(() => {
    if (getCachedDetail(key)) return
    let cancelled = false
    historyGetSession(session.source, session.path)
      .then((d) => {
        setCachedDetail(key, d)
        if (!cancelled) setDetail(d)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [session, key, attempt])

  if (error !== null) {
    // What failed, why, and the one thing to try — a bare "couldn't load" left
    // closing the dialog and reopening it as the only way to try again.
    return (
      <div role="alert" className="flex flex-col items-center gap-3 p-10 text-center text-sm">
        <p className="text-muted-foreground">{t.loadFailed}</p>
        <p className="font-mono text-xs break-all text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        >
          {t.retry}
        </Button>
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {t.loading}
      </div>
    )
  }
  const options = detail.tree ? branchOptions(detail.tree, t.branchOption) : []
  const activeLeaf = selectedLeaf ?? detail.tree?.activeLeafId
  const selectedDetail =
    detail.tree && activeLeaf
      ? { ...detail, messages: messagesForLeaf(detail.tree, activeLeaf) }
      : detail
  return (
    <div>
      {detail.tree && options.length > 1 ? (
        <div className="border-b bg-muted/30 px-4 py-2">
          <Select value={activeLeaf} onValueChange={setSelectedLeaf}>
            <SelectTrigger className="w-full sm:w-72" aria-label={t.branchView}>
              <SelectValue placeholder={t.branchView} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <Transcript detail={selectedDetail} />
    </div>
  )
}

function TranscriptDialog({
  session,
  subagents,
  viewingPath,
  onView,
  onClose,
}: {
  session: SessionSummary | null
  subagents: SessionSummary[]
  /**
   * Which transcript the dialog shows: the parent session (null), or one of
   * its sub-agent runs. Resolved against the *current* session's sub-agents, so
   * a path that isn't one of them falls back to the parent.
   */
  viewingPath: string | null
  onView: (path: string | null) => void
  onClose: () => void
}) {
  const t = useT().history
  // What had focus when the dialog opened — a session row, or a row in the
  // usage tab's table — so closing can hand it back.
  const opener = useRef<HTMLElement | null>(null)
  const viewing = subagents.find((s) => s.path === viewingPath) ?? null
  const shown = viewing ?? session

  const meta = shown
    ? [
        t.sources[shown.source] ?? shown.source,
        shown.projectName,
        shown.model || t.noModel,
        `${formatTokens(shown.usage.total)} ${t.tokensLabel}`,
        ...(sessionCost(shown).value > 0 ? [formatCostFigure(sessionCostFigure(shown))] : []),
      ].join("  ·  ")
    : ""

  return (
    <Dialog open={!!session} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        // Opened by state rather than a `DialogTrigger`, so Radix had nothing to
        // hand focus back to and it fell to <body> — a keyboard user was sent
        // back to the top of the page after every transcript. Focus hasn't
        // moved into the dialog yet when the open event fires.
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          opener.current?.focus()
        }}
      >
        <DialogHeader className="border-b p-4 text-left">
          <DialogTitle className="flex items-center gap-2 truncate pr-6">
            {shown ? <SourceDot source={shown.source} /> : null}
            <span className="truncate">{shown?.title}</span>
          </DialogTitle>
          <DialogDescription className="truncate">{meta}</DialogDescription>
        </DialogHeader>
        {/* A session's sub-agent runs are separate transcripts on disk; surface
            them here rather than as peers in the list, which is where they'd
            otherwise bury the real sessions. Same chip as the list's source
            filter — it is the same kind of choice: which one to show. */}
        {subagents.length > 0 && session ? (
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-2">
            <button
              type="button"
              aria-pressed={viewing === null}
              onClick={() => onView(null)}
              className={scopeChipClass(viewing === null)}
            >
              {t.subagentParent}
            </button>
            {subagents.map((sub) => (
              <button
                key={sub.path}
                type="button"
                aria-pressed={viewing?.path === sub.path}
                onClick={() => onView(sub.path)}
                className={scopeChipClass(viewing?.path === sub.path, "max-w-[16rem] min-w-0")}
              >
                <span className="truncate">{sub.agentName ?? sub.title}</span>
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
 * A filter the list didn't start with — one that arrived from a chart or table
 * on the usage tab. It has to be visible and self-cancelling: a hidden one
 * would leave the list inexplicably short after switching tabs.
 */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  const t = useT().history
  return (
    <button
      type="button"
      onClick={onClear}
      // Names the action *and* keeps the chip's own text, so a reader hears
      // which filter this removes rather than a bare "Clear".
      aria-label={t.clearFilter(label)}
      className={scopeChipClass(true, "max-w-[18rem] min-w-0")}
    >
      <span className="truncate">{label}</span>
      <X aria-hidden="true" className="size-3.5 shrink-0" />
    </button>
  )
}

/**
 * A drill-down request from the usage dashboard: "show me what's behind this".
 * `nonce` is what makes re-clicking the same bar work — the props are otherwise
 * identical, so without it the second click would change nothing.
 */
export type BrowserFocus = UsageDrilldown & { nonce: number }

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
  const [project, setProject] = useState<string | null>(null)
  const [period, setPeriod] = useState<NonNullable<UsageDrilldown["period"]> | null>(null)
  const [sort, setSort] = useState<SortKey>("recent")
  const [selected, setSelected] = useState<SessionSummary | null>(null)
  // Which of `selected`'s transcripts is open — held here, not in the dialog,
  // so closing resets it and a drill-down can open a sub-agent directly.
  const [viewingPath, setViewingPath] = useState<string | null>(null)

  const open = (s: SessionSummary) => {
    setSelected(s)
    setViewingPath(null)
  }
  const close = () => {
    setSelected(null)
    setViewingPath(null)
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
  //
  // `rootOf` keeps that answer per transcript (keyed `source:path`), which is
  // how a drill-down to a sub-agent finds the card it lives under.
  const { roots, subagentsByParent, rootOf } = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]))
    const byParent = new Map<string, SessionSummary[]>()
    const rootByKey = new Map<string, SessionSummary>()
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
      rootByKey.set(`${s.source}:${s.path}`, root)
      if (root === s) {
        tops.push(s)
        continue
      }
      const group = byParent.get(root.id)
      if (group) group.push(s)
      else byParent.set(root.id, [s])
    }
    return { roots: tops, subagentsByParent: byParent, rootOf: rootByKey }
  }, [sessions])

  // Apply an incoming drill-down by adjusting state during render (React's
  // "changed a prop, reset some state" pattern) rather than in an effect, which
  // would render the stale filters first and then immediately re-render.
  // Keyed on the nonce so clicking the same chart element twice re-applies it,
  // and so editing the filters by hand afterwards isn't undone. This list stays
  // mounted while the usage tab shows, so an applied nonce is never forgotten
  // and a stale drill-down can't re-apply on the way back.
  const [appliedNonce, setAppliedNonce] = useState<number | undefined>(undefined)
  if (focus && focus.nonce !== appliedNonce) {
    setAppliedNonce(focus.nonce)
    if (focus.session) {
      // One transcript: open it, leaving the list as the user had it. A
      // sub-agent opens inside the session that spawned it, its chip selected.
      const key = `${focus.session.source}:${focus.session.path}`
      const root = rootOf.get(key)
      if (root) {
        setSelected(root)
        setViewingPath(`${root.source}:${root.path}` === key ? null : focus.session.path)
      }
    } else {
      setQuery("")
      setSource("all")
      setDay(focus.day ?? null)
      setProject(focus.project ?? null)
      setPeriod(focus.period ?? null)
    }
  }

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
        (project === null || projectKey(s) === project) &&
        (period === null || inRange(s.updatedAt, period.range)) &&
        matchesQuery(s, query)
    )
    const sorted = [...list]
    if (sort === "tokens") sorted.sort((a, b) => b.usage.total - a.usage.total)
    else if (sort === "messages") sorted.sort((a, b) => b.messageCount - a.messageCount)
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    return sorted
  }, [roots, source, query, day, project, period, sort])

  // Render the list in windows so a few thousand sessions don't all mount at
  // once. Window resets whenever the filter/sort changes.
  const { visible, sentinelRef, hasMore } = useIncremental(
    filtered.length,
    `${source}|${query}|${day}|${project}|${period?.label}|${sort}`,
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
            {/* Filters that arrive from the usage tab, each visible and each
                clearing itself. */}
            {day !== null ? (
              <FilterChip label={t.dayFilter(day)} onClear={() => setDay(null)} />
            ) : null}
            {project !== null ? (
              <FilterChip label={t.projectFilter(project)} onClear={() => setProject(null)} />
            ) : null}
            {period !== null ? (
              <FilterChip label={t.periodFilter(period.label)} onClear={() => setPeriod(null)} />
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
            {/* The rule sits on the item, not on the button inside it: the
                button is always its item's last child, so `last:` there would
                match every row. */}
            {filtered.slice(0, visible).map((s) => (
              <div key={`${s.source}:${s.id}`} role="listitem" className="border-b last:border-b-0">
                <SessionRow
                  session={s}
                  subagentCount={subagentsByParent.get(s.id)?.length ?? 0}
                  onOpen={() => open(s)}
                />
              </div>
            ))}
            {hasMore ? <div ref={sentinelRef} className="h-1" aria-hidden /> : null}
          </div>
        </>
      )}

      <TranscriptDialog
        session={selected}
        subagents={selected ? (subagentsByParent.get(selected.id) ?? []) : []}
        viewingPath={viewingPath}
        onView={setViewingPath}
        onClose={close}
      />
    </div>
  )
}
