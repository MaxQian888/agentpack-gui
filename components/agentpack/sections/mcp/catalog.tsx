"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ExternalLink, Info, KeyRound, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { MCP_CATEGORY_ORDER, MCP_SERVERS } from "@/lib/agentpack/registry"
import {
  mcpAddSpecStep,
  mcpAddStep,
  mcpEditStep,
  mcpRemoveStep,
  type ClaudeMcpRoute,
} from "@/lib/agentpack/plan"
import { resolveCatalogSpec } from "@/lib/agentpack/merge/mcp"
import { runApplied } from "@/lib/agentpack/report"
import { mapRegistryResponse, type RegistryCandidate } from "@/lib/agentpack/registry-remote"
import type { McpServer, McpTarget } from "@/lib/agentpack/types"
import { isTauri } from "@/lib/tauri"
import { registryFetch } from "@/lib/tauri/commands"
import { openUrl } from "@/lib/tauri/system"
import { useRunnerCtx } from "../../run/runner-context"
import type { DashboardScan } from "../dashboard"
import {
  CapabilityEmpty,
  CapabilityGroupHeading,
  CapabilityList,
  CapabilityRow,
} from "../capability-list"
import { FilterField, FilterToolbar, MoreFilters, ScopeChip, SearchField } from "../filter-bar"
import { anyPresent, existingIds, KeyInput, presenceOf, TargetToggles } from "./helpers"
import { McpDetailDialog } from "./detail-dialog"
import { CustomServerForm, type CustomFormValue } from "./custom-form"

type Filter = "all" | "installed" | "notInstalled" | "needsKey"
type TargetFilter = McpTarget | "all"
type TransportFilter = McpServer["transport"] | "all"
type AuthFilter = "all" | "key" | "none"
const FILTERS: Filter[] = ["all", "installed", "notInstalled", "needsKey"]

/**
 * One online search's answer, stamped with the query it answers.
 *
 * Without the stamp a slow reply to "fi" could land after "filesystem" and
 * replace its results, and "Load more" could send the new query with the old
 * query's cursor.
 */
interface RegistryPage {
  query: string
  results: RegistryCandidate[]
  cursor?: string
  /** The first page failed — there is nothing to show for this query. */
  error: boolean
  /** A later page failed — what loaded stays on screen, with a retry. */
  moreError: boolean
}

export function CatalogTab({
  scan,
  refresh,
  route,
  initialFilter = "all",
}: {
  scan: DashboardScan | null
  refresh: () => void
  /** How Claude's config is reached (`claudeMcpRoute`), decided by the section. */
  route: ClaudeMcpRoute
  /** Where the list starts — "needsKey" when arriving to fill in a key. */
  initialFilter?: Filter
}) {
  const t = useT()
  const m = t.mcp
  const plan = useAppStore((s) => s.plan)
  const setMcpKey = useAppStore((s) => s.setMcpKey)
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [target, setTarget] = useState<TargetFilter>("all")
  const [transport, setTransport] = useState<TransportFilter>("all")
  const [auth, setAuth] = useState<AuthFilter>("all")
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ server: McpServer; target: McpTarget } | null>(null)
  // Which key fields are open. A server that needs a key gets a disclosure
  // rather than a permanent password field: five of them stacked down the
  // catalog read as a form to fill in before you may browse.
  const [keyOpen, setKeyOpen] = useState<Set<string>>(new Set())

  // Online registry search (on-demand; the featured catalog above stays offline).
  const [reg, setReg] = useState<RegistryPage | null>(null)
  const [regLoading, setRegLoading] = useState(false)
  const [addCand, setAddCand] = useState<RegistryCandidate | null>(null)

  const claudeDisabled = route === "none"
  const takenIds = useMemo(() => existingIds(scan), [scan])

  // A catalog add is applied the moment the review panel says so. It used to
  // write the same selection into the install plan as well, which brought the
  // change tray up offering to review a change that had already happened.
  const addOne = async (server: McpServer, target: McpTarget) => {
    if (!paths) return
    await run(mcpAddStep(server, [target], plan.mcpKeys[server.id], paths, t, route))
    refresh()
  }

  // Rewrite an installed server with the key now in the plan, on every agent
  // it is already configured for. Staged as an edit, so the panel shows which
  // config files change before anything is written.
  const installedTargets = (presence: ReturnType<typeof presenceOf>): McpTarget[] =>
    (["claude", "codex", "opencode"] as const).filter(
      (tg) => presence[tg] && !(tg === "claude" && claudeDisabled)
    )
  const applyKey = async (server: McpServer, targets: McpTarget[]) => {
    const key = plan.mcpKeys[server.id]?.trim()
    if (!paths || !key || targets.length === 0) return
    const title = t.catalog.mcp[server.id]?.title ?? server.id
    await run(mcpEditStep(server.id, resolveCatalogSpec(server, key), targets, paths, t, route), {
      activity: { title: m.keyApplyTitle(title), source: "section" },
    })
    refresh()
  }

  const removeOne = async (server: McpServer, target: McpTarget) => {
    if (!paths) return
    await run(mcpRemoveStep(server.id, [target], paths, t, route))
    refresh()
  }

  const q = search.trim().toLowerCase()
  // The query the user is looking at *now*, for replies to check themselves
  // against. Synced in an effect: a reply lands long after the render it
  // belongs to.
  const liveQuery = useRef(q)
  useEffect(() => {
    liveQuery.current = q
  }, [q])

  const fetchRegistry = async (query: string, cursor?: string) => {
    if (!isTauri()) return
    setRegLoading(true)
    try {
      const raw = await registryFetch(query, cursor)
      // A reply to a query the user has typed past answers nothing on screen.
      if (liveQuery.current !== query) return
      const { candidates, nextCursor } = mapRegistryResponse(JSON.parse(raw))
      setReg((prev) =>
        cursor && prev?.query === query
          ? { ...prev, results: [...prev.results, ...candidates], cursor: nextCursor }
          : { query, results: candidates, cursor: nextCursor, error: false, moreError: false }
      )
    } catch {
      if (liveQuery.current !== query) return
      // A failed next page keeps what already loaded; only a failed first page
      // has nothing to show.
      setReg((prev) =>
        cursor && prev?.query === query
          ? { ...prev, moreError: true }
          : { query, results: [], error: true, moreError: false }
      )
    } finally {
      if (liveQuery.current === query) setRegLoading(false)
    }
  }

  // Debounce the online search; the featured catalog above never waits on it.
  // Results are shown only while their stamp matches q (see `current` below),
  // so there's no need to reset state synchronously here.
  useEffect(() => {
    if (q.length < 2 || !isTauri()) return
    const handle = setTimeout(() => void fetchRegistry(q), 350)
    return () => clearTimeout(handle)
  }, [q])
  const current = reg?.query === q ? reg : null

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
    const reports = await run(mcpAddSpecStep(v.id, v.spec, v.targets, paths, t, route))
    // The form holds what was typed; close it only once that is on disk.
    if (runApplied(reports)) setAddCand(null)
    refresh()
  }

  /** Everything except the status chips — so those can carry faceted counts. */
  const matchesBase = (server: McpServer): boolean => {
    if (q) {
      const meta = t.catalog.mcp[server.id]
      const hay = `${server.id} ${meta?.title ?? ""} ${meta?.purpose ?? ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (transport !== "all" && server.transport !== transport) return false
    if (auth === "key" && !server.keyEnv) return false
    if (auth === "none" && server.keyEnv) return false
    return true
  }

  const matchesFilter = (server: McpServer, f: Filter): boolean => {
    if (f === "needsKey") return !!server.keyEnv
    if (f === "all") return true
    const presence = presenceOf(scan, server.id)
    const installed = target === "all" ? anyPresent(presence) : presence[target]
    return f === "installed" ? installed : !installed
  }

  const matches = (server: McpServer): boolean =>
    matchesBase(server) && matchesFilter(server, filter)

  /* eslint-disable react-hooks/exhaustive-deps */
  const counts = useMemo(() => {
    const base = MCP_SERVERS.filter(matchesBase)
    return Object.fromEntries(
      FILTERS.map((f) => [f, base.filter((s) => matchesFilter(s, f)).length])
    ) as Record<Filter, number>
  }, [scan, q, target, transport, auth])

  const groups = useMemo(
    () =>
      MCP_CATEGORY_ORDER.map((cat) => ({
        cat,
        servers: MCP_SERVERS.filter((s) => s.category === cat && matches(s)),
      })).filter((g) => g.servers.length > 0),
    [scan, q, filter, target, transport, auth]
  )
  /* eslint-enable react-hooks/exhaustive-deps */

  const advanced =
    (target !== "all" ? 1 : 0) + (transport !== "all" ? 1 : 0) + (auth !== "all" ? 1 : 0)
  const resetAdvanced = () => {
    setTarget("all")
    setTransport("all")
    setAuth("all")
  }

  const toggleKey = (id: string) =>
    setKeyOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const filterLabel = (f: Filter) =>
    f === "all"
      ? m.filterAll
      : f === "installed"
        ? m.filterInstalled
        : f === "notInstalled"
          ? m.filterNotInstalled
          : m.filterNeedsKey

  return (
    <div className="flex flex-col gap-4">
      <FilterToolbar
        scope={FILTERS.map((f) => (
          <ScopeChip
            key={f}
            active={filter === f}
            count={counts[f]}
            label={filterLabel(f)}
            onSelect={() => {
              setFilter(f)
              if (f !== "installed" && f !== "notInstalled") setTarget("all")
            }}
          />
        ))}
      >
        <SearchField value={search} onChange={setSearch} label={m.searchPlaceholder} />
        <MoreFilters
          label={m.filtersLabel}
          resetLabel={m.filtersReset}
          active={advanced}
          onReset={resetAdvanced}
        >
          <FilterField label={m.filterTarget}>
            <Select value={target} onValueChange={(value) => setTarget(value as TargetFilter)}>
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={m.filterTarget}
                disabled={filter !== "installed" && filter !== "notInstalled"}
                aria-describedby={
                  filter !== "installed" && filter !== "notInstalled"
                    ? "mcp-target-filter-hint"
                    : undefined
                }
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
            {filter !== "installed" && filter !== "notInstalled" ? (
              <p id="mcp-target-filter-hint" className="text-xs text-muted-foreground">
                {m.filterTargetHint}
              </p>
            ) : null}
          </FilterField>
          <FilterField label={m.filterTransport}>
            <Select
              value={transport}
              onValueChange={(value) => setTransport(value as TransportFilter)}
            >
              <SelectTrigger size="sm" className="w-full" aria-label={m.filterTransport}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{m.filterAnyTransport}</SelectItem>
                <SelectItem value="stdio">{m.transportStdio}</SelectItem>
                <SelectItem value="http">{m.transportHttp}</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label={m.filterAuth}>
            <Select value={auth} onValueChange={(value) => setAuth(value as AuthFilter)}>
              <SelectTrigger size="sm" className="w-full" aria-label={m.filterAuth}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{m.filterAnyAuth}</SelectItem>
                <SelectItem value="key">{m.filterNeedsKey}</SelectItem>
                <SelectItem value="none">{m.filterNoKey}</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </MoreFilters>
      </FilterToolbar>

      {/* Said once, above the list, instead of implied forty times by forty rows
          of unlabelled chips: what the per-agent buttons in each row do. */}
      <p className="text-sm text-muted-foreground">{m.catalogHint}</p>

      {groups.length === 0 ? (
        <CapabilityEmpty message={m.noResults} />
      ) : (
        <CapabilityList label={m.catalogPanel}>
          {groups.map((group) => (
            <li key={group.cat} className="min-w-0">
              <ul className="min-w-0">
                <CapabilityGroupHeading
                  title={m.categories[group.cat]}
                  count={group.servers.length}
                />
                {group.servers.map((server) => {
                  const meta = t.catalog.mcp[server.id]
                  const presence = presenceOf(scan, server.id)
                  const key = plan.mcpKeys[server.id] ?? ""
                  const showKey = keyOpen.has(server.id) || key !== ""
                  return (
                    <CapabilityRow
                      key={server.id}
                      title={meta?.title ?? server.id}
                      onOpen={() => setDetailId(server.id)}
                      tags={
                        <>
                          <span className="font-mono">{server.transport}</span>
                          {server.docsUrl ? (
                            <button
                              type="button"
                              onClick={() => void openUrl(server.docsUrl!)}
                              className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                            >
                              {m.docs}
                              <ExternalLink aria-hidden="true" className="size-3" />
                            </button>
                          ) : null}
                        </>
                      }
                      description={meta?.purpose}
                      actions={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={m.view}
                          onClick={() => setDetailId(server.id)}
                        >
                          <Info className="size-4" />
                        </Button>
                      }
                    >
                      <div className="flex min-w-0 flex-col gap-2">
                        <TargetToggles
                          presence={presence}
                          disabled={claudeDisabled ? { claude: m.claudeMissing } : undefined}
                          onToggle={(target, installed) =>
                            installed ? setConfirm({ server, target }) : void addOne(server, target)
                          }
                        />
                        {server.keyEnv && !showKey ? (
                          <button
                            type="button"
                            onClick={() => toggleKey(server.id)}
                            className="flex w-fit items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                          >
                            <KeyRound aria-hidden="true" className="size-3.5" />
                            {m.keyAdd(server.keyEnv)}
                          </button>
                        ) : null}
                        {server.keyEnv && showKey ? (
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <KeyInput
                              ariaLabel={`${server.id} ${server.keyEnv}`}
                              placeholder={server.keyEnv}
                              value={key}
                              onChange={(v) => setMcpKey(server.id, v)}
                            />
                            {installedTargets(presence).length > 0 ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!key.trim()}
                                onClick={() => void applyKey(server, installedTargets(presence))}
                              >
                                {m.keyApply(installedTargets(presence).length)}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">{m.keyPending}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </CapabilityRow>
                  )
                })}
              </ul>
            </li>
          ))}
        </CapabilityList>
      )}

      {isTauri() && q.length >= 2 ? (
        <div className="flex flex-col gap-3">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
            {m.registryTitle}
            {current?.results.length ? (
              <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
                {current.results.length}
              </span>
            ) : null}
            {regLoading ? <Spinner className="size-3.5" /> : null}
          </h4>
          {/* No page for this exact query yet means one is on its way (the
              debounce or the request), whatever an older query left behind. */}
          {!current ? (
            <p className="text-sm text-muted-foreground">{m.registrySearching}</p>
          ) : current.error ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">{m.registryError}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={regLoading}
                onClick={() => void fetchRegistry(q)}
              >
                {m.registryRetry}
              </Button>
            </div>
          ) : current.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.registryEmpty}</p>
          ) : (
            <>
              <CapabilityList label={m.registryTitle}>
                {current.results.map((c) => (
                  <CapabilityRow
                    key={c.name}
                    title={c.title}
                    tags={
                      <>
                        {c.spec ? <span className="font-mono">{c.spec.transport}</span> : null}
                        <span className="font-mono [overflow-wrap:anywhere]">{c.name}</span>
                        {c.docsUrl ? (
                          <button
                            type="button"
                            onClick={() => void openUrl(c.docsUrl!)}
                            className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
                          >
                            {m.docs}
                            <ExternalLink aria-hidden="true" className="size-3" />
                          </button>
                        ) : null}
                      </>
                    }
                    description={c.description}
                    actions={
                      c.spec ? (
                        <Button size="sm" variant="outline" onClick={() => setAddCand(c)}>
                          {m.registryAdd}
                        </Button>
                      ) : (
                        <span
                          title={m.registryUnsupportedOci}
                          className="text-xs text-muted-foreground"
                        >
                          {c.unsupported}
                        </span>
                      )
                    }
                  />
                ))}
              </CapabilityList>
              {current.moreError ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted-foreground">{m.registryMoreError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={regLoading}
                    onClick={() => void fetchRegistry(q, current.cursor)}
                  >
                    {m.registryRetry}
                  </Button>
                </div>
              ) : current.cursor ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={regLoading}
                  onClick={() => void fetchRegistry(q, current.cursor)}
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
              disabledTargets={claudeDisabled ? { claude: m.claudeMissing } : undefined}
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
