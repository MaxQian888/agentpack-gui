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
import { Card } from "@/components/ui/card"
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
import { ccLoadProviders, listSkills, pathExists, readTextFile } from "@/lib/tauri/commands"
import type { Paths } from "@/lib/agentpack/types"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import { isTauri } from "@/lib/tauri"
import { saveSettings } from "@/lib/tauri/settings"
import { useMounted } from "@/hooks/use-mounted"
import { SpendCard, type HistoryFeed } from "./dashboard-spend"
import { DiagnosticsList } from "./diagnostics-list"
import { ActivityCard } from "./activity-card"
import { buildDiagnostics, type DiagnosticItem } from "@/lib/agentpack/diagnostics"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import type { SectionKey } from "../sidebar-nav"
import { useRunnerCtx } from "../run/runner-context"

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

export async function scanEnvironment(paths: Paths): Promise<DashboardScan> {
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
    soft(ccLoadProviders(), [] as Provider[], false),
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
  const loading = mounted && isTauri() && !scan
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
    <SectionShell
      title={d.title}
      subtitle={d.subtitle}
      wide
      actions={
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
      }
    >
      {showQuickStart ? (
        <QuickStartCard
          q={t.quickStart}
          networkBlocked={!!probe && !probe.directOk && !probe.bestProxy}
          onOpen={() => setOnboardingOpen(true)}
          onNetwork={() => onNavigate("network")}
          onDismiss={dismissQuickStart}
        />
      ) : null}

      {mounted && !isTauri() ? (
        <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {d.notTauri}
        </div>
      ) : null}

      {/* The page leads with what needs doing. The four identical tinted stat
          tiles that used to sit here are gone: they ranked nothing, four
          colours competing for a glance said less than one ordered list, and
          the counts they held are already on the cards below. */}
      <DiagnosticsList
        items={diagnostics}
        loading={loading}
        available={!mounted || isTauri()}
        onAct={actOn}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Spend leads the grid: it is the only figure here the user cares
            about independently of setup, and it sits above the configuration
            cards so one screen answers both "what did this cost" and "what is
            installed". */}
        <SpendCard history={history} onNavigate={onNavigate} />

        <ActivityCard
          records={activity}
          available={!mounted || isTauri()}
          onOpenPanel={() => setPanelOpen(true)}
        />

        {/* CLIs & runtimes — read-only status; installs and removals live in
            the CLIs / Environment sections. */}
        <Card className="flex flex-col gap-3 p-4 sm:col-span-2 xl:col-span-3">
          <CardHead icon={Terminal} title={d.sectionClis} />
          <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-2 sm:gap-x-6">
            {allTools.map((tool) => {
              const det = detections[tool.id]
              const latest = latestVersions[tool.id]
              const installed = det?.installed
              const isCli = CLI_TOOLS.some((c) => c.id === tool.id)
              // Same semver-aware check as the CLIs section, so the two agree.
              const hasUpdate = !!installed && isUpgradeAvailable(det?.version, latest)
              const title =
                (isCli ? t.catalog.cli[tool.id] : t.catalog.runtime[tool.id])?.title ?? tool.id
              // `detect_cli` keeps the whole first line of `--version`, which for
              // uv/python is "uv 0.9.7 (3d9460278 2026-…)" — far too long for a
              // badge. Show the semver when there is one, the raw line when there
              // isn't, and let the badge ellipsize either way.
              const version = extractSemver(det?.version) ?? det?.version
              return (
                <div
                  key={tool.id}
                  className="-mx-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
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
        </Card>

        {/* MCP servers */}
        <OverviewCard
          icon={Server}
          title={d.sectionMcp}
          entries={mcpEntries}
          loading={loading}
          d={d}
          onViewAll={() => onNavigate("mcp")}
        />

        {/* Skills */}
        <OverviewCard
          icon={Wrench}
          title={d.sectionSkills}
          entries={skillEntries}
          loading={loading}
          d={d}
          onViewAll={() => onNavigate("skills")}
        />

        {/* cc-switch providers */}
        <Card className="flex flex-col gap-3 p-4">
          <CardHead icon={ArrowLeftRight} title={d.sectionCcswitch} />
          {loading ? (
            <SkeletonRows rows={3} />
          ) : view.providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.none}</p>
          ) : (
            <>
              <div className="flex flex-col gap-0.5">
                {view.providers.slice(0, OVERVIEW_LIMIT).map((p) => (
                  <div
                    key={p.id}
                    className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusDot on={p.is_current} />
                      <span className="truncate font-medium">{p.name}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{p.app_type}</span>
                  </div>
                ))}
              </div>
              <ViewAll
                label={d.viewAll(view.providers.length)}
                onClick={() => onNavigate("ccswitch")}
              />
            </>
          )}
        </Card>

        {/* Relay — one line; it used to be padded out to a full card height. */}
        <Card className="flex flex-col gap-3 p-4 sm:col-span-2 xl:col-span-3">
          <CardHead icon={Globe} title={d.sectionRelay} />
          {loading ? (
            <SkeletonRows rows={1} />
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <StatusDot on={relayConfigured} />
              {relayConfigured ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {d.relayConfigured}
                  </Badge>
                  {view.relay.baseUrl ? (
                    <span className="text-xs text-muted-foreground">
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
        </Card>
      </div>
    </SectionShell>
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
    <Card className="gap-3 overflow-hidden border-primary/25 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-semibold">{q.title}</h3>
            <p className="text-sm text-muted-foreground">{q.intro}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onDismiss}>
          {q.dismiss}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, i) => (
          <span
            key={step}
            className="inline-flex items-center gap-1.5 rounded-full bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"
          >
            <span className="flex size-4 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
              {i + 1}
            </span>
            {step}
          </span>
        ))}
      </div>
      {/* Point a blocked machine at the fix before it watches an install fail. */}
      {networkBlocked ? (
        <button
          type="button"
          onClick={onNetwork}
          className="self-start text-left text-sm text-amber-600 underline-offset-4 hover:underline dark:text-amber-400"
        >
          {q.networkBlocked}
        </button>
      ) : null}
      <div>
        <Button size="sm" className="gap-2" onClick={onOpen}>
          <Sparkles className="size-4" aria-hidden="true" />
          {q.openGuide}
        </Button>
      </div>
    </Card>
  )
}

/** The small on/off dot shared by the CLI, provider and relay rows. */
function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        on ? "bg-emerald-500" : "bg-muted-foreground/40"
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

/** A card's heading row: an icon in a well, the title, and an optional action. */
function CardHead({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {action}
    </div>
  )
}

/** An MCP / skills summary card: the first few ids, then a link to the rest. */
function OverviewCard({
  icon,
  title,
  entries,
  loading,
  d,
  onViewAll,
}: {
  icon: LucideIcon
  title: string
  entries: OverviewEntry[]
  loading: boolean
  d: ReturnType<typeof useT>["dashboard"]
  onViewAll: () => void
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <CardHead icon={icon} title={title} />
      {loading ? (
        <SkeletonRows rows={3} />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{d.none}</p>
      ) : (
        <>
          <div className="flex flex-col gap-0.5">
            {entries.slice(0, OVERVIEW_LIMIT).map((entry) => (
              <div
                key={entry.id}
                className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50"
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
    </Card>
  )
}
