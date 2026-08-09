"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  Copy,
  DownloadCloud,
  Eye,
  FileText,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
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
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useIncremental } from "@/hooks/use-incremental"
import { checkRepoUpdates, readTextFile } from "@/lib/tauri/commands"
import { openPath, revealPath } from "@/lib/tauri/system"
import {
  skillBackupStep,
  skillCopyStep,
  skillRemoveStep,
  skillUpdateStep,
} from "@/lib/agentpack/plan"
import {
  parseClaudeSkillOverrides,
  parseOpencodeSkillPermissions,
} from "@/lib/agentpack/merge/skill-config"
import { SKILL_REGISTRY_IDS } from "@/lib/agentpack/scan"
import {
  filterRows,
  groupSkills,
  countsBySource,
  matchRow,
  primaryEntry,
  sortRows,
  SKILL_SOURCES,
  type SkillSort,
} from "@/lib/skills/browse"
import { indexUpdates, isManaged, rowUpdateTargets, updateQueries } from "@/lib/skills/updates"
import { skillDestPath, skillsDirFor } from "@/lib/skills/paths"
import type { SkillRow, SkillSource, SkillsScanResult, SkillUpdateResult } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { SkillDetailDialog } from "./skill-detail-dialog"
import { BackupsDialog } from "./backups-dialog"
import { useInstallGuard } from "./install-conflict-dialog"

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

/** Current per-agent config state, keyed by skill NAME (non-default only matters). */
interface SkillStatus {
  visibility?: string
  permission?: string
}

type SkillStatusFilter = "all" | "managed" | "unmanaged" | "updates" | "issues"

function hasSkillConflict(row: SkillRow): boolean {
  if (row.nameMismatch) return true
  return new Set(Object.values(row.entries).map((entry) => entry.skillMd)).size > 1
}

export function InstalledSkillsTab({
  scan,
  refresh,
  onUpdateCountChange,
}: {
  scan: SkillsScanResult
  refresh: () => void
  onUpdateCountChange?: (count: number) => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const mirrorPrefix = useAppStore((s) => s.settings.ghMirrorPrefix)
  const { run } = useRunnerCtx()
  const { guard, dialog: guardDialog } = useInstallGuard()

  const [query, setQuery] = useState("")
  // Defer the full-text filter so typing stays smooth even when SKILL.md bodies
  // are searched across many skills.
  const deferredQuery = useDeferredValue(query)
  const [source, setSource] = useState<SkillSource | "all">("all")
  const [statusFilter, setStatusFilter] = useState<SkillStatusFilter>("all")
  const [sort, setSort] = useState<SkillSort>("name")
  const [detail, setDetail] = useState<SkillRow | null>(null)
  const [toDelete, setToDelete] = useState<{ row: SkillRow; source: SkillSource } | null>(null)
  const [backupsOpen, setBackupsOpen] = useState(false)
  // Batch selection (by dir name) + the scope its "Delete" acts on.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteScope, setDeleteScope] = useState<"all" | SkillSource>("all")
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)

  const [overrides, setOverrides] = useState<Record<string, SkillStatus>>({})
  const [overridesBump, setOverridesBump] = useState(0)
  const [updates, setUpdates] = useState<Map<string, SkillUpdateResult>>(new Map())
  const [checking, setChecking] = useState(false)

  const rows = useMemo(() => groupSkills(scan.skills), [scan])
  const counts = useMemo(() => countsBySource(scan.skills), [scan])
  const managedRows = useMemo(() => rows.filter(isManaged), [rows])
  const filtered = useMemo(() => {
    const searched = filterRows(rows, deferredQuery, source)
    const statusRows = searched.filter((row) => {
      if (statusFilter === "managed") return isManaged(row)
      if (statusFilter === "unmanaged") return !isManaged(row)
      if (statusFilter === "updates") return rowUpdateTargets(row, updates).length > 0
      if (statusFilter === "issues") return hasSkillConflict(row)
      return true
    })
    return sortRows(statusRows, sort)
  }, [rows, deferredQuery, source, sort, statusFilter, updates])
  const { visible, sentinelRef, hasMore } = useIncremental(
    filtered.length,
    `${source}|${statusFilter}|${deferredQuery}|${sort}`,
    50
  )

  // A rescan can drop skills the user had selected; start each scan clean.
  // Adjust state during render (React's "reset on prop change" pattern) rather
  // than in an effect, which would cascade an extra render.
  const [scanForSelection, setScanForSelection] = useState(scan)
  if (scan !== scanForSelection) {
    setScanForSelection(scan)
    setSelected(new Set())
  }

  // Read the two config files once per scan (and after the detail dialog, which
  // can change them) to show each skill's current enable state inline.
  useEffect(() => {
    if (!paths || !isTauri()) return
    let cancelled = false
    Promise.all([
      readTextFile(paths.claudeSettings).catch(() => ""),
      readTextFile(paths.opencodeConfig).catch(() => ""),
    ]).then(([claude, opencode]) => {
      if (cancelled) return
      const vis = parseClaudeSkillOverrides(claude)
      const perm = parseOpencodeSkillPermissions(opencode)
      const map: Record<string, SkillStatus> = {}
      for (const name of new Set([...Object.keys(vis), ...Object.keys(perm)])) {
        map[name] = { visibility: vis[name], permission: perm[name] }
      }
      setOverrides(map)
    })
    return () => {
      cancelled = true
    }
  }, [paths, scan, overridesBump])

  const updateCount = useMemo(
    () => rows.filter((r) => rowUpdateTargets(r, updates).length > 0).length,
    [rows, updates]
  )

  useEffect(() => {
    onUpdateCountChange?.(updateCount)
  }, [onUpdateCountChange, updateCount])

  const doCheckUpdates = async () => {
    const queries = updateQueries(managedRows)
    if (queries.length === 0) return
    setChecking(true)
    try {
      const results = await checkRepoUpdates(queries, mirrorPrefix)
      setUpdates(indexUpdates(results))
      const n = results.filter((r) => r.hasUpdate).length
      toast[n > 0 ? "success" : "info"](n > 0 ? sb.updatesFound(n) : sb.noUpdates)
    } catch (e) {
      toast.error(sb.checkFailed(String(e)))
    } finally {
      setChecking(false)
    }
  }

  const updateRow = async (row: SkillRow) => {
    if (!paths) return
    const managed = SKILL_SOURCES.filter((s) => row.entries[s]?.origin)
    const first = managed.map((s) => row.entries[s]).find(Boolean)
    if (!first) return
    const dests = managed.map((s) => `${skillsDirFor(paths, s)}/${row.dirName}`)
    await run([skillUpdateStep(row.dirName, first.path, managed, dests, mirrorPrefix, t)])
    // The refreshed hash clears this row's pending flags.
    setUpdates((prev) => {
      const next = new Map(prev)
      for (const s of managed) {
        const e = row.entries[s]
        if (e) next.delete(e.path)
      }
      return next
    })
    refresh()
  }

  const updateAll = async () => {
    if (!paths) return
    const steps = rows
      .filter((r) => rowUpdateTargets(r, updates).length > 0)
      .map((row) => {
        const managed = SKILL_SOURCES.filter((s) => row.entries[s]?.origin)
        const first = managed.map((s) => row.entries[s]).find(Boolean)!
        const dests = managed.map((s) => `${skillsDirFor(paths, s)}/${row.dirName}`)
        return skillUpdateStep(row.dirName, first.path, managed, dests, mirrorPrefix, t)
      })
    if (steps.length === 0) return
    await run(steps)
    setUpdates(new Map())
    refresh()
  }

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
    // Back up first; only delete if the backup succeeded (dependsOn).
    const backup = skillBackupStep(row.dirName, entry.path, t)
    const remove = skillRemoveStep(row.dirName, row.name, [from], [entry.path], t)
    await run([backup, { ...remove, dependsOn: [backup.id] }])
    refresh()
  }

  const toggleSelect = (dirName: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(dirName)) next.delete(dirName)
      else next.add(dirName)
      return next
    })

  const clearSelection = () => setSelected(new Set())
  const selectedRows = () => rows.filter((r) => selected.has(r.dirName))

  // Copy every selected skill into `target`, skipping any whose only copy is
  // already there, and routing existing-skill overwrites through the guard.
  const batchCopy = async (target: SkillSource) => {
    if (!paths) return
    const candidates = selectedRows().filter((r) => {
      const src = primaryEntry(r)
      return src && src.path !== skillDestPath(paths, target, r.dirName)
    })
    if (candidates.length === 0) {
      toast.info(sb.batchNothingToCopy)
      return
    }
    const resolved = await guard(
      candidates.map((r) => ({ dirName: r.dirName, targets: [target] })),
      scan.skills
    )
    if (!resolved || resolved.length === 0) return
    const keep = new Set(resolved.map((r) => r.dirName))
    const steps = candidates
      .filter((r) => keep.has(r.dirName))
      .map((r) =>
        skillCopyStep(
          r.dirName,
          r.name,
          primaryEntry(r)!.path,
          [target],
          [skillDestPath(paths, target, r.dirName)],
          t
        )
      )
    if (steps.length === 0) return
    await run(steps)
    toast.success(sb.batchCopyDone(steps.length))
    clearSelection()
    refresh()
  }

  // Back up then remove each selected skill, within the chosen delete scope.
  const batchDelete = async () => {
    if (!paths) return
    const steps = selectedRows().flatMap((r) => {
      const sources =
        deleteScope === "all"
          ? SKILL_SOURCES.filter((s) => r.entries[s])
          : r.entries[deleteScope]
            ? [deleteScope]
            : []
      if (sources.length === 0) return []
      const dests = sources.map((s) => r.entries[s]!.path)
      const backup = skillBackupStep(r.dirName, r.entries[sources[0]]!.path, t)
      const remove = skillRemoveStep(r.dirName, r.name, sources, dests, t)
      return [backup, { ...remove, dependsOn: [backup.id] }]
    })
    if (steps.length === 0) return
    await run(steps)
    clearSelection()
    refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Update / backups toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void doCheckUpdates()}
          disabled={checking || managedRows.length === 0 || !isTauri()}
        >
          {checking ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
          {checking ? sb.checking : sb.checkUpdates}
        </Button>
        {updateCount > 0 ? (
          <Button size="sm" className="gap-2" onClick={() => void updateAll()}>
            <DownloadCloud className="size-4" />
            {sb.updateAll(updateCount)}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-2"
          onClick={() => setBackupsOpen(true)}
          disabled={!isTauri()}
        >
          {sb.backups}
        </Button>
      </div>

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
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as SkillStatusFilter)}
          >
            <SelectTrigger size="sm" className="w-44" aria-label={sb.statusFilter}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{sb.statusAll}</SelectItem>
              <SelectItem value="managed">{sb.statusManaged}</SelectItem>
              <SelectItem value="unmanaged">{sb.statusUnmanaged}</SelectItem>
              <SelectItem value="updates">{sb.statusUpdates}</SelectItem>
              <SelectItem value="issues">{sb.statusIssues}</SelectItem>
            </SelectContent>
          </Select>
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

      {scan.errors.length > 0 && (statusFilter === "all" || statusFilter === "issues") ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          {scan.errors.map((error) => (
            <p key={error.source} className="text-xs text-destructive">
              {sb.scanError(sb.sources[error.source] ?? error.source, error.message)}
            </p>
          ))}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <span className="text-sm font-medium">{sb.selectedCount(selected.size)}</span>
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            {sb.clearSelection}
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Copy className="size-4" />
                  {sb.batchCopyTo}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SKILL_SOURCES.map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => void batchCopy(s)}>
                    <SourceDot source={s} /> {sb.sources[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Select
              value={deleteScope}
              onValueChange={(v) => setDeleteScope(v as "all" | SkillSource)}
            >
              <SelectTrigger size="sm" className="w-40" aria-label={sb.batchDeleteScope}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{sb.deleteScopeAll}</SelectItem>
                {SKILL_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {sb.sources[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => setBatchDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              {sb.batchDelete}
            </Button>
          </div>
        </div>
      ) : null}

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
            const status = overrides[row.name]
            const hasUpdate = rowUpdateTargets(row, updates).length > 0
            const entryPath = primaryEntry(row)?.path
            return (
              <Card key={row.dirName} className="gap-2 p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    className="mt-1 shrink-0"
                    checked={selected.has(row.dirName)}
                    onCheckedChange={() => toggleSelect(row.dirName)}
                    aria-label={sb.selectRow}
                  />
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
                      {hasUpdate ? (
                        <DropdownMenuItem onSelect={() => void updateRow(row)}>
                          <DownloadCloud className="size-4" /> {sb.update}
                        </DropdownMenuItem>
                      ) : null}
                      {entryPath && isTauri() ? (
                        <>
                          <DropdownMenuItem onSelect={() => void revealPath(entryPath)}>
                            <FolderOpen className="size-4" /> {sb.revealInFolder}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void openPath(`${entryPath}/SKILL.md`)}>
                            <FileText className="size-4" /> {sb.openSkillMd}
                          </DropdownMenuItem>
                        </>
                      ) : null}
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
                  {hasUpdate ? (
                    <Badge className="gap-1 bg-blue-600 font-normal text-white hover:bg-blue-600 dark:bg-blue-500">
                      <DownloadCloud className="size-3" />
                      {sb.updateAvailable}
                    </Badge>
                  ) : null}
                  {status?.visibility && status.visibility !== "on" ? (
                    <Badge
                      variant="outline"
                      className="font-normal text-amber-600 dark:text-amber-400"
                    >
                      {sb.visibility[status.visibility]}
                    </Badge>
                  ) : null}
                  {status?.permission && status.permission !== "allow" ? (
                    <Badge
                      variant="outline"
                      className="font-normal text-amber-600 dark:text-amber-400"
                    >
                      {sb.permission[status.permission]}
                    </Badge>
                  ) : null}
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
                  {deferredQuery.trim() && matchRow(row, deferredQuery).contentOnly ? (
                    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                      <Search className="size-3" />
                      {sb.contentMatch}
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
          if (!open) {
            setDetail(null)
            setOverridesBump((n) => n + 1)
          }
        }}
        refresh={refresh}
      />

      <BackupsDialog open={backupsOpen} onOpenChange={setBackupsOpen} refresh={refresh} />

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

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{sb.batchDeleteConfirmTitle(selected.size)}</AlertDialogTitle>
            <AlertDialogDescription>
              {sb.batchDeleteConfirmBody(
                deleteScope === "all" ? sb.deleteScopeAll : sb.sources[deleteScope]
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{sb.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void batchDelete()
                setBatchDeleteOpen(false)
              }}
            >
              {sb.batchDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {guardDialog}
    </div>
  )
}
