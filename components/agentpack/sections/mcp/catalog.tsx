"use client"

import { useEffect, useMemo, useState } from "react"
import { ExternalLink, Info, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { claudeMcpRoute, mcpAddSpecStep, mcpAddStep, mcpRemoveStep } from "@/lib/agentpack/plan"
import { mapRegistryResponse, type RegistryCandidate } from "@/lib/agentpack/registry-remote"
import type { McpServer, McpTarget } from "@/lib/agentpack/types"
import { isTauri } from "@/lib/tauri"
import { registryFetch } from "@/lib/tauri/commands"
import { openUrl } from "@/lib/tauri/system"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import { anyPresent, existingIds, KeyInput, presenceOf, TargetToggles } from "./helpers"
import { McpDetailDialog } from "./detail-dialog"
import { CustomServerForm, type CustomFormValue } from "./custom-form"

type Filter = "all" | "installed" | "notInstalled" | "needsKey"
type TargetFilter = McpTarget | "all"
type TransportFilter = McpServer["transport"] | "all"
type AuthFilter = "all" | "key" | "none"
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
  const [target, setTarget] = useState<TargetFilter>("all")
  const [transport, setTransport] = useState<TransportFilter>("all")
  const [auth, setAuth] = useState<AuthFilter>("all")
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ server: McpServer; target: McpTarget } | null>(null)

  // Online registry search (on-demand; the featured catalog above stays offline).
  const [regResults, setRegResults] = useState<RegistryCandidate[]>([])
  const [regCursor, setRegCursor] = useState<string | undefined>(undefined)
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState(false)
  const [addCand, setAddCand] = useState<RegistryCandidate | null>(null)

  // The desktop app has no `claude` binary but reads the same config file, so
  // "no CLI" is not the same as "cannot configure Claude" any more.
  const route = claudeMcpRoute(
    !!detections["claude-code"]?.installed,
    !!detections["claude-desktop"]?.installed
  )
  const claudeDisabled = route === "none"
  const takenIds = useMemo(() => existingIds(scan), [scan])

  const syncPlan = (id: string, target: McpTarget, add: boolean) => {
    const cur = plan.mcps.find((x) => x.id === id)?.targets ?? []
    const next = add
      ? Array.from(new Set<McpTarget>([...cur, target]))
      : cur.filter((x) => x !== target)
    setMcp(id, next)
  }

  const addOne = async (server: McpServer, target: McpTarget) => {
    if (!paths) return
    await run(mcpAddStep(server, [target], plan.mcpKeys[server.id], paths, t, route))
    syncPlan(server.id, target, true)
    refresh()
  }

  const removeOne = async (server: McpServer, target: McpTarget) => {
    if (!paths) return
    await run(mcpRemoveStep(server.id, [target], paths, t, route))
    syncPlan(server.id, target, false)
    refresh()
  }

  const q = search.trim().toLowerCase()

  const fetchRegistry = async (query: string, cursor?: string) => {
    if (!isTauri()) return
    setRegLoading(true)
    setRegError(false)
    try {
      const raw = await registryFetch(query, cursor)
      const { candidates, nextCursor } = mapRegistryResponse(JSON.parse(raw))
      setRegResults((prev) => (cursor ? [...prev, ...candidates] : candidates))
      setRegCursor(nextCursor)
    } catch {
      setRegError(true)
      if (!cursor) setRegResults([])
    } finally {
      setRegLoading(false)
    }
  }

  // Debounce the online search; the featured catalog above never waits on it.
  // Results are hidden until q ≥ 2 (see the JSX guard) and every fetch replaces
  // them, so there's no need to reset state synchronously here.
  useEffect(() => {
    if (q.length < 2 || !isTauri()) return
    const handle = setTimeout(() => void fetchRegistry(q), 350)
    return () => clearTimeout(handle)
  }, [q])

  /** Prefill the custom form from a registry candidate (secrets → env refs; required non-secret vars → empty rows). */
  const candidateToForm = (c: RegistryCandidate): CustomFormValue => {
    const spec = c.spec!
    if (spec.transport !== "stdio") return { id: c.id, spec, targets: ["claude"] }
    const env = { ...spec.env }
    for (const inp of c.envInputs) {
      if (inp.required && !inp.secret && !(inp.name in env) && !spec.envRefs?.[inp.name]) {
        env[inp.name] = ""
      }
    }
    return { id: c.id, spec: { ...spec, env }, targets: ["claude"] }
  }

  const addFromForm = async (v: CustomFormValue) => {
    if (!paths) return
    await run(mcpAddSpecStep(v.id, v.spec, v.targets, paths, t, route))
    setAddCand(null)
    refresh()
  }

  const matches = (server: McpServer): boolean => {
    const meta = t.catalog.mcp[server.id]
    if (q) {
      const hay = `${server.id} ${meta?.title ?? ""} ${meta?.purpose ?? ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (transport !== "all" && server.transport !== transport) return false
    if (auth === "key" && !server.keyEnv) return false
    if (auth === "none" && server.keyEnv) return false
    const presence = presenceOf(scan, server.id)
    const installed = target === "all" ? anyPresent(presence) : presence[target]
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
    [scan, q, filter, target, transport, auth]
  )

  const nothing = groups.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f)
              if (f !== "installed" && f !== "notInstalled") setTarget("all")
            }}
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
        <Select value={target} onValueChange={(value) => setTarget(value as TargetFilter)}>
          <SelectTrigger
            size="sm"
            className="w-36"
            aria-label={m.filterTarget}
            disabled={filter !== "installed" && filter !== "notInstalled"}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{m.filterAnyTarget}</SelectItem>
            <SelectItem value="claude">{m.targets.claude}</SelectItem>
            <SelectItem value="codex">{m.targets.codex}</SelectItem>
            <SelectItem value="opencode">{m.targets.opencode}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={transport} onValueChange={(value) => setTransport(value as TransportFilter)}>
          <SelectTrigger size="sm" className="w-40" aria-label={m.filterTransport}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{m.filterAnyTransport}</SelectItem>
            <SelectItem value="stdio">{m.transportStdio}</SelectItem>
            <SelectItem value="http">{m.transportHttp}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={auth} onValueChange={(value) => setAuth(value as AuthFilter)}>
          <SelectTrigger size="sm" className="w-44" aria-label={m.filterAuth}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{m.filterAnyAuth}</SelectItem>
            <SelectItem value="key">{m.filterNeedsKey}</SelectItem>
            <SelectItem value="none">{m.filterNoKey}</SelectItem>
          </SelectContent>
        </Select>
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

      {isTauri() && q.length >= 2 ? (
        <div className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            {m.registryTitle}
            {regResults.length ? (
              <span className="text-xs font-normal opacity-70">{regResults.length}</span>
            ) : null}
            {regLoading ? <Spinner className="size-3.5" /> : null}
          </h3>
          {regError ? (
            <p className="text-sm text-muted-foreground">{m.registryError}</p>
          ) : regLoading && regResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.registrySearching}</p>
          ) : regResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.registryEmpty}</p>
          ) : (
            <>
              {regResults.map((c) => (
                <Card key={c.name} className="gap-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.title}</span>
                        {c.spec ? (
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            {c.spec.transport}
                          </Badge>
                        ) : null}
                        {c.docsUrl ? (
                          <button
                            type="button"
                            onClick={() => void openUrl(c.docsUrl!)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {m.docs}
                            <ExternalLink className="size-3" />
                          </button>
                        ) : null}
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {c.name}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                    </div>
                    {c.spec ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setAddCand(c)}
                      >
                        {m.registryAdd}
                      </Button>
                    ) : (
                      <Badge
                        variant="outline"
                        className="shrink-0 font-normal text-muted-foreground"
                        title={m.registryUnsupportedOci}
                      >
                        {c.unsupported}
                      </Badge>
                    )}
                  </div>
                </Card>
              ))}
              {regCursor ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={regLoading}
                  onClick={() => void fetchRegistry(q, regCursor)}
                >
                  {m.registryLoadMore}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <Dialog open={addCand !== null} onOpenChange={(open) => !open && setAddCand(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{addCand ? m.registryAddTitle(addCand.title) : ""}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{addCand?.name}</DialogDescription>
          </DialogHeader>
          {addCand ? (
            <CustomServerForm
              mode="add"
              initial={candidateToForm(addCand)}
              takenIds={takenIds}
              onSubmit={(v) => void addFromForm(v)}
              onCancel={() => setAddCand(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

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
