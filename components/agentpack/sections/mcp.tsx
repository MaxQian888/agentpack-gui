"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, ExternalLink, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { MCP_CATEGORY_ORDER, MCP_SERVERS } from "@/lib/agentpack/registry"
import { mcpAddStep, mcpRemoveStep } from "@/lib/agentpack/plan"
import {
  classifyAgainstRegistry,
  MCP_REGISTRY_IDS,
  parseClaudeMcpConfig,
  parseCodexConfig,
} from "@/lib/agentpack/scan"
import type { AgentTarget, McpServer, Paths } from "@/lib/agentpack/types"
import { readTextFile } from "@/lib/tauri/commands"
import { openUrl } from "@/lib/tauri/system"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { HelpTip } from "../help-tip"
import { useRunnerCtx } from "../run/runner-context"

const TARGETS: AgentTarget[] = ["claude", "codex"]

/** Which agents currently have a server configured. */
type AgentFlags = { claude: boolean; codex: boolean }

/** Registry servers keyed by id, plus any user-added ids not in the catalog. */
type McpStatus = { known: Record<string, AgentFlags>; custom: Record<string, AgentFlags> }

/** Status filters offered above the list. */
type Filter = "all" | "installed" | "notInstalled" | "needsKey"
const FILTERS: Filter[] = ["all", "installed", "notInstalled", "needsKey"]

/**
 * Which agents already have each server configured. Reads the same files, with
 * the same parsers, that the dashboard scan uses (`~/.claude.json` +
 * `config.toml`), so this section's badges never disagree with the dashboard.
 * Also surfaces user-added servers (ids not in the registry) so the page manages
 * everything on disk, not just the catalog subset.
 */
async function detectStatus(paths: Paths): Promise<McpStatus> {
  const [claudeJson, codexToml] = await Promise.all([
    readTextFile(paths.claudeConfig).catch(() => ""),
    readTextFile(paths.codexConfig).catch(() => ""),
  ])
  const claudeIds = parseClaudeMcpConfig(claudeJson)
  const codexIds = parseCodexConfig(codexToml).mcpServers
  const claude = new Set(claudeIds)
  const codex = new Set(codexIds)
  const flags = (id: string): AgentFlags => ({ claude: claude.has(id), codex: codex.has(id) })

  const known = Object.fromEntries(MCP_SERVERS.map((s) => [s.id, flags(s.id)]))
  const customIds = Array.from(
    new Set([
      ...classifyAgainstRegistry(claudeIds, MCP_REGISTRY_IDS).custom,
      ...classifyAgainstRegistry(codexIds, MCP_REGISTRY_IDS).custom,
    ])
  )
  const custom = Object.fromEntries(customIds.map((id) => [id, flags(id)]))
  return { known, custom }
}

const anyInstalled = (f: AgentFlags | undefined): boolean => !!f && (f.claude || f.codex)

export function McpSection() {
  const t = useT()
  const mcps = useAppStore((s) => s.plan.mcps)
  const mcpKeys = useAppStore((s) => s.plan.mcpKeys)
  const setMcp = useAppStore((s) => s.setMcp)
  const setMcpKey = useAppStore((s) => s.setMcpKey)
  const paths = useAppStore((s) => s.paths)
  const { run, onAfterRun } = useRunnerCtx()
  const [status, setStatus] = useState<McpStatus>({ known: {}, custom: {} })
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  const loadStatus = useCallback(async () => {
    if (!isTauri() || !paths) return
    setStatus(await detectStatus(paths))
  }, [paths])

  useEffect(() => {
    if (!isTauri() || !paths) return
    let cancelled = false
    detectStatus(paths).then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [paths])

  // A real run may have added/removed a server — re-scan so badges stay honest
  // without an app restart. Dry runs change nothing, so onAfterRun won't fire.
  useEffect(() => onAfterRun(() => void loadStatus()), [onAfterRun, loadStatus])

  const targetsFor = (id: string): AgentTarget[] => mcps.find((m) => m.id === id)?.targets ?? []

  const toggleTarget = (id: string, target: AgentTarget) => {
    const current = targetsFor(id)
    const next = current.includes(target)
      ? current.filter((x) => x !== target)
      : [...current, target]
    setMcp(id, next)
  }

  const addNow = async (server: McpServer) => {
    if (!paths) return
    // Only add to selected agents that don't already have it (a duplicate
    // `claude mcp add` errors; re-merging Codex is wasteful).
    const targets = targetsFor(server.id).filter((tg) => !status.known[server.id]?.[tg])
    if (targets.length === 0) return
    await run(mcpAddStep(server, targets, mcpKeys[server.id], paths, t))
  }

  const removeNow = async (server: McpServer) => {
    if (!paths) return
    const targets = targetsFor(server.id).filter((tg) => status.known[server.id]?.[tg])
    if (targets.length === 0) return
    await run(mcpRemoveStep(server.id, targets, paths, t))
  }

  const removeCustom = async (id: string, flags: AgentFlags) => {
    if (!paths) return
    const targets = TARGETS.filter((tg) => flags[tg])
    if (targets.length === 0) return
    await run(mcpRemoveStep(id, targets, paths, t))
  }

  const q = search.trim().toLowerCase()
  const matches = (server: McpServer): boolean => {
    const meta = t.catalog.mcp[server.id]
    if (q) {
      const hay = `${server.id} ${meta?.title ?? ""} ${meta?.purpose ?? ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    const installed = anyInstalled(status.known[server.id])
    if (filter === "installed") return installed
    if (filter === "notInstalled") return !installed
    if (filter === "needsKey") return !!server.keyEnv
    return true
  }

  const groups = MCP_CATEGORY_ORDER.map((cat) => ({
    cat,
    servers: MCP_SERVERS.filter((s) => s.category === cat && matches(s)),
  })).filter((g) => g.servers.length > 0)

  // Custom servers are always installed (they're on disk) with an unknown key
  // state, so the "not installed" / "needs key" filters exclude them.
  const showCustom = filter === "all" || filter === "installed"
  const customEntries = Object.entries(status.custom).filter(
    ([id]) => showCustom && (!q || id.toLowerCase().includes(q))
  )

  const total = MCP_SERVERS.length
  const installedCount = MCP_SERVERS.filter((s) => anyInstalled(status.known[s.id])).length
  const scanned = Object.keys(status.known).length > 0

  const nothingShown = groups.length === 0 && customEntries.length === 0

  return (
    <SectionShell
      title={t.mcp.title}
      subtitle={t.mcp.subtitle}
      help={<HelpTip text={t.help.mcp} />}
    >
      {/* Search + status filters. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t.mcp.searchPlaceholder}
              placeholder={t.mcp.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          {scanned ? (
            <span className="text-xs text-muted-foreground">
              {t.mcp.summary(installedCount, total)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? t.mcp.filterAll
                : f === "installed"
                  ? t.mcp.filterInstalled
                  : f === "notInstalled"
                    ? t.mcp.filterNotInstalled
                    : t.mcp.filterNeedsKey}
            </Button>
          ))}
        </div>
      </div>

      {nothingShown ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.mcp.noResults}</p>
      ) : null}

      {/* Catalog servers, grouped by category. */}
      {groups.map((group) => (
        <div key={group.cat} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t.mcp.categories[group.cat]}
            <span className="ml-2 text-xs font-normal opacity-70">{group.servers.length}</span>
          </h3>
          {group.servers.map((server) => {
            const meta = t.catalog.mcp[server.id]
            const targets = targetsFor(server.id)
            const st = status.known[server.id]
            const installedAny = anyInstalled(st)
            const canAdd = targets.some((tg) => !st?.[tg])
            const canRemove = targets.some((tg) => st?.[tg])
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
                          {t.mcp.needsKeyBadge}
                        </Badge>
                      ) : null}
                      {server.docsUrl ? (
                        <button
                          type="button"
                          onClick={() => void openUrl(server.docsUrl!)}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {t.mcp.docs}
                          <ExternalLink className="size-3" />
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{meta?.purpose}</p>
                  </div>
                  {st ? (
                    <Badge
                      variant={installedAny ? "secondary" : "outline"}
                      className="shrink-0 font-normal text-muted-foreground"
                    >
                      {installedAny
                        ? `${t.mcp.installed}${
                            st.claude && st.codex ? "" : ` (${st.claude ? "claude" : "codex"})`
                          }`
                        : t.mcp.notInstalled}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-5">
                    {TARGETS.map((target) => (
                      <label
                        key={target}
                        className="flex cursor-pointer items-center gap-2 text-sm capitalize"
                      >
                        <Checkbox
                          checked={targets.includes(target)}
                          onCheckedChange={() => toggleTarget(server.id, target)}
                        />
                        {target}
                        {st?.[target] ? (
                          <Check className="size-3.5 text-emerald-600 dark:text-emerald-500" />
                        ) : null}
                      </label>
                    ))}
                  </div>
                  {canAdd || canRemove ? (
                    <div className="flex gap-2">
                      {canAdd ? (
                        <Button variant="outline" size="sm" onClick={() => void addNow(server)}>
                          {t.mcp.addNow}
                        </Button>
                      ) : null}
                      {canRemove ? (
                        <Button variant="ghost" size="sm" onClick={() => void removeNow(server)}>
                          {t.mcp.removeNow}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {server.keyEnv ? (
                  <Input
                    type="password"
                    aria-label={`${server.id} ${server.keyEnv}`}
                    placeholder={server.keyEnv}
                    value={mcpKeys[server.id] ?? ""}
                    onChange={(e) => setMcpKey(server.id, e.target.value)}
                  />
                ) : null}
              </Card>
            )
          })}
        </div>
      ))}

      {/* User-added servers not in the catalog — surfaced so they can be removed. */}
      {customEntries.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">{t.mcp.customTitle}</h3>
            <p className="text-xs text-muted-foreground">{t.mcp.customHint}</p>
          </div>
          {customEntries.map(([id, flags]) => (
            <Card key={id} className="flex-row items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate font-mono text-sm">{id}</span>
                {TARGETS.filter((tg) => flags[tg]).map((tg) => (
                  <Badge
                    key={tg}
                    variant="secondary"
                    className="font-normal text-muted-foreground capitalize"
                  >
                    {tg}
                  </Badge>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => void removeCustom(id, flags)}
              >
                {t.mcp.removeNow}
              </Button>
            </Card>
          ))}
        </div>
      ) : null}
    </SectionShell>
  )
}
