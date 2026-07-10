"use client"

import { useMemo, useState } from "react"
import { Copy, Eye, MoreHorizontal, Search, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useIncremental } from "@/hooks/use-incremental"
import { skillCopyStep, skillRemoveStep } from "@/lib/agentpack/plan"
import { SKILL_REGISTRY_IDS } from "@/lib/agentpack/scan"
import {
  filterRows,
  groupSkills,
  countsBySource,
  primaryEntry,
  sortRows,
  SKILL_SOURCES,
  type SkillSort,
} from "@/lib/skills/browse"
import type { Paths } from "@/lib/agentpack/types"
import type { SkillRow, SkillSource, SkillsScanResult } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { SkillDetailDialog } from "./skill-detail-dialog"

/** Per-source dot colors (claude/codex/opencode match the history palette). */
export const SKILL_SOURCE_COLORS: Record<SkillSource, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  opencode: "#8b5cf6",
  agents: "#eab308",
}

function SourceDot({ source }: { source: SkillSource }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: SKILL_SOURCE_COLORS[source] }}
    />
  )
}

function skillsDirFor(paths: Paths, source: SkillSource): string {
  switch (source) {
    case "claude":
      return paths.claudeSkillsDir
    case "codex":
      return paths.codexSkillsDir
    case "opencode":
      return paths.opencodeSkillsDir
    case "agents":
      return paths.agentsSkillsDir
  }
}

export function InstalledSkillsTab({
  scan,
  refresh,
}: {
  scan: SkillsScanResult
  refresh: () => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

  const [query, setQuery] = useState("")
  const [source, setSource] = useState<SkillSource | "all">("all")
  const [sort, setSort] = useState<SkillSort>("name")
  const [detail, setDetail] = useState<SkillRow | null>(null)
  const [toDelete, setToDelete] = useState<{ row: SkillRow; source: SkillSource } | null>(null)

  const rows = useMemo(() => groupSkills(scan.skills), [scan])
  const counts = useMemo(() => countsBySource(scan.skills), [scan])
  const filtered = useMemo(
    () => sortRows(filterRows(rows, query, source), sort),
    [rows, query, source, sort]
  )
  const { visible, sentinelRef, hasMore } = useIncremental(
    filtered.length,
    `${source}|${query}|${sort}`,
    50
  )

  const copyTo = async (row: SkillRow, target: SkillSource) => {
    const src = primaryEntry(row)
    if (!src || !paths) return
    const dest = `${skillsDirFor(paths, target)}/${row.dirName}`
    await run([skillCopyStep(row.dirName, row.name, src.path, [target], [dest], t)])
    refresh()
  }

  const deleteFrom = async (row: SkillRow, from: SkillSource) => {
    const entry = row.entries[from]
    if (!entry) return
    await run([skillRemoveStep(row.dirName, row.name, [from], [entry.path], t)])
    refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", ...SKILL_SOURCES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
              source === s ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent/40"
            )}
          >
            {s !== "all" ? <SourceDot source={s} /> : null}
            {s === "all" ? sb.filterAll : sb.sources[s]}
            <span className="text-muted-foreground">{s === "all" ? rows.length : counts[s]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={sb.searchPlaceholder}
              className="w-56 pl-8"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SkillSort)}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{sb.sortName}</SelectItem>
              <SelectItem value="modified">{sb.sortModified}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? sb.empty : sb.emptyFiltered}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.slice(0, visible).map((row) => {
            const present = SKILL_SOURCES.filter((s) => row.entries[s])
            const missing = SKILL_SOURCES.filter((s) => !row.entries[s])
            const anySymlink = present.some((s) => row.entries[s]?.isSymlink)
            return (
              <Card key={row.dirName} className="gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setDetail(row)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="font-medium">{row.name}</span>
                    {row.description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {row.description}
                      </p>
                    ) : null}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={sb.actions}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDetail(row)}>
                        <Eye className="size-4" /> {sb.view}
                      </DropdownMenuItem>
                      {missing.length > 0 ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            {sb.copyTo("…")}
                          </DropdownMenuLabel>
                          {missing.map((target) => (
                            <DropdownMenuItem
                              key={target}
                              onSelect={() => void copyTo(row, target)}
                            >
                              <Copy className="size-4" /> {sb.copyTo(sb.sources[target])}
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : null}
                      <DropdownMenuSeparator />
                      {present.map((from) => (
                        <DropdownMenuItem
                          key={from}
                          variant="destructive"
                          onSelect={() => setToDelete({ row, source: from })}
                        >
                          <Trash2 className="size-4" /> {sb.deleteFrom(sb.sources[from])}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {present.map((s) => (
                    <Badge key={s} variant="outline" className="gap-1.5 font-normal">
                      <SourceDot source={s} />
                      {sb.sources[s]}
                    </Badge>
                  ))}
                  {anySymlink ? (
                    <Badge variant="secondary" className="font-normal">
                      {sb.symlinkBadge}
                    </Badge>
                  ) : null}
                  {SKILL_REGISTRY_IDS.includes(row.dirName) ? (
                    <Badge variant="secondary" className="font-normal">
                      {sb.bundledBadge}
                    </Badge>
                  ) : null}
                  {row.nameMismatch ? (
                    <Badge
                      variant="outline"
                      className="font-normal text-amber-600 dark:text-amber-400"
                    >
                      {sb.nameMismatchBadge(row.name)}
                    </Badge>
                  ) : null}
                </div>
              </Card>
            )
          })}
          {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
        </div>
      )}

      <SkillDetailDialog
        row={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toDelete ? sb.deleteConfirmTitle(toDelete.row.name) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? sb.deleteConfirmBody(toDelete.row.entries[toDelete.source]?.path ?? "")
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{sb.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) void deleteFrom(toDelete.row, toDelete.source)
                setToDelete(null)
              }}
            >
              {sb.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
