"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
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
import { formatCost, formatTokens } from "@/lib/history/format"
import { matchesQuery, sessionCost } from "@/lib/history/stats"
import { SOURCE_COLORS } from "@/lib/history/display"
import { detailCacheKey, getCachedDetail, setCachedDetail } from "@/lib/history/detail-cache"
import { useIncremental } from "@/hooks/use-incremental"
import { Transcript } from "./transcript"

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

function SessionCard({ session, onOpen }: { session: SessionSummary; onOpen: () => void }) {
  const t = useT().history
  const cost = sessionCost(session)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
    >
      <div className="flex items-center gap-2">
        <SourceDot source={session.source} />
        <span className="min-w-0 flex-1 truncate font-medium">{session.title}</span>
        {session.updatedAt > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(new Date(session.updatedAt), "yyyy-MM-dd HH:mm")}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t.sources[session.source] ?? session.source}</span>
        <span className="max-w-[14rem] truncate">{session.projectName}</span>
        {session.model ? <span className="max-w-[12rem] truncate">{session.model}</span> : null}
        <span>{t.messages(session.messageCount)}</span>
        <span className="font-medium text-foreground/80">
          {formatTokens(session.usage.total)} {t.tokensLabel}
        </span>
        {cost.value > 0 ? (
          <span>
            {cost.estimated ? "~" : ""}
            {formatCost(cost.value)}
          </span>
        ) : null}
      </div>
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
  onClose,
}: {
  session: SessionSummary | null
  onClose: () => void
}) {
  const t = useT().history

  const cost = session ? sessionCost(session) : null
  const meta = session
    ? [
        t.sources[session.source] ?? session.source,
        session.projectName,
        session.model || t.noModel,
        `${formatTokens(session.usage.total)} ${t.tokensLabel}`,
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
            {session ? <SourceDot source={session.source} /> : null}
            <span className="truncate">{session?.title}</span>
          </DialogTitle>
          <DialogDescription className="truncate">{meta}</DialogDescription>
        </DialogHeader>
        {/* Plain native scroll — Radix ScrollArea wraps content in a
            display:table element that widens to its widest child, overflowing
            the dialog. overflow-x-hidden keeps wide code blocks scrolling inside
            their own <pre> instead of stretching the layout. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {session ? (
            <TranscriptBody key={`${session.source}:${session.id}`} session={session} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SessionBrowser({ sessions }: { sessions: SessionSummary[] }) {
  const t = useT().history
  const [source, setSource] = useState<HistorySource | "all">("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("recent")
  const [selected, setSelected] = useState<SessionSummary | null>(null)

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: sessions.length }
    for (const s of sessions) map[s.source] = (map[s.source] ?? 0) + 1
    return map
  }, [sessions])

  const filtered = useMemo(() => {
    const list = sessions.filter(
      (s) => (source === "all" || s.source === source) && matchesQuery(s, query)
    )
    const sorted = [...list]
    if (sort === "tokens") sorted.sort((a, b) => b.usage.total - a.usage.total)
    else if (sort === "messages") sorted.sort((a, b) => b.messageCount - a.messageCount)
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    return sorted
  }, [sessions, source, query, sort])

  // Render the list in windows so a few thousand sessions don't all mount at
  // once. Window resets whenever the filter/sort changes.
  const { visible, sentinelRef, hasMore } = useIncremental(
    filtered.length,
    `${source}|${query}|${sort}`,
    50
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...HISTORY_SOURCES] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSource(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                source === key
                  ? "border-primary bg-primary/10 font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {key !== "all" ? <SourceDot source={key} /> : null}
              {key === "all" ? t.sourceAll : (t.sources[key] ?? key)}
              <span className="text-xs text-muted-foreground">{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-56 pl-8"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-32" aria-label={t.sortLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{t.sortRecent}</SelectItem>
              <SelectItem value="tokens">{t.sortTokens}</SelectItem>
              <SelectItem value="messages">{t.sortMessages}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">{sessions.length === 0 ? t.empty : t.emptyFiltered}</p>
          {sessions.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{t.emptyHint}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.slice(0, visible).map((s) => (
            <SessionCard key={`${s.source}:${s.id}`} session={s} onOpen={() => setSelected(s)} />
          ))}
          {hasMore ? <div ref={sentinelRef} className="h-1" aria-hidden /> : null}
        </div>
      )}

      <TranscriptDialog session={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
