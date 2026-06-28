"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CLI_TOOLS, RUNTIMES, findCli } from "@/lib/agentpack/registry"
import {
  cliUninstallStep,
  fileRestoreStep,
  mcpRemoveStep,
  relayRemoveStep,
  skillRemoveStep,
  visibleAppsStep,
  providerStep,
  BACKUP_SUFFIX,
} from "@/lib/agentpack/plan"
import { DEFAULT_VISIBLE_APPS } from "@/lib/agentpack/ccswitch/settings"
import {
  classifyAgainstRegistry,
  MCP_REGISTRY_IDS,
  parseClaudeMcpList,
  parseClaudeRelay,
  parseCodexConfig,
  SKILL_REGISTRY_IDS,
  type ClassifiedIds,
  type ClaudeRelayState,
} from "@/lib/agentpack/scan"
import {
  ccLoadProviders,
  listDir,
  pathExists,
  readTextFile,
  runCommand,
} from "@/lib/tauri/commands"
import type { AgentTarget, Paths } from "@/lib/agentpack/types"
import type { Provider } from "@/lib/agentpack/ccswitch/types"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { useRunnerCtx } from "../run/runner-context"

type FileStatus = "ok" | "invalid" | "missing"
interface FileHealth {
  status: FileStatus
  hasBackup: boolean
}

interface DashboardScan {
  claudeMcps: ClassifiedIds
  codexMcps: ClassifiedIds
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

/** Collect `claude mcp list` ids; empty when claude is absent / errors. */
async function scanClaudeMcps(): Promise<string[]> {
  try {
    const lines: string[] = []
    await runCommand({ file: "claude", args: ["mcp", "list"] }, (l) => lines.push(l))
    return parseClaudeMcpList(lines.join("\n"))
  } catch {
    return []
  }
}

async function scanEnvironment(paths: Paths): Promise<DashboardScan> {
  const [
    claudeJson,
    codexToml,
    claudeSkillNames,
    codexSkillNames,
    providers,
    claudeMcpIds,
    codexBak,
  ] = await Promise.all([
    readTextFile(paths.claudeSettings).catch(() => ""),
    readTextFile(paths.codexConfig).catch(() => ""),
    listDir(paths.claudeSkillsDir).catch(() => [] as string[]),
    listDir(paths.codexSkillsDir).catch(() => [] as string[]),
    ccLoadProviders().catch(() => [] as Provider[]),
    scanClaudeMcps(),
    pathExists(`${paths.codexConfig}${BACKUP_SUFFIX}`).catch(() => false),
  ])

  const codex = parseCodexConfig(codexToml)
  const claudeBak = await pathExists(`${paths.claudeSettings}${BACKUP_SUFFIX}`).catch(() => false)

  return {
    claudeMcps: classifyAgainstRegistry(claudeMcpIds, MCP_REGISTRY_IDS),
    codexMcps: classifyAgainstRegistry(codex.mcpServers, MCP_REGISTRY_IDS),
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

export function DashboardSection() {
  const t = useT()
  const d = t.dashboard
  const detections = useAppStore((s) => s.detections)
  const latestVersions = useAppStore((s) => s.latestVersions)
  const paths = useAppStore((s) => s.paths)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()
  const [scan, setScan] = useState<DashboardScan | null>(null)
  const [scanning, setScanning] = useState(false)

  const rescan = useCallback(async () => {
    if (!isTauri() || !paths) return
    setScanning(true)
    try {
      setScan(await scanEnvironment(paths))
    } finally {
      setScanning(false)
    }
  }, [paths])

  // Initial scan on mount / paths change. setState lives in the async
  // continuation (not the effect body) to avoid cascading-render warnings.
  useEffect(() => {
    if (!isTauri() || !paths) return
    let cancelled = false
    scanEnvironment(paths)
      .then((result) => {
        if (!cancelled) setScan(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [paths])

  const runThen = async (steps: Parameters<typeof run>[0]) => {
    if (steps.length === 0) return
    await run(steps, { review: true })
    await rescan()
  }

  const view = scan ?? emptyScan()
  const os = effectiveOS()

  return (
    <SectionShell title={d.title} subtitle={d.subtitle}>
      <div className="flex items-center justify-between">
        {!isTauri() ? (
          <p className="text-sm text-muted-foreground">{d.notTauri}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{scanning ? d.scanning : ""}</p>
        )}
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void rescan()}>
          <RefreshCw className="size-4" />
          {d.refresh}
        </Button>
      </div>

      {/* CLIs & runtimes */}
      <Card className="gap-3 p-4">
        <h3 className="font-medium">{d.sectionClis}</h3>
        <div className="flex flex-col gap-2">
          {[...CLI_TOOLS, ...RUNTIMES].map((tool) => {
            const det = detections[tool.id]
            const latest = latestVersions[tool.id]
            const installed = det?.installed
            const isCli = CLI_TOOLS.some((c) => c.id === tool.id)
            const hasUpdate = installed && latest && det?.version && !det.version.includes(latest)
            const title =
              (isCli ? t.catalog.cli[tool.id] : t.catalog.runtime[tool.id])?.title ?? tool.id
            return (
              <div key={tool.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{title}</span>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void runThen([
                        cliUninstallStep(
                          tool.id as "claude-code" | "codex" | "cc-switch",
                          findCli(tool.id)?.uninstall?.[os],
                          t
                        ),
                      ])
                    }
                  >
                    {d.uninstall}
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      {/* MCP servers */}
      <Card className="gap-3 p-4">
        <h3 className="font-medium">{d.sectionMcp}</h3>
        <McpList
          target="claude"
          ids={view.claudeMcps}
          onRemove={(id) => paths && void runThen(mcpRemoveStep(id, ["claude"], paths, t))}
          customLabel={d.custom}
          emptyLabel={d.none}
        />
        <McpList
          target="codex"
          ids={view.codexMcps}
          onRemove={(id) => paths && void runThen(mcpRemoveStep(id, ["codex"], paths, t))}
          customLabel={d.custom}
          emptyLabel={d.none}
        />
      </Card>

      {/* Skills */}
      <Card className="gap-3 p-4">
        <h3 className="font-medium">{d.sectionSkills}</h3>
        <SkillList
          target="claude"
          ids={view.claudeSkills}
          onRemove={(id) =>
            paths &&
            void runThen([
              skillRemoveStep(id, id, ["claude"], [`${paths.claudeSkillsDir}/${id}`], t),
            ])
          }
          customLabel={d.custom}
          emptyLabel={d.none}
        />
        <SkillList
          target="codex"
          ids={view.codexSkills}
          onRemove={(id) =>
            paths &&
            void runThen([skillRemoveStep(id, id, ["codex"], [`${paths.codexSkillsDir}/${id}`], t)])
          }
          customLabel={d.custom}
          emptyLabel={d.none}
        />
      </Card>

      {/* Relay */}
      <Card className="gap-3 p-4">
        <h3 className="font-medium">{d.sectionRelay}</h3>
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {view.relay.baseUrl || view.relay.hasToken || view.hasCodexRelay ? (
              <>
                <Badge variant="secondary" className="font-normal">
                  {d.relayConfigured}
                </Badge>
                {view.relay.baseUrl ? (
                  <span className="text-muted-foreground">
                    {d.relayBaseUrl(view.relay.baseUrl)}
                  </span>
                ) : null}
                {view.relay.hasToken ? (
                  <span className="text-muted-foreground">{d.relayToken}</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">{d.relayNone}</span>
            )}
          </div>
          {view.relay.baseUrl || view.relay.hasToken || view.hasCodexRelay ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                paths && void runThen(relayRemoveStep(["claude-code", "codex"], paths, t))
              }
            >
              {d.remove}
            </Button>
          ) : null}
        </div>
      </Card>

      {/* cc-switch providers */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">{d.sectionCcswitch}</h3>
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
        </div>
        {view.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.none}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {view.providers.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.app_type}</span>
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
                      void runThen([providerStep("delete", p.app_type, p.name, undefined, p.id, t)])
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
      <Card className="gap-3 p-4">
        <h3 className="font-medium">{d.sectionHealth}</h3>
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
      </Card>
    </SectionShell>
  )
}

function McpList({
  target,
  ids,
  onRemove,
  customLabel,
  emptyLabel,
}: {
  target: AgentTarget
  ids: ClassifiedIds
  onRemove: (id: string) => void
  customLabel: string
  emptyLabel: string
}) {
  const all = [...ids.known, ...ids.custom]
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{target}</div>
      {all.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {all.map((id) => (
            <div key={id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                {id}
                {ids.custom.includes(id) ? (
                  <Badge variant="outline" className="font-normal">
                    {customLabel}
                  </Badge>
                ) : null}
              </span>
              <Button variant="ghost" size="sm" onClick={() => onRemove(id)}>
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SkillList(props: {
  target: AgentTarget
  ids: ClassifiedIds
  onRemove: (id: string) => void
  customLabel: string
  emptyLabel: string
}) {
  return <McpList {...props} />
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
  const statusLabel =
    health.status === "ok"
      ? d.configOk
      : health.status === "invalid"
        ? d.configInvalid
        : d.configMissing
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">{label}</span>
        <Badge variant={health.status === "ok" ? "secondary" : "outline"} className="font-normal">
          {statusLabel}
        </Badge>
        {health.hasBackup ? <span className="text-muted-foreground">{d.hasBackup}</span> : null}
      </div>
      {health.hasBackup ? (
        <Button variant="ghost" size="sm" onClick={onRestore}>
          {d.restore}
        </Button>
      ) : null}
    </div>
  )
}
