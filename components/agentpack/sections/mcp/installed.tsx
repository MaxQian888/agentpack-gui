"use client"

import { useMemo, useState } from "react"
import { Copy, Eye, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useIncremental } from "@/hooks/use-incremental"
import { mcpAddSpecStep, mcpEditStep, mcpRemoveStep } from "@/lib/agentpack/plan"
import { findMcp } from "@/lib/agentpack/registry"
import {
  parseClaudeMcpEntry,
  parseCodexMcpEntry,
  parseOpencodeMcpEntry,
  resolveCatalogSpec,
  type McpSpec,
} from "@/lib/agentpack/merge/mcp"
import { checkSpecHealth } from "@/lib/agentpack/mcp-health"
import { commandOnPath, probeHost, readTextFile } from "@/lib/tauri/commands"
import type { McpTarget } from "@/lib/agentpack/types"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { CapabilityEmpty, CapabilityList, CapabilityRow } from "../capability-list"
import { FilterField, FilterToolbar, MoreFilters, ScopeChip, SearchField } from "../filter-bar"
import { installedRows, MCP_TARGETS, PresenceDots, TargetDot, type McpRow } from "./helpers"
import { CustomServerForm, type CustomFormValue } from "./custom-form"
import { McpDetailDialog } from "./detail-dialog"

type SourceFilter = McpTarget | "all"
type Sort = "name" | "targets"

export function InstalledTab({
  scan,
  refresh,
  onBrowseCatalog,
}: {
  scan: DashboardScan | null
  refresh: () => void
  /** Opens the built-in catalog — the empty state's one next step. */
  onBrowseCatalog?: () => void
}) {
  const t = useT()
  const m = t.mcp
  const paths = useAppStore((s) => s.paths)
  const plan = useAppStore((s) => s.plan)
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

  /** The server's spec: catalog resolution for known ids, on-disk read for custom. */
  const resolveRowSpec = async (row: McpRow): Promise<McpSpec | undefined> => {
    const known = findMcp(row.id)
    if (known) return resolveCatalogSpec(known, plan.mcpKeys[row.id])
    if (!paths) return undefined
    const tg = MCP_TARGETS.find((x) => row.presence[x])
    if (!tg) return undefined
    const path =
      tg === "claude"
        ? paths.claudeConfig
        : tg === "codex"
          ? paths.codexConfig
          : paths.opencodeConfig
    const text = await readTextFile(path).catch(() => "")
    return tg === "claude"
      ? parseClaudeMcpEntry(text, row.id)
      : tg === "codex"
        ? parseCodexMcpEntry(text, row.id)
        : parseOpencodeMcpEntry(text, row.id)
  }

  const testRow = async (row: McpRow) => {
    const spec = await resolveRowSpec(row)
    if (!spec) return
    const res = await checkSpecHealth(spec, { commandOnPath, probeHost })
    const label = titleOf(row.id)
    if (res.status === "ok") toast.success(`${label} · ${m.healthOk}`)
    else toast.error(`${label} · ${m.healthFail}`)
  }

  const copyTo = async (row: McpRow, target: McpTarget) => {
    if (!paths) return
    const spec = await resolveRowSpec(row)
    if (!spec) return
    await run(mcpAddSpecStep(row.id, spec, [target], paths, t))
    toast.success(m.copyDone(m.targets[target]))
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
      {/* The scope chips carry the per-agent counts the summary strip used to
          restate, and their dots are the legend the rows' presence dots read
          against — so the same three facts are stated once, on the control that
          acts on them. */}
      <FilterToolbar
        scope={SOURCES.map((s) => (
          <ScopeChip
            key={s}
            active={source === s}
            onSelect={() => setSource(s)}
            dot={s !== "all" ? <TargetDot target={s} on /> : undefined}
            label={s === "all" ? m.filterAll : m.targets[s]}
            count={s === "all" ? rows.length : counts[s]}
          />
        ))}
      >
        <SearchField value={query} onChange={setQuery} label={m.searchPlaceholder} />
        <MoreFilters
          label={m.filtersLabel}
          resetLabel={m.filtersReset}
          active={sort === "name" ? 0 : 1}
          onReset={() => setSort("name")}
        >
          <FilterField label={m.sortLabel}>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger size="sm" className="w-full" aria-label={m.sortLabel}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{m.sortName}</SelectItem>
                <SelectItem value="targets">{m.sortTargets}</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </MoreFilters>
      </FilterToolbar>

      {filtered.length === 0 ? (
        <CapabilityEmpty
          message={rows.length === 0 ? m.empty : m.emptyFiltered}
          action={
            rows.length === 0 && onBrowseCatalog ? (
              <Button variant="outline" size="sm" onClick={onBrowseCatalog}>
                {m.emptyBrowse}
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <CapabilityList label={m.installedListLabel}>
            {filtered.slice(0, visible).map((row) => {
              const present = MCP_TARGETS.filter((tg) => row.presence[tg])
              return (
                <CapabilityRow
                  key={row.id}
                  title={titleOf(row.id)}
                  onOpen={() => setDetailId(row.id)}
                  tags={
                    <>
                      {titleOf(row.id) !== row.id ? (
                        <span className="font-mono [overflow-wrap:anywhere]">{row.id}</span>
                      ) : null}
                      <span>{row.known ? m.bundledBadge : m.customBadge}</span>
                    </>
                  }
                  status={<PresenceDots presence={row.presence} />}
                  actions={
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
                        <DropdownMenuItem onSelect={() => void testRow(row)}>
                          <Play className="size-4" /> {m.test}
                        </DropdownMenuItem>
                        {!row.known ? (
                          <DropdownMenuItem onSelect={() => setDetailId(row.id)}>
                            <Pencil className="size-4" /> {m.edit}
                          </DropdownMenuItem>
                        ) : null}
                        {MCP_TARGETS.filter((tg) => !row.presence[tg]).length > 0 ? (
                          <DropdownMenuSeparator />
                        ) : null}
                        {MCP_TARGETS.filter((tg) => !row.presence[tg]).map((tg) => (
                          <DropdownMenuItem key={tg} onSelect={() => void copyTo(row, tg)}>
                            <Copy className="size-4" /> {m.copyToTarget(m.targets[tg])}
                          </DropdownMenuItem>
                        ))}
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
                  }
                />
              )
            })}
          </CapabilityList>
          {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
        </>
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
