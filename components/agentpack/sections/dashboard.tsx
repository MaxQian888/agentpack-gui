/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: design.md · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */
"use client"

import {
  ArrowLeftRight,
  ArrowRight,
  Globe,
  RefreshCw,
  Server,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { CLI_TOOLS, RUNTIMES, upgradeCommandFor } from "@/lib/agentpack/registry"
import { cliInstallStep, fileRestoreStep, BACKUP_SUFFIX } from "@/lib/agentpack/plan"
import { extractSemver, isUpgradeAvailable } from "@/lib/agentpack/version"
import {
  classifyAgainstRegistry,
  MCP_REGISTRY_IDS,
  parseClaudeMcpConfig,
  parseClaudeRelay,
  parseCodexConfig,
  parseOpencodeMcpConfig,
  SKILL_REGISTRY_IDS,
  type ClassifiedIds,
  type ClaudeRelayState,
} from "@/lib/agentpack/scan"
import { listSkills, pathExists, providerLoad, readTextFile } from "@/lib/tauri/commands"
import type { Paths } from "@/lib/agentpack/types"
import type { Provider, ProviderBackend } from "@/lib/agentpack/ccswitch/types"
import { isTauri } from "@/lib/tauri"
import { saveSettings } from "@/lib/tauri/settings"
import { useMounted } from "@/hooks/use-mounted"
import { SpendCard, type HistoryFeed } from "./dashboard-spend"
import { DiagnosticsList } from "./diagnostics-list"
import { ActivityCard } from "./activity-card"
import { buildDiagnostics, type DiagnosticItem } from "@/lib/agentpack/diagnostics"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import type { SectionKey } from "../sidebar-nav"
import { useRunnerCtx } from "../run/runner-context"
import { DesktopOnlyNote } from "../desktop-only-note"
import { CapabilityMetric, CapabilityWorkbench } from "./capability-workbench"

type FileStatus = "ok" | "invalid" | "missing"
interface FileHealth {
  status: FileStatus
  hasBackup: boolean
}

export interface DashboardScan {
  claudeMcps: ClassifiedIds
  codexMcps: ClassifiedIds
  opencodeMcps: ClassifiedIds
  claudeSkills: ClassifiedIds
  codexSkills: ClassifiedIds
  relay: ClaudeRelayState
  hasCodexRelay: boolean
  providers: Provider[]
  claudeSettings: FileHealth
  codexConfig: FileHealth
  /**
   * At least one source could not be read — as opposed to not being there.
   *
   * The Rust side already draws that line (`read_text_file` maps NotFound to an
   * empty string and only a real failure to an Err), but every read here is
   * `.catch`ed to a benign default, so without this flag a locked or
   * permission-denied config is indistinguishable from a clean machine. The
   * one-click install reads it: deduping against a scan that wrongly says
   * "nothing is installed" re-adds everything, and `claude mcp add` rejects a
   * duplicate id, so the run fills with red.
   */
  degraded: boolean
}

const emptyScan = (): DashboardScan => ({
  claudeMcps: { known: [], custom: [] },
  codexMcps: { known: [], custom: [] },
  opencodeMcps: { known: [], custom: [] },
  claudeSkills: { known: [], custom: [] },
  codexSkills: { known: [], custom: [] },
  relay: { hasToken: false },
  hasCodexRelay: false,
  providers: [],
  claudeSettings: { status: "missing", hasBackup: false },
  codexConfig: { status: "missing", hasBackup: false },
  degraded: false,
})

/**
 * How many entries an overview card shows before it defers to its own section.
 * The dashboard is a summary with entry points, not a second copy of the MCP /
 * Skills / cc-switch managers — capping the lists is what keeps every card a
 * predictable height and the page down to a single scrollbar.
 */
const OVERVIEW_LIMIT = 5

/** Try to parse JSON; classify the file's health for the dashboard. */
function jsonHealth(text: string): FileStatus {
  if (!text.trim()) return "missing"
  try {
    JSON.parse(text)
    return "ok"
  } catch {
    return "invalid"
  }
}

export async function scanEnvironment(
  paths: Paths,
  providerBackend: ProviderBackend = "ccswitch"
): Promise<DashboardScan> {
  // Each read still falls back to a benign default so one bad file can't blank
  // the dashboard — but the failure is recorded rather than forgotten. Only the
  // sources the dedup relies on count: a missing cc-switch DB or backup file
  // says nothing about whether the MCP and skill config could be read.
  let degraded = false
  const soft = <T,>(p: Promise<T>, fallback: T, counts = true): Promise<T> =>
    p.catch(() => {
      if (counts) degraded = true
      return fallback
    })

  const [
    claudeJson,
    claudeConfig,
    codexToml,
    opencodeJson,
    claudeSkillNames,
    codexSkillNames,
    providers,
    codexBak,
  ] = await Promise.all([
    soft(readTextFile(paths.claudeSettings), ""),
    // User-scope MCP servers live in ~/.claude.json; read it directly instead of
    // the ~45s health-checking `claude mcp list`, which also risks hanging.
    soft(readTextFile(paths.claudeConfig), ""),
    soft(readTextFile(paths.codexConfig), ""),
    soft(readTextFile(paths.opencodeConfig), ""),
    soft(listSkills(paths.claudeSkillsDir), [] as string[]),
    soft(listSkills(paths.codexSkillsDir), [] as string[]),
    soft(providerLoad(providerBackend), [] as Provider[], false),
    soft(pathExists(`${paths.codexConfig}${BACKUP_SUFFIX}`), false, false),
  ])

  const codex = parseCodexConfig(codexToml)
  const claudeBak = await soft(pathExists(`${paths.claudeSettings}${BACKUP_SUFFIX}`), false, false)

  return {
    claudeMcps: classifyAgainstRegistry(parseClaudeMcpConfig(claudeConfig), MCP_REGISTRY_IDS),
    codexMcps: classifyAgainstRegistry(codex.mcpServers, MCP_REGISTRY_IDS),
    opencodeMcps: classifyAgainstRegistry(parseOpencodeMcpConfig(opencodeJson), MCP_REGISTRY_IDS),
    claudeSkills: classifyAgainstRegistry(claudeSkillNames, SKILL_REGISTRY_IDS),
    codexSkills: classifyAgainstRegistry(codexSkillNames, SKILL_REGISTRY_IDS),
    relay: parseClaudeRelay(claudeJson),
    hasCodexRelay: codex.hasRelayProvider,
    providers,
    claudeSettings: { status: jsonHealth(claudeJson), hasBackup: claudeBak },
    codexConfig: {
      status: codexToml.trim() ? "ok" : "missing",
      hasBackup: codexBak,
    },
    degraded,
  }
}

/** One id as it appears across every agent that has it configured. */
interface OverviewEntry {
  id: string
  /** Agents this id is configured for, e.g. ["claude", "codex"]. */
  targets: string[]
  /** True when at least one agent has it outside agentpack's registry. */
  custom: boolean
}

/**
 * Fold the per-agent `ClassifiedIds` into one deduplicated list. The dashboard
 * used to render a separate block per agent, which triple-counted anything
 * installed everywhere and made "first 5" meaningless; here each id appears once
 * and carries the agents it belongs to.
 */
function mergeEntries(groups: { target: string; ids: ClassifiedIds }[]): OverviewEntry[] {
  const byId = new Map<string, OverviewEntry>()
  for (const { target, ids } of groups) {
    for (const id of [...ids.known, ...ids.custom]) {
      const entry = byId.get(id) ?? { id, targets: [], custom: false }
      if (!entry.targets.includes(target)) entry.targets.push(target)
      if (ids.custom.includes(id)) entry.custom = true
      byId.set(id, entry)
    }
  }
  // Registry entries first, then custom ones; alphabetical within each group.
  return [...byId.values()].sort(
    (a, b) => Number(a.custom) - Number(b.custom) || a.id.localeCompare(b.id)
  )
}

/**
 * The dashboard scan is owned by `ShellBody` (which never unmounts) and passed
 * in, so navigating away and back to the home page reuses the cached result
 * instead of re-running the slow `claude mcp list` scan every time.
 */
export interface DashboardSectionProps {
  scan: DashboardScan | null
  scanning: boolean
  rescan: () => Promise<void>
  /** Jump to the section that owns a truncated list ("View all"). */
  onNavigate: (key: SectionKey) => void
  /** The startup chat-history scan, feeding the spend card. */
  history: HistoryFeed
}

export function DashboardSection({
  scan,
  scanning,
  rescan,
  onNavigate,
  history,
}: DashboardSectionProps) {
  const t = useT()
  const d = t.dashboard
  const detections = useAppStore((s) => s.detections)
  const latestVersions = useAppStore((s) => s.latestVersions)
  const cliManagers = useAppStore((s) => s.cliManagers)
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const { run } = useRunnerCtx()
  // `isTauri()` is false in the pre-rendered HTML but true inside the desktop
  // webview; gate the runtime-only branch on mount so the first client render
  // matches the server and we don't trip a hydration mismatch.
  const mounted = useMounted()

  const runThen = (steps: Parameters<typeof run>[0]) => {
    if (steps.length === 0) return
    // `review: true` opens the confirm gate and returns *before* the steps run,
    // so we must not rescan here. The central afterRun hook (app-shell) re-scans
    // and re-detects once the reviewed steps actually execute.
    void run(steps)
  }

  const view = scan ?? emptyScan()
  const os = effectiveOS()

  // First scan hasn't landed yet (desktop only): show skeletons instead of a
  // misleading "nothing here" while the disk read is in flight.
  const runtimeResolved = mounted
  const desktopAvailable = runtimeResolved && isTauri()
  const loading = desktopAvailable && !scan
  const busy = scanning || loading

  const mcpEntries = mergeEntries([
    { target: "claude", ids: view.claudeMcps },
    { target: "codex", ids: view.codexMcps },
    { target: "opencode", ids: view.opencodeMcps },
  ])
  const skillEntries = mergeEntries([
    { target: "claude", ids: view.claudeSkills },
    { target: "codex", ids: view.codexSkills },
  ])

  // At-a-glance counts for the overview strip — derived from the same merged
  // lists the cards render, so a tile and its card can never disagree.
  const allTools = [...CLI_TOOLS, ...RUNTIMES]
  const installedTools = allTools.filter((tool) => detections[tool.id]?.installed).length
  const relayConfigured = !!(view.relay.baseUrl || view.relay.hasToken || view.hasCodexRelay)

  // Everything that needs the user's attention, leading the page. Derived from
  // the scan + detections + the startup probe by one pure function — no extra
  // probing, and no branch of it can reach the disk. See lib/agentpack/diagnostics.
  const probe = useAppStore((s) => s.networkProbe)
  const activity = useAppStore((s) => s.activity)
  const diagnostics = buildDiagnostics(t, {
    scan,
    detections,
    latestVersions,
    cliManagers,
    networkProbe: probe,
    paths,
    os,
  })
  const baseMeasured = desktopAvailable && !loading
  const scanMeasured = baseMeasured && !view.degraded
  const metricValue = (value: React.ReactNode, measured = baseMeasured) => (measured ? value : "—")
  const metricDetail = (fallback: React.ReactNode, measured = baseMeasured) => {
    if (!runtimeResolved) return d.runtimeChecking
    if (!desktopAvailable) return d.notMeasured
    if (loading) return d.scanning
    if (!measured) return d.partialScan
    return fallback
  }
  const inventoryUnavailable = !desktopAvailable
    ? runtimeResolved
      ? d.notMeasured
      : d.runtimeChecking
    : null

  /**
   * One item, one action. Every branch that writes goes back through `run`,
   * which stages it for review — the to-do list is a shortcut to the change,
   * never a shortcut past the gate.
   */
  const actOn = (item: DiagnosticItem) => {
    const a = item.action.run
    switch (a.kind) {
      case "rescan":
        return void rescan()
      case "openOnboarding":
        return setOnboardingOpen(true)
      case "navigate":
        return onNavigate(item.destination)
      case "restoreFile":
        return runThen([fileRestoreStep(a.path, t)])
      case "upgradeCli": {
        const tool = CLI_TOOLS.find((c) => c.id === a.id)
        const cmd = tool && upgradeCommandFor(tool, os, cliManagers[a.id])
        if (!tool || !cmd) return onNavigate(item.destination)
        return runThen([cliInstallStep(tool.id, cmd, true, t)])
      }
    }
  }

  // The quick-start card is a safety net for anyone who skipped the welcome
  // wizard: shown until they've set up an assistant (Claude Code / Codex) or
  // explicitly hide it via "don't show again". It reopens the same wizard.
  const noAgentCli = !detections["claude-code"]?.installed && !detections["codex"]?.installed
  const showQuickStart = !settings.quickStartDismissed && noAgentCli
  const dismissQuickStart = () => {
    setSettings({ quickStartDismissed: true })
    void saveSettings({ quickStartDismissed: true })
  }

  return (
    <CapabilityWorkbench
      title={d.title}
      subtitle={d.subtitle}
      summaryLabel={d.statusSummary}
      actionsLabel={d.supporting}
      actions={
        desktopAvailable ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void rescan()}
            disabled={busy}
          >
            <RefreshCw className={cn("size-4", busy && "animate-spin")} />
            {busy ? d.scanning : d.refresh}
          </Button>
        ) : undefined
      }
      metrics={
        <>
          <CapabilityMetric
            label={d.overviewAttention}
            value={metricValue(diagnostics.length)}
            detail={metricDetail(
              diagnostics.length === 0
                ? d.healthAllGood
                : d.healthNeedsAttention(diagnostics.length)
            )}
          />
          <CapabilityMetric
            label={d.overviewTools}
            value={metricValue(`${installedTools} / ${allTools.length}`)}
            detail={metricDetail(d.sectionClis)}
          />
          <CapabilityMetric
            label={d.overviewMcp}
            value={metricValue(mcpEntries.length, scanMeasured)}
            detail={metricDetail(d.sectionMcp, scanMeasured)}
          />
          <CapabilityMetric
            label={d.overviewSkills}
            value={metricValue(skillEntries.length, scanMeasured)}
            detail={metricDetail(d.sectionSkills, scanMeasured)}
          />
          <CapabilityMetric
            label={d.overviewProviders}
            value={metricValue(view.providers.length, scanMeasured)}
            detail={metricDetail(d.sectionCcswitch, scanMeasured)}
          />
          <CapabilityMetric
            label={d.overviewRelay}
            value={metricValue(relayConfigured ? d.relayConfigured : d.relayNone, scanMeasured)}
            detail={metricDetail(d.sectionRelay, scanMeasured)}
          />
        </>
      }
      primary={
        <div className="flex min-w-0 flex-col gap-4">
          {runtimeResolved && !desktopAvailable ? (
            <DesktopOnlyNote>{d.notTauri}</DesktopOnlyNote>
          ) : null}

          <DiagnosticsList
            items={diagnostics}
            loading={loading}
            available={desktopAvailable}
            onAct={actOn}
          />

          {showQuickStart ? (
            <QuickStartCard
              q={t.quickStart}
              networkBlocked={!!probe && !probe.directOk && !probe.bestProxy}
              onOpen={() => setOnboardingOpen(true)}
              onNetwork={() => onNavigate("network")}
              onDismiss={dismissQuickStart}
            />
          ) : null}

          <section
            aria-label={d.systemInventory}
            className="min-w-0 overflow-hidden rounded-lg border"
          >
            <div className="border-b px-4 py-3">
              <h3 className="font-medium">{d.systemInventory}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{d.systemInventoryHint}</p>
            </div>

            <InventoryBlock icon={Terminal} title={d.sectionClis} className="border-b">
              {inventoryUnavailable ? (
                <p className="text-sm text-muted-foreground">{inventoryUnavailable}</p>
              ) : (
                <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-2 sm:gap-x-6">
                  {allTools.map((tool) => {
                    const det = detections[tool.id]
                    const latest = latestVersions[tool.id]
                    const installed = det?.installed
                    const isCli = CLI_TOOLS.some((c) => c.id === tool.id)
                    const hasUpdate = !!installed && isUpgradeAvailable(det?.version, latest)
                    const title =
                      (isCli ? t.catalog.cli[tool.id] : t.catalog.runtime[tool.id])?.title ??
                      tool.id
                    const version = extractSemver(det?.version) ?? det?.version
                    return (
                      <div
                        key={tool.id}
                        className="-mx-2 flex min-w-0 items-center gap-2 px-2 py-1.5 text-sm"
                      >
                        <StatusDot on={!!installed} />
                        <span className="truncate font-medium">{title}</span>
                        <Badge
                          variant={installed ? "secondary" : "outline"}
                          className="min-w-0 shrink font-normal text-ellipsis"
                        >
                          {installed
                            ? `${t.envcheck.installed}${version ? ` · ${version}` : ""}`
                            : t.envcheck.notFound}
                        </Badge>
                        {hasUpdate ? (
                          <Badge variant="default" className="shrink-0 font-normal">
                            {d.updateAvailable(latest)}
                          </Badge>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </InventoryBlock>

            <div className="grid min-w-0 md:grid-cols-2">
              <InventoryBlock icon={Server} title={d.sectionMcp} className="border-b md:border-r">
                <OverviewList
                  entries={mcpEntries}
                  loading={loading}
                  unavailable={inventoryUnavailable}
                  d={d}
                  onViewAll={() => onNavigate("mcp")}
                />
              </InventoryBlock>
              <InventoryBlock icon={Wrench} title={d.sectionSkills} className="border-b">
                <OverviewList
                  entries={skillEntries}
                  loading={loading}
                  unavailable={inventoryUnavailable}
                  d={d}
                  onViewAll={() => onNavigate("skills")}
                />
              </InventoryBlock>
              <InventoryBlock
                icon={ArrowLeftRight}
                title={d.sectionCcswitch}
                className="border-b md:border-r md:border-b-0"
              >
                {inventoryUnavailable ? (
                  <p className="text-sm text-muted-foreground">{inventoryUnavailable}</p>
                ) : loading ? (
                  <SkeletonRows rows={3} />
                ) : view.providers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{d.none}</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-0.5">
                      {view.providers.slice(0, OVERVIEW_LIMIT).map((p) => (
                        <div
                          key={p.id}
                          className="-mx-2 flex min-w-0 items-center justify-between gap-2 px-2 py-1 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <StatusDot on={p.is_current} />
                            <span className="truncate font-medium">{p.name}</span>
                            <span className="sr-only">
                              {p.is_current ? d.currentProvider : d.inactiveProvider}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            {p.app_type}
                          </span>
                        </div>
                      ))}
                    </div>
                    <ViewAll
                      label={d.viewAll(view.providers.length)}
                      onClick={() => onNavigate("ccswitch")}
                    />
                  </>
                )}
              </InventoryBlock>
              <InventoryBlock icon={Globe} title={d.sectionRelay}>
                {inventoryUnavailable ? (
                  <p className="text-sm text-muted-foreground">{inventoryUnavailable}</p>
                ) : loading ? (
                  <SkeletonRows rows={1} />
                ) : (
                  <div className="flex min-w-0 items-start gap-2 text-sm">
                    <StatusDot on={relayConfigured} />
                    {relayConfigured ? (
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium">{d.relayConfigured}</span>
                        {view.relay.baseUrl ? (
                          <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                            {d.relayBaseUrl(view.relay.baseUrl)}
                          </span>
                        ) : null}
                        {view.relay.hasToken ? (
                          <span className="text-xs text-muted-foreground">{d.relayToken}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{d.relayNone}</span>
                    )}
                  </div>
                )}
              </InventoryBlock>
            </div>
          </section>
        </div>
      }
      aside={
        <>
          <SpendCard history={history} onNavigate={onNavigate} />
          <ActivityCard
            records={activity}
            available={desktopAvailable}
            onOpenPanel={() => setPanelOpen(true)}
          />
        </>
      }
    />
  )
}

/** A newcomer's lingering guide, shown until an assistant is set up. */
function QuickStartCard({
  q,
  networkBlocked,
  onOpen,
  onNetwork,
  onDismiss,
}: {
  q: ReturnType<typeof useT>["quickStart"]
  /** The startup probe couldn't reach the internet directly and found no proxy. */
  networkBlocked: boolean
  onOpen: () => void
  onNetwork: () => void
  onDismiss: () => void
}) {
  const steps = [q.stepPick, q.stepPreview, q.stepInstall]
  return (
    <section aria-label={q.title} className="border-y py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h3 className="font-semibold">{q.title}</h3>
            <p className="text-sm text-muted-foreground">{q.intro}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onDismiss}>
          {q.dismiss}
        </Button>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step} className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-primary tabular-nums">0{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {/* Point a blocked machine at the fix before it watches an install fail. */}
      {networkBlocked ? (
        <button
          type="button"
          onClick={onNetwork}
          className="mt-3 self-start rounded-sm text-left text-sm text-[var(--hm-warn)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {q.networkBlocked}
        </button>
      ) : null}
      <div className="mt-3">
        <Button size="sm" className="gap-2" onClick={onOpen}>
          <Sparkles className="size-4" aria-hidden="true" />
          {q.openGuide}
        </Button>
      </div>
    </section>
  )
}

/** The small on/off dot shared by the CLI, provider and relay rows. */
function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        on ? "bg-[var(--hm-ok)]" : "bg-[var(--hm-neutral)]"
      )}
      aria-hidden="true"
    />
  )
}

/** Placeholder rows shown while the first disk scan is in flight. */
function SkeletonRows({ rows = 2 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  )
}

/** Footer link handing the user off to the section that owns the full list. */
function ViewAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-mx-2 mt-auto h-7 justify-start gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      {label}
      <ArrowRight className="size-3" aria-hidden="true" />
    </Button>
  )
}

/** A flat inventory subsection separated from its siblings by the parent rules. */
function InventoryBlock({
  icon: Icon,
  title,
  className,
  children,
}: {
  icon: LucideIcon
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("min-w-0 p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {children}
    </section>
  )
}

/** An MCP / skills summary list: the first few ids, then a link to the owner. */
function OverviewList({
  entries,
  loading,
  unavailable,
  d,
  onViewAll,
}: {
  entries: OverviewEntry[]
  loading: boolean
  unavailable: string | null
  d: ReturnType<typeof useT>["dashboard"]
  onViewAll: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {unavailable ? (
        <p className="text-sm text-muted-foreground">{unavailable}</p>
      ) : loading ? (
        <SkeletonRows rows={3} />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{d.none}</p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            {entries.slice(0, OVERVIEW_LIMIT).map((entry) => (
              <div
                key={entry.id}
                className="-mx-2 flex items-center justify-between gap-2 px-2 py-1 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{entry.id}</span>
                  {entry.custom ? (
                    <Badge variant="outline" className="shrink-0 font-normal">
                      {d.custom}
                    </Badge>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {entry.targets.join(" · ")}
                </span>
              </div>
            ))}
          </div>
          <ViewAll label={d.viewAll(entries.length)} onClick={onViewAll} />
        </>
      )}
    </div>
  )
}
