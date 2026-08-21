/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: Workbench · design-system: design.md · contrast: pass (40–41) · slop: pass (42–49) · mobile: pass (34, 49, 50–57) */
"use client"

import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Globe,
  Info,
  Loader2,
  MonitorDown,
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
import {
  buildDiagnostics,
  type DiagnosticItem,
  type DiagnosticSeverity,
} from "@/lib/agentpack/diagnostics"
import { useLocale, useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import type { SectionKey } from "../sidebar-nav"
import { useRunnerCtx } from "../run/runner-context"
import { CapabilityWorkbench } from "./capability-workbench"

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
   * When this reading was taken (epoch ms). It belongs to the scan rather than
   * to the component that draws it: the overview says "everything looks good"
   * off a snapshot, and a verdict with no date on it reads as a live one.
   */
  at: number
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
  at: 0,
  degraded: false,
})

/**
 * How many entries an overview card shows before it defers to its own section.
 * The dashboard is a summary with entry points, not a second copy of the MCP /
 * Skills / cc-switch managers — capping the lists is what keeps every card a
 * predictable height and the page down to a single scrollbar.
 */
const OVERVIEW_LIMIT = 5

/**
 * The tools block runs two-up, so its cap is a whole number of rows — five
 * entries in a two-column grid leaves a hole where the sixth would be.
 */
const TOOLS_LIMIT = 8

/**
 * What a value the app has not measured renders as. An em dash and not a zero,
 * because a zero is a claim about the machine — see design.md § Voice.
 */
const UNMEASURED = "—"

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
    at: Date.now(),
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
  const { lang } = useLocale()
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

  // At-a-glance counts for the status band — derived from the same merged lists
  // the inventory renders, so a readout and its block can never disagree. The
  // tools block lists what is *present*; the absent ones are a number, not
  // fourteen "Not found" rows on a machine that only ever wanted two of them.
  const allTools = [...CLI_TOOLS, ...RUNTIMES]
  const presentTools = allTools.filter((tool) => detections[tool.id]?.installed)
  const installedTools = presentTools.length
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
  /** An unmeasured value is an em dash — never a plausible-looking zero. */
  const readout = (value: string | number, measured = baseMeasured) =>
    measured ? String(value) : UNMEASURED

  /**
   * How old the reading on screen is. A rescan says so instead of leaving
   * yesterday's clock time under a verdict it is in the middle of replacing.
   */
  const metaLine = scanning
    ? d.scanning
    : view.degraded
      ? d.partialScan
      : scan
        ? d.scannedAt(clockTime(scan.at, lang))
        : undefined

  /**
   * The one verdict the page leads with, and the single place the em dashes are
   * explained. The reason used to be repeated under all six readouts and again
   * in every inventory block — eleven copies of one sentence, which is how the
   * line that actually mattered stopped being read.
   */
  const status: { tone: BandTone; headline: string; detail?: string; meta?: string } =
    !runtimeResolved
      ? { tone: "pending", headline: d.runtimeChecking }
      : !desktopAvailable
        ? { tone: "web", headline: d.notMeasured, detail: d.notTauri }
        : loading
          ? { tone: "pending", headline: d.scanning }
          : diagnostics.length === 0
            ? {
                tone: "ok",
                headline: d.healthAllGood,
                detail: d.healthAllGoodHint,
                meta: metaLine,
              }
            : {
                tone: diagnostics[0].severity,
                headline: d.healthNeedsAttention(diagnostics.length),
                detail: d.healthNeedsAttentionHint,
                meta: metaLine,
              }

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
      lead={
        <StatusBand
          label={d.statusSummary}
          tone={status.tone}
          headline={status.headline}
          detail={status.detail}
          meta={status.meta}
        >
          <StatReadout
            label={d.overviewTools}
            value={readout(`${installedTools} / ${allTools.length}`)}
            destination={d.sectionClis}
            onClick={() => onNavigate("clis")}
          />
          <StatReadout
            label={d.overviewMcp}
            value={readout(mcpEntries.length, scanMeasured)}
            destination={d.sectionMcp}
            onClick={() => onNavigate("mcp")}
          />
          <StatReadout
            label={d.overviewSkills}
            value={readout(skillEntries.length, scanMeasured)}
            destination={d.sectionSkills}
            onClick={() => onNavigate("skills")}
          />
          <StatReadout
            label={d.overviewProviders}
            value={readout(view.providers.length, scanMeasured)}
            destination={d.sectionCcswitch}
            onClick={() => onNavigate("ccswitch")}
          />
          <StatReadout
            label={d.overviewRelay}
            value={readout(relayConfigured ? d.relayConfigured : d.relayNone, scanMeasured)}
            destination={d.sectionRelay}
            onClick={() => onNavigate("ccswitch")}
          />
        </StatusBand>
      }
      primary={
        <div className="flex min-w-0 flex-col gap-4">
          <DiagnosticsList items={diagnostics} onAct={actOn} />

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
            className="min-w-0 overflow-hidden rounded-[var(--hm-radius-surface)] border"
          >
            <h3 className="border-b px-4 py-2.5 font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
              {d.systemInventory}
            </h3>

            <InventoryBlock icon={Terminal} title={d.sectionClis} className="border-b">
              {/* Detections come from the store, not the disk scan, so this
                  block never waits on it — it falls back to skeletons only
                  while it has nothing of its own to show yet. */}
              {!desktopAvailable ? (
                <Unmeasured />
              ) : presentTools.length === 0 ? (
                loading ? (
                  <SkeletonRows rows={3} />
                ) : (
                  <p className="text-sm text-muted-foreground">{d.none}</p>
                )
              ) : (
                <>
                  <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-2 sm:gap-x-6">
                    {presentTools.slice(0, TOOLS_LIMIT).map((tool) => {
                      const det = detections[tool.id]
                      const latest = latestVersions[tool.id]
                      const isCli = CLI_TOOLS.some((c) => c.id === tool.id)
                      const hasUpdate = isUpgradeAvailable(det?.version, latest)
                      const title =
                        (isCli ? t.catalog.cli[tool.id] : t.catalog.runtime[tool.id])?.title ??
                        tool.id
                      const version = extractSemver(det?.version) ?? det?.version
                      return (
                        <div
                          key={tool.id}
                          className="-mx-2 flex min-w-0 items-center justify-between gap-2 px-2 py-1 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <StatusDot on />
                            <span className="truncate font-medium">{title}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {hasUpdate ? (
                              <Badge variant="secondary" className="font-normal">
                                {d.updateAvailable(latest)}
                              </Badge>
                            ) : null}
                            <span className="font-mono text-[var(--hm-text-2xs)] text-muted-foreground">
                              {version ?? t.envcheck.installed}
                            </span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  <ViewAll label={d.viewAll(installedTools)} onClick={() => onNavigate("clis")} />
                </>
              )}
            </InventoryBlock>

            <div className="grid min-w-0 md:grid-cols-2">
              <InventoryBlock icon={Server} title={d.sectionMcp} className="border-b md:border-r">
                <OverviewList
                  entries={mcpEntries}
                  loading={loading}
                  measured={desktopAvailable}
                  d={d}
                  onViewAll={() => onNavigate("mcp")}
                />
              </InventoryBlock>
              <InventoryBlock icon={Wrench} title={d.sectionSkills} className="border-b">
                <OverviewList
                  entries={skillEntries}
                  loading={loading}
                  measured={desktopAvailable}
                  d={d}
                  onViewAll={() => onNavigate("skills")}
                />
              </InventoryBlock>
              <InventoryBlock
                icon={ArrowLeftRight}
                title={d.sectionCcswitch}
                className="border-b md:border-r md:border-b-0"
              >
                {loading ? (
                  <SkeletonRows rows={3} />
                ) : !desktopAvailable ? (
                  <Unmeasured />
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
                          <span className="shrink-0 font-mono text-[var(--hm-text-2xs)] text-muted-foreground">
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
                {loading ? (
                  <SkeletonRows rows={1} />
                ) : !desktopAvailable ? (
                  <Unmeasured />
                ) : (
                  <div className="flex min-w-0 items-start gap-2 text-sm">
                    <span className="flex h-5 shrink-0 items-center">
                      <StatusDot on={relayConfigured} />
                    </span>
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

/**
 * What the band can be saying. The three diagnostic severities are passed
 * straight through, so the mark above the verdict is the same mark the worst
 * row below it carries — the page reads top-down as one statement.
 */
type BandTone = DiagnosticSeverity | "ok" | "pending" | "web"

const BAND_TONE: Record<BandTone, { icon: LucideIcon; className: string; spin?: boolean }> = {
  ok: { icon: CheckCircle2, className: "text-[var(--hm-ok)]" },
  critical: { icon: CircleAlert, className: "text-[var(--hm-danger)]" },
  warning: { icon: AlertTriangle, className: "text-[var(--hm-warn)]" },
  info: { icon: Info, className: "text-[var(--hm-ink-3)]" },
  pending: { icon: Loader2, className: "text-muted-foreground", spin: true },
  web: { icon: MonitorDown, className: "text-muted-foreground" },
}

/** Local wall-clock time, in the viewer's own locale and zone. */
function clockTime(at: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { timeStyle: "short" }).format(new Date(at))
  } catch {
    return new Date(at).toISOString()
  }
}

/**
 * The overview's lead: one verdict, and the counts behind it.
 *
 * This replaced a row of six identical stat tiles. Six equal boxes say six
 * equally important things, and only one of them was — whether this machine
 * needs the user to do anything. So the verdict is set at display size with the
 * severity mark it inherits from the worst finding, and the counts drop to a
 * quiet readout strip under a rule: still there, still exact, no longer
 * competing. Each readout is the way into the section that owns it.
 */
function StatusBand({
  label,
  tone,
  headline,
  detail,
  meta,
  children,
}: {
  label: string
  tone: BandTone
  headline: string
  detail?: string
  /** One line of mono meta — when it was scanned, or why it wasn't. */
  meta?: string
  children: React.ReactNode
}) {
  const { icon: Icon, className, spin } = BAND_TONE[tone]
  return (
    <section
      aria-label={label}
      className="min-w-0 overflow-hidden rounded-[var(--hm-radius-surface)] border"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            className={cn("mt-1 size-5 shrink-0", className, spin && "animate-spin")}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
              {headline}
            </h3>
            {detail ? (
              <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {detail}
              </p>
            ) : null}
          </div>
        </div>
        {meta ? (
          <p className="font-mono text-[var(--hm-text-2xs)] text-muted-foreground">{meta}</p>
        ) : null}
      </div>
      {/* A grid, not a wrapping flex row: at 375px the readouts fall to two
          columns that still line up, where flex-1 left them ragged. */}
      <div className="grid min-w-0 grid-cols-2 gap-1 border-t px-3 py-2 sm:grid-cols-3 lg:grid-cols-5">
        {children}
      </div>
    </section>
  )
}

/** One count in the band's readout strip, and the way into its section. */
function StatReadout({
  label,
  value,
  destination,
  onClick,
}: {
  label: string
  value: string
  /** The section this opens, named in full for the accessible label. */
  destination: string
  onClick: () => void
}) {
  const d = useT().dashboard
  return (
    <button
      type="button"
      // Read out, the visible text is five numbers with nowhere to go: an
      // eyebrow, a figure, no hint that pressing it navigates or where to. The
      // em dash gets a word, or the label speaks as "Tools, dash, dash, open…".
      aria-label={d.readoutAction(
        label,
        value === UNMEASURED ? d.readoutUnknown : value,
        destination
      )}
      onClick={onClick}
      className="flex min-w-0 flex-col items-start gap-0.5 rounded-[var(--hm-radius-control)] px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <span className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="min-w-0 font-mono text-base font-semibold tabular-nums [overflow-wrap:anywhere]">
        {value}
      </span>
    </button>
  )
}

/**
 * A block the app has not measured. Bare, because the reason is stated once in
 * the band above rather than eleven times down the page — the em dash is the
 * same "no number was invented here" mark the readouts use.
 */
function Unmeasured() {
  return <p className="font-mono text-sm text-muted-foreground">{UNMEASURED}</p>
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
    <section aria-label={q.title} className="min-w-0 rounded-[var(--hm-radius-surface)] border p-4">
      {/* Dismiss sits with the primary action, not opposite the title: in the
          8-column workspace a button up there squeezed the intro onto two
          lines and left one word alone on the second. */}
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="font-medium">{q.title}</h3>
          <p className="text-sm text-muted-foreground">{q.intro}</p>
        </div>
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
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" className="gap-2" onClick={onOpen}>
          <Sparkles className="size-4" aria-hidden="true" />
          {q.openGuide}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {q.dismiss}
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
  measured,
  d,
  onViewAll,
}: {
  entries: OverviewEntry[]
  loading: boolean
  /** False in web mode, where nothing was read off a machine. */
  measured: boolean
  d: ReturnType<typeof useT>["dashboard"]
  onViewAll: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!measured ? (
        <Unmeasured />
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
