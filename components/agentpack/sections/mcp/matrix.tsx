"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { isTauri } from "@/lib/tauri"
import { readTextFile } from "@/lib/tauri/commands"
import { useIncremental } from "@/hooks/use-incremental"
import { useIsMobile } from "@/hooks/use-mobile"
import { findMcp } from "@/lib/agentpack/registry"
import { claudeMcpRoute, mcpAddSpecStep, mcpRemoveStep } from "@/lib/agentpack/plan"
import {
  parseClaudeMcpEntry,
  parseCodexMcpEntry,
  parseOpencodeMcpEntry,
  resolveCatalogSpec,
  type McpSpec,
} from "@/lib/agentpack/merge/mcp"
import type { McpTarget } from "@/lib/agentpack/types"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { installedRows, MCP_TARGETS, TargetDot, type McpRow } from "./helpers"

/** Read each installed server's on-disk spec once (first present target wins). */
function useOnDiskSpecs(scan: DashboardScan | null): Record<string, McpSpec> {
  const paths = useAppStore((s) => s.paths)
  const [map, setMap] = useState<Record<string, McpSpec>>({})
  useEffect(() => {
    if (!paths || !isTauri()) return
    let cancelled = false
    void (async () => {
      const [claude, codex, opencode] = await Promise.all([
        readTextFile(paths.claudeConfig).catch(() => ""),
        readTextFile(paths.codexConfig).catch(() => ""),
        readTextFile(paths.opencodeConfig).catch(() => ""),
      ])
      if (cancelled) return
      const out: Record<string, McpSpec> = {}
      for (const row of installedRows(scan)) {
        const spec =
          parseClaudeMcpEntry(claude, row.id) ??
          parseCodexMcpEntry(codex, row.id) ??
          parseOpencodeMcpEntry(opencode, row.id)
        if (spec) out[row.id] = spec
      }
      setMap(out)
    })()
    return () => {
      cancelled = true
    }
  }, [scan, paths])
  return map
}

/**
 * Server × target matrix — the at-a-glance "what's configured where" overview
 * (like cc-switch's per-app grid). Each cell toggles the server on that CLI:
 * clicking an empty cell copies the server there (catalog spec for known servers,
 * the on-disk spec for custom ones); clicking a filled cell removes it (confirmed).
 */
export function MatrixTab({ scan, refresh }: { scan: DashboardScan | null; refresh: () => void }) {
  const t = useT()
  const m = t.mcp
  const paths = useAppStore((s) => s.paths)
  const plan = useAppStore((s) => s.plan)
  const detections = useAppStore((s) => s.detections)
  const { run } = useRunnerCtx()
  const onDisk = useOnDiskSpecs(scan)

  const [query, setQuery] = useState("")
  const [confirm, setConfirm] = useState<{ row: McpRow; target: McpTarget } | null>(null)
  const isMobile = useIsMobile()

  const route = claudeMcpRoute(
    !!detections["claude-code"]?.installed,
    !!detections["claude-desktop"]?.installed
  )
  const claudeDisabled = route === "none"
  const titleOf = (id: string) => t.catalog.mcp[id]?.title ?? id

  const rows = useMemo(() => installedRows(scan), [scan])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => !q || `${r.id} ${titleOf(r.id)}`.toLowerCase().includes(q))
      .sort((a, b) => titleOf(a.id).localeCompare(titleOf(b.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query])

  const { visible, sentinelRef, hasMore } = useIncremental(filtered.length, query, 50)

  /** The spec to write when copying a server to a new target. */
  const specForCopy = (row: McpRow): McpSpec | undefined => {
    const known = findMcp(row.id)
    return known ? resolveCatalogSpec(known, plan.mcpKeys[row.id]) : onDisk[row.id]
  }

  const addTo = async (row: McpRow, target: McpTarget) => {
    if (!paths) return
    const spec = specForCopy(row)
    if (!spec) return
    await run(mcpAddSpecStep(row.id, spec, [target], paths, t, route))
    toast.success(m.copyDone(m.targets[target]))
    refresh()
  }

  const removeFrom = async (row: McpRow, target: McpTarget) => {
    if (!paths) return
    await run(mcpRemoveStep(row.id, [target], paths, t, route))
    refresh()
  }

  /** One server×target toggle, shared by the desktop table and the mobile cards. */
  const cellButton = (row: McpRow, tg: McpTarget) => {
    const on = row.presence[tg]
    const disabled = (tg === "claude" && claudeDisabled && !on) || (!on && !specForCopy(row))
    return (
      <button
        type="button"
        disabled={disabled}
        title={on ? m.removeFromTarget(m.targets[tg]) : m.copyToTarget(m.targets[tg])}
        onClick={() => (on ? setConfirm({ row, target: tg }) : void addTo(row, tg))}
        className={cn(
          "flex size-7 items-center justify-center rounded-full border transition-colors",
          on ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent/40",
          disabled && "cursor-not-allowed opacity-40"
        )}
      >
        {on ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
      </button>
    )
  }

  const shown = filtered.slice(0, visible)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{m.matrixHint}</p>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.searchPlaceholder}
            className="w-56 pl-8"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? m.empty : m.emptyFiltered}
        </div>
      ) : isMobile ? (
        // Narrow / split window: the grid becomes a per-server card with the
        // target toggles stacked, so nothing overflows horizontally.
        <div className="flex flex-col gap-2">
          {shown.map((row) => (
            <div key={row.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <span className="font-medium">{titleOf(row.id)}</span>
                {titleOf(row.id) !== row.id ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{row.id}</span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                {MCP_TARGETS.map((tg) => (
                  <div key={tg} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <TargetDot target={tg} on={row.presence[tg]} />
                      {m.targets[tg]}
                    </span>
                    {cellButton(row, tg)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
        </div>
      ) : (
        // Wide window: the full server×target grid. The table scrolls inside its
        // own container so the page body never scrolls horizontally.
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.matrixServer}</TableHead>
                {MCP_TARGETS.map((tg) => (
                  <TableHead key={tg} className="text-center">
                    <span className="inline-flex items-center gap-1.5">
                      <TargetDot target={tg} on />
                      {m.targets[tg]}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-medium">{titleOf(row.id)}</span>
                    {titleOf(row.id) !== row.id ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{row.id}</span>
                    ) : null}
                  </TableCell>
                  {MCP_TARGETS.map((tg) => (
                    <TableCell key={tg} className="text-center">
                      <div className="flex justify-center">{cellButton(row, tg)}</div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
        </div>
      )}

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
                if (confirm) void removeFrom(confirm.row, confirm.target)
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
