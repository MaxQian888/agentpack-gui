"use client"

import { useMemo, useState } from "react"
import { Eye, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { mcpEditStep, mcpRemoveStep } from "@/lib/agentpack/plan"
import type { McpTarget } from "@/lib/agentpack/types"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { installedRows, MCP_TARGETS, TargetDot, type McpRow } from "./helpers"
import { CustomServerForm, type CustomFormValue } from "./custom-form"
import { McpDetailDialog } from "./detail-dialog"

type SourceFilter = McpTarget | "all"
type Sort = "name" | "targets"

export function InstalledTab({
  scan,
  refresh,
}: {
  scan: DashboardScan | null
  refresh: () => void
}) {
  const t = useT()
  const m = t.mcp
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

  const [query, setQuery] = useState("")
  const [source, setSource] = useState<SourceFilter>("all")
  const [sort, setSort] = useState<Sort>("name")
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState<CustomFormValue | null>(null)
  const [confirm, setConfirm] = useState<{ row: McpRow; target: McpTarget } | null>(null)

  const rows = useMemo(() => installedRows(scan), [scan])
  const counts = useMemo(() => {
    const c: Record<McpTarget, number> = { claude: 0, codex: 0, opencode: 0 }
    for (const r of rows) for (const tg of MCP_TARGETS) if (r.presence[tg]) c[tg]++
    return c
  }, [rows])

  const titleOf = (id: string) => t.catalog.mcp[id]?.title ?? id

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (source !== "all" && !r.presence[source]) return false
      if (q && !`${r.id} ${titleOf(r.id)}`.toLowerCase().includes(q)) return false
      return true
    })
    out.sort((a, b) =>
      sort === "name"
        ? titleOf(a.id).localeCompare(titleOf(b.id))
        : MCP_TARGETS.filter((tg) => b.presence[tg]).length -
          MCP_TARGETS.filter((tg) => a.presence[tg]).length
    )
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, source, sort])

  const { visible, sentinelRef, hasMore } = useIncremental(
    filtered.length,
    `${source}|${query}|${sort}`,
    50
  )

  const removeOne = async (id: string, target: McpTarget) => {
    if (!paths) return
    await run(mcpRemoveStep(id, [target], paths, t))
    refresh()
  }

  const saveEdit = async ({ id, spec, targets }: CustomFormValue) => {
    if (!paths) return
    const present = MCP_TARGETS.filter(
      (tg) => scan && installedRows(scan).find((r) => r.id === id)?.presence[tg]
    )
    const removed = present.filter((tg) => !targets.includes(tg))
    await run([
      ...mcpEditStep(id, spec, targets, paths, t),
      ...mcpRemoveStep(id, removed, paths, t),
    ])
    setEditing(null)
    refresh()
  }

  const SOURCES: SourceFilter[] = ["all", ...MCP_TARGETS]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
              source === s
                ? "border-primary bg-primary/10 font-medium"
                : "text-muted-foreground hover:bg-accent/40"
            )}
          >
            {s !== "all" ? <TargetDot target={s} on /> : null}
            {s === "all" ? m.filterAll : m.targets[s]}
            <span className="text-muted-foreground">{s === "all" ? rows.length : counts[s]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={m.searchPlaceholder}
              className="w-56 pl-8"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{m.sortName}</SelectItem>
              <SelectItem value="targets">{m.sortTargets}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? m.empty : m.emptyFiltered}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.slice(0, visible).map((row) => {
            const present = MCP_TARGETS.filter((tg) => row.presence[tg])
            return (
              <Card key={row.id} className="gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setDetailId(row.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="font-medium">{titleOf(row.id)}</span>
                    {titleOf(row.id) !== row.id ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{row.id}</span>
                    ) : null}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={m.actions}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDetailId(row.id)}>
                        <Eye className="size-4" /> {m.view}
                      </DropdownMenuItem>
                      {!row.known ? (
                        <DropdownMenuItem onSelect={() => setDetailId(row.id)}>
                          <Pencil className="size-4" /> {m.edit}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      {present.map((tg) => (
                        <DropdownMenuItem
                          key={tg}
                          variant="destructive"
                          onSelect={() => setConfirm({ row, target: tg })}
                        >
                          <Trash2 className="size-4" /> {m.removeFromTarget(m.targets[tg])}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {present.map((tg) => (
                    <Badge key={tg} variant="outline" className="gap-1.5 font-normal">
                      <TargetDot target={tg} on />
                      {m.targets[tg]}
                    </Badge>
                  ))}
                  <Badge variant="secondary" className="font-normal">
                    {row.known ? m.bundledBadge : m.customBadge}
                  </Badge>
                </div>
              </Card>
            )
          })}
          {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
        </div>
      )}

      <McpDetailDialog
        id={detailId}
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
        scan={scan}
        refresh={refresh}
        onEdit={(initial) => setEditing(initial)}
      />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? m.editTitle(editing.id) : ""}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <CustomServerForm
              mode="edit"
              initial={editing}
              takenIds={new Set()}
              onSubmit={(v) => void saveEdit(v)}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm ? m.removeConfirmTitle(titleOf(confirm.row.id)) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? m.removeConfirmBody(m.targets[confirm.target]) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) void removeOne(confirm.row.id, confirm.target)
                setConfirm(null)
              }}
            >
              {m.confirmRemove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
