"use client"

import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  FileJson,
  Globe,
  RefreshCw,
  Server,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { CLI_TOOLS, RUNTIMES, findCli, upgradeCommandFor } from "@/lib/agentpack/registry"
import {
  cliInstallStep,
  cliUninstallStep,
  fileRestoreStep,
  mcpRemoveStep,
  relayRemoveStep,
  skillRemoveStep,
  visibleAppsStep,
  providerStep,
  BACKUP_SUFFIX,
} from "@/lib/agentpack/plan"
import { isUpgradeAvailable } from "@/lib/agentpack/version"
import { DEFAULT_VISIBLE_APPS } from "@/lib/agentpack/ccswitch/settings"
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
import type { AgentTarget, CliTool, Paths } from "@/lib/agentpack/types"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import { isTauri } from "@/lib/tauri"
import { saveSettings } from "@/lib/tauri/settings"
import { useMounted } from "@/hooks/use-mounted"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
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
})

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
    readTextFile(paths.claudeSettings).catch(() => ""),
    // User-scope MCP servers live in ~/.claude.json; read it directly instead of
    // the ~45s health-checking `claude mcp list`, which also risks hanging.
    readTextFile(paths.claudeConfig).catch(() => ""),
    readTextFile(paths.codexConfig).catch(() => ""),
    readTextFile(paths.opencodeConfig).catch(() => ""),
    listSkills(paths.claudeSkillsDir).catch(() => [] as string[]),
    listSkills(paths.codexSkillsDir).catch(() => [] as string[]),
    ccLoadProviders().catch(() => [] as Provider[]),
    pathExists(`${paths.codexConfig}${BACKUP_SUFFIX}`).catch(() => false),
  ])

  const codex = parseCodexConfig(codexToml)
  const claudeBak = await pathExists(`${paths.claudeSettings}${BACKUP_SUFFIX}`).catch(() => false)

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
  }
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
}

export function DashboardSection({ scan, scanning, rescan }: DashboardSectionProps) {
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
    void run(steps, { review: true })
  }

  const view = scan ?? emptyScan()
  const os = effectiveOS()

  // First scan hasn't landed yet (desktop only): show skeletons instead of a
  // misleading "nothing here" while the disk read is in flight.
  const loading = mounted && isTauri() && !scan
  const busy = scanning || loading

  // At-a-glance counts for the overview strip.
  const allTools = [...CLI_TOOLS, ...RUNTIMES]
  const installedTools = allTools.filter((tool) => detections[tool.id]?.installed).length
  const mcpCount = new Set([
    ...view.claudeMcps.known,
    ...view.claudeMcps.custom,
    ...view.codexMcps.known,
    ...view.codexMcps.custom,
    ...view.opencodeMcps.known,
    ...view.opencodeMcps.custom,
  ]).size
  const skillCount = new Set([
    ...view.claudeSkills.known,
    ...view.claudeSkills.custom,
    ...view.codexSkills.known,
    ...view.codexSkills.custom,
  ]).size
  const relayConfigured = !!(view.relay.baseUrl || view.relay.hasToken || view.hasCodexRelay)

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
    <SectionShell title={d.title} subtitle={d.subtitle} wide>
      {showQuickStart ? (
        <QuickStartCard
          q={t.quickStart}
          onOpen={() => setOnboardingOpen(true)}
          onDismiss={dismissQuickStart}
        />
      ) : null}

      {mounted && !isTauri() ? (
        <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {d.notTauri}
        </div>
      ) : null}

      {/* Overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={Terminal}
          label={d.overviewTools}
          value={`${installedTools}/${allTools.length}`}
          tint="sky"
        />
        <StatTile
          icon={Server}
          label={d.overviewMcp}
          value={mcpCount}
          loading={loading}
          tint="violet"
        />
        <StatTile
          icon={Wrench}
          label={d.overviewSkills}
          value={skillCount}
          loading={loading}
          tint="amber"
        />
        <StatTile
          icon={ArrowLeftRight}
          label={d.overviewProviders}
          value={view.providers.length}
          loading={loading}
          tint="emerald"
        />
      </div>

      <div className="flex items-center justify-end">
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
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* CLIs & runtimes — the primary card, spanning the full width. */}
        <Card className="flex flex-col gap-3 p-4 lg:col-span-2">
          <CardHead icon={Terminal} title={d.sectionClis} />
          <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-2 sm:gap-x-6">
            {allTools.map((tool) => {
              const det = detections[tool.id]
              const latest = latestVersions[tool.id]
              const installed = det?.installed
              const isCli = CLI_TOOLS.some((c) => c.id === tool.id)
              // Same semver-aware check as the CLIs section, so the two agree.
              const hasUpdate = !!installed && isUpgradeAvailable(det?.version, latest)
              const cli = findCli(tool.id)
              const upgradeCmd = cli ? upgradeCommandFor(cli, os, cliManagers[tool.id]) : undefined
              const title =
                (isCli ? t.catalog.cli[tool.id] : t.catalog.runtime[tool.id])?.title ?? tool.id
              return (
                <div
                  key={tool.id}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        installed ? "bg-emerald-500" : "bg-muted-foreground/40"
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">{title}</span>
                    <Badge variant={installed ? "secondary" : "outline"} className="font-normal">
                      {installed
                        ? `${t.envcheck.installed}${det?.version ? ` · ${det.version}` : ""}`
                        : t.envcheck.notFound}
                    </Badge>
                    {hasUpdate ? (
                      <Badge variant="default" className="font-normal">
                        {d.updateAvailable(latest)}
                      </Badge>
                    ) : null}
                  </div>
                  {isCli && installed ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {hasUpdate && upgradeCmd ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            runThen([cliInstallStep(tool.id as CliTool["id"], upgradeCmd, true, t)])
                          }
                        >
                          {t.shell.upgrade}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          runThen([
                            cliUninstallStep(
                              tool.id as CliTool["id"],
                              findCli(tool.id)?.uninstall?.[os],
                              t
                            ),
                          ])
                        }
                      >
                        {d.uninstall}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Card>

        {/* MCP servers */}
        <Card className="flex h-full min-h-[13rem] flex-col gap-3 p-4">
          <CardHead icon={Server} title={d.sectionMcp} />
          {loading ? (
            <SkeletonRows rows={3} />
          ) : (
            <ScrollList>
              <EntityList
                target="claude"
                ids={view.claudeMcps}
                onRemove={(id) => paths && void runThen(mcpRemoveStep(id, ["claude"], paths, t))}
                customLabel={d.custom}
                removeLabel={d.remove}
                emptyLabel={d.none}
              />
              <EntityList
                target="codex"
                ids={view.codexMcps}
                onRemove={(id) => paths && void runThen(mcpRemoveStep(id, ["codex"], paths, t))}
                customLabel={d.custom}
                removeLabel={d.remove}
                emptyLabel={d.none}
              />
            </ScrollList>
          )}
        </Card>

        {/* Skills */}
        <Card className="flex h-full min-h-[13rem] flex-col gap-3 p-4">
          <CardHead icon={Wrench} title={d.sectionSkills} />
          {loading ? (
            <SkeletonRows rows={3} />
          ) : (
            <ScrollList>
              <EntityList
                target="claude"
                ids={view.claudeSkills}
                onRemove={(id) =>
                  paths &&
                  void runThen([
                    skillRemoveStep(id, id, ["claude"], [`${paths.claudeSkillsDir}/${id}`], t),
                  ])
                }
                customLabel={d.custom}
                removeLabel={d.remove}
                emptyLabel={d.none}
              />
              <EntityList
                target="codex"
                ids={view.codexSkills}
                onRemove={(id) =>
                  paths &&
                  void runThen([
                    skillRemoveStep(id, id, ["codex"], [`${paths.codexSkillsDir}/${id}`], t),
                  ])
                }
                customLabel={d.custom}
                removeLabel={d.remove}
                emptyLabel={d.none}
              />
            </ScrollList>
          )}
        </Card>

        {/* Relay */}
        <Card className="flex h-full min-h-[13rem] flex-col gap-3 p-4">
          <CardHead
            icon={Globe}
            title={d.sectionRelay}
            action={
              relayConfigured ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    paths && void runThen(relayRemoveStep(["claude-code", "codex"], paths, t))
                  }
                >
                  {d.remove}
                </Button>
              ) : undefined
            }
          />
          {loading ? (
            <SkeletonRows rows={1} />
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  relayConfigured ? "bg-emerald-500" : "bg-muted-foreground/40"
                )}
                aria-hidden="true"
              />
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

        {/* cc-switch providers */}
        <Card className="flex h-full min-h-[13rem] flex-col gap-3 p-4">
          <CardHead
            icon={ArrowLeftRight}
            title={d.sectionCcswitch}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  paths &&
                  void runThen([visibleAppsStep(paths.ccSwitchSettings, DEFAULT_VISIBLE_APPS, t)])
                }
              >
                {t.shell.apply}
              </Button>
            }
          />
          {loading ? (
            <SkeletonRows rows={2} />
          ) : view.providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.none}</p>
          ) : (
            <div className="flex max-h-72 min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
              {view.providers.map((p) => (
                <div
                  key={p.id}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <Badge variant="outline" className="font-normal">
                      {p.app_type}
                    </Badge>
                    {p.is_current ? (
                      <Badge variant="secondary" className="font-normal">
                        {t.ccswitch.current}
                      </Badge>
                    ) : null}
                  </div>
                  {!p.is_current ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void runThen([
                          providerStep("delete", p.app_type, p.name, undefined, p.id, t),
                        ])
                      }
                    >
                      {d.remove}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Config file health */}
        <Card className="flex flex-col gap-3 p-4 lg:col-span-2">
          <CardHead icon={FileJson} title={d.sectionHealth} />
          {loading ? (
            <SkeletonRows rows={2} />
          ) : (
            <>
              <HealthRow
                label={d.fileClaudeSettings}
                health={view.claudeSettings}
                d={d}
                onRestore={() => paths && void runThen([fileRestoreStep(paths.claudeSettings, t)])}
              />
              <HealthRow
                label={d.fileCodexConfig}
                health={view.codexConfig}
                d={d}
                onRestore={() => paths && void runThen([fileRestoreStep(paths.codexConfig, t)])}
              />
            </>
          )}
        </Card>
      </div>
    </SectionShell>
  )
}

/** A newcomer's lingering guide, shown until an assistant is set up. */
function QuickStartCard({
  q,
  onOpen,
  onDismiss,
}: {
  q: ReturnType<typeof useT>["quickStart"]
  onOpen: () => void
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
      <div>
        <Button size="sm" className="gap-2" onClick={onOpen}>
          <Sparkles className="size-4" aria-hidden="true" />
          {q.openGuide}
        </Button>
      </div>
    </Card>
  )
}

const STAT_TINTS = {
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
} as const

/** Compact metric tile for the overview strip. */
function StatTile({
  icon: Icon,
  label,
  value,
  loading,
  tint,
}: {
  icon: LucideIcon
  label: string
  value: string | number
  loading?: boolean
  tint: keyof typeof STAT_TINTS
}) {
  return (
    <Card className="flex-row items-center gap-3 p-4 transition-shadow hover:shadow-sm">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          STAT_TINTS[tint]
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        {loading ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <span className="text-2xl leading-none font-semibold tabular-nums">{value}</span>
        )}
      </div>
    </Card>
  )
}

/** A card title with a matching icon badge and an optional trailing action. */
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
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <h3 className="font-medium">{title}</h3>
      </div>
      {action}
    </div>
  )
}

/**
 * Bounds a card's list region: it fills the card's flexible body (so every card
 * in a stretched grid row stays the same height) and long MCP/skill lists scroll
 * inside instead of pushing the card taller and unbalancing the grid.
 */
function ScrollList({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-h-72 min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {children}
    </div>
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

function EntityList({
  target,
  ids,
  onRemove,
  customLabel,
  removeLabel,
  emptyLabel,
}: {
  target: AgentTarget
  ids: ClassifiedIds
  onRemove: (id: string) => void
  customLabel: string
  removeLabel: string
  emptyLabel: string
}) {
  const all = [...ids.known, ...ids.custom]
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {target}
      </div>
      {all.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {all.map((id) => (
            <div
              key={id}
              className="group -mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/60"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{id}</span>
                {ids.custom.includes(id) ? (
                  <Badge variant="outline" className="font-normal">
                    {customLabel}
                  </Badge>
                ) : null}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`${removeLabel} ${id}`}
                onClick={() => onRemove(id)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HealthRow({
  label,
  health,
  d,
  onRestore,
}: {
  label: string
  health: FileHealth
  d: ReturnType<typeof useT>["dashboard"]
  onRestore: () => void
}) {
  const ok = health.status === "ok"
  const StatusIcon = ok ? CheckCircle2 : AlertTriangle
  const color = ok
    ? "text-emerald-600 dark:text-emerald-400"
    : health.status === "invalid"
      ? "text-destructive"
      : "text-amber-600 dark:text-amber-500"
  const statusLabel =
    health.status === "ok"
      ? d.configOk
      : health.status === "invalid"
        ? d.configInvalid
        : d.configMissing
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <StatusIcon className={cn("size-4 shrink-0", color)} aria-hidden="true" />
        <span className="truncate font-medium">{label}</span>
        <span className={cn("text-xs", color)}>{statusLabel}</span>
        {health.hasBackup ? (
          <Badge variant="outline" className="font-normal">
            {d.hasBackup}
          </Badge>
        ) : null}
      </div>
      {health.hasBackup ? (
        <Button variant="ghost" size="sm" onClick={onRestore}>
          {d.restore}
        </Button>
      ) : null}
    </div>
  )
}
