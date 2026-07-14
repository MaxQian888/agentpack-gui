"use client"

import { useMemo, useState } from "react"
import { ExternalLink, Info, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { MCP_CATEGORY_ORDER, MCP_SERVERS } from "@/lib/agentpack/registry"
import { mcpAddStep, mcpRemoveStep } from "@/lib/agentpack/plan"
import type { McpServer, McpTarget } from "@/lib/agentpack/types"
import { openUrl } from "@/lib/tauri/system"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { anyPresent, KeyInput, presenceOf, TargetToggles } from "./helpers"
import { McpDetailDialog } from "./detail-dialog"

type Filter = "all" | "installed" | "notInstalled" | "needsKey"
const FILTERS: Filter[] = ["all", "installed", "notInstalled", "needsKey"]

export function CatalogTab({ scan, refresh }: { scan: DashboardScan | null; refresh: () => void }) {
  const t = useT()
  const m = t.mcp
  const plan = useAppStore((s) => s.plan)
  const setMcp = useAppStore((s) => s.setMcp)
  const setMcpKey = useAppStore((s) => s.setMcpKey)
  const paths = useAppStore((s) => s.paths)
  const detections = useAppStore((s) => s.detections)
  const { run } = useRunnerCtx()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ server: McpServer; target: McpTarget } | null>(null)

  const claudeDisabled = !detections["claude-code"]?.installed

  const syncPlan = (id: string, target: McpTarget, add: boolean) => {
    const cur = plan.mcps.find((x) => x.id === id)?.targets ?? []
    const next = add
      ? Array.from(new Set<McpTarget>([...cur, target]))
      : cur.filter((x) => x !== target)
    setMcp(id, next)
  }

  const addOne = async (server: McpServer, target: McpTarget) => {
    if (!paths) return
    await run(mcpAddStep(server, [target], plan.mcpKeys[server.id], paths, t))
    syncPlan(server.id, target, true)
    refresh()
  }

  const removeOne = async (server: McpServer, target: McpTarget) => {
    if (!paths) return
    await run(mcpRemoveStep(server.id, [target], paths, t))
    syncPlan(server.id, target, false)
    refresh()
  }

  const q = search.trim().toLowerCase()
  const matches = (server: McpServer): boolean => {
    const meta = t.catalog.mcp[server.id]
    if (q) {
      const hay = `${server.id} ${meta?.title ?? ""} ${meta?.purpose ?? ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    const installed = anyPresent(presenceOf(scan, server.id))
    if (filter === "installed") return installed
    if (filter === "notInstalled") return !installed
    if (filter === "needsKey") return !!server.keyEnv
    return true
  }

  const groups = useMemo(
    () =>
      MCP_CATEGORY_ORDER.map((cat) => ({
        cat,
        servers: MCP_SERVERS.filter((s) => s.category === cat && matches(s)),
      })).filter((g) => g.servers.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scan, q, filter]
  )

  const nothing = groups.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              filter === f
                ? "border-primary bg-primary/10 font-medium"
                : "text-muted-foreground hover:bg-accent/40"
            )}
          >
            {f === "all"
              ? m.filterAll
              : f === "installed"
                ? m.filterInstalled
                : f === "notInstalled"
                  ? m.filterNotInstalled
                  : m.filterNeedsKey}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={m.searchPlaceholder}
            placeholder={m.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 pl-8"
          />
        </div>
      </div>

      {nothing ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {m.noResults}
        </div>
      ) : null}

      {groups.map((group) => (
        <div key={group.cat} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {m.categories[group.cat]}
            <span className="ml-2 text-xs font-normal opacity-70">{group.servers.length}</span>
          </h3>
          {group.servers.map((server) => {
            const meta = t.catalog.mcp[server.id]
            const presence = presenceOf(scan, server.id)
            return (
              <Card key={server.id} className="gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{meta?.title ?? server.id}</span>
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {server.transport}
                      </Badge>
                      {server.keyEnv ? (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          {m.needsKeyBadge}
                        </Badge>
                      ) : null}
                      {server.docsUrl ? (
                        <button
                          type="button"
                          onClick={() => void openUrl(server.docsUrl!)}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {m.docs}
                          <ExternalLink className="size-3" />
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{meta?.purpose}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.view}
                    onClick={() => setDetailId(server.id)}
                  >
                    <Info className="size-4" />
                  </Button>
                </div>
                <TargetToggles
                  presence={presence}
                  disabled={claudeDisabled ? { claude: m.claudeMissing } : undefined}
                  onToggle={(target, installed) =>
                    installed ? setConfirm({ server, target }) : void addOne(server, target)
                  }
                />
                {server.keyEnv ? (
                  <KeyInput
                    ariaLabel={`${server.id} ${server.keyEnv}`}
                    placeholder={server.keyEnv}
                    value={plan.mcpKeys[server.id] ?? ""}
                    onChange={(v) => setMcpKey(server.id, v)}
                  />
                ) : null}
              </Card>
            )
          })}
        </div>
      ))}

      <McpDetailDialog
        id={detailId}
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
        scan={scan}
        refresh={refresh}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm
                ? m.removeConfirmTitle(t.catalog.mcp[confirm.server.id]?.title ?? confirm.server.id)
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? m.removeConfirmBody(m.targets[confirm.target]) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) void removeOne(confirm.server, confirm.target)
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
