"use client"

import { useState } from "react"
import { ExternalLink, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  installMethodsFor,
  runtimePkgManager,
  runtimeUpgradeCommandFor,
  runtimesForOS,
} from "@/lib/agentpack/registry"
import { runtimeInstallStep, runtimeUpgradeStep } from "@/lib/agentpack/plan"
import { extractSemver } from "@/lib/agentpack/version"
import { openUrl } from "@/lib/tauri/system"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CapabilityTile, CapabilityWorkbench } from "./capability-workbench"
import { SectionStatus } from "./section-status"
import { HelpTip } from "../help-tip"
import { useRunnerCtx } from "../run/runner-context"
import { DesktopOnlyNote } from "../desktop-only-note"
import { useMounted } from "@/hooks/use-mounted"
import { isTauri } from "@/lib/tauri"

export function EnvironmentSection({ refresh }: { refresh?: () => Promise<void> }) {
  const t = useT()
  const detections = useAppStore((s) => s.detections)
  const runtimeOwned = useAppStore((s) => s.runtimeOwned)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const paths = useAppStore((s) => s.paths)
  const hostOS = paths?.os ?? effectiveOS()
  const runtimes = runtimesForOS(hostOS)
  const { run } = useRunnerCtx()
  // isTauri() is false in the pre-rendered HTML, so the note has to wait for
  // mount or it hydration-mismatches — same pairing as the dashboard.
  const mounted = useMounted()
  // Chosen install method per runtime (runtimes are installed directly, not via
  // the plan, so the choice is local UI state rather than store state).
  const [methodChoice, setMethodChoice] = useState<Record<string, string>>({})
  // A run auto-re-detects (the app-shell afterRun hook), but expose a manual
  // re-detect too — a freshly installed runtime that isn't yet on this process's
  // PATH, or an install done outside agentpack, only shows up after a fresh scan.
  const [refreshing, setRefreshing] = useState(false)
  const detectionsMeasured = runtimes.every((runtime) => detections[runtime.id] !== undefined)
  const installedCount = runtimes.filter((runtime) => detections[runtime.id]?.installed).length
  const missingCount = runtimes.filter(
    (runtime) => detections[runtime.id] && !detections[runtime.id]?.installed
  ).length
  const recheck = async () => {
    if (!refresh || refreshing) return
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const installNow = (rt: (typeof runtimes)[number]) => {
    const methods = installMethodsFor(rt, hostOS)
    const chosen = methods.find((m) => m.id === methodChoice[rt.id]) ?? methods[0]
    if (!chosen) return
    // The central afterRun hook re-detects runtimes once the install completes.
    void run([runtimeInstallStep(rt.id, chosen.command, t, chosen.requiresElevation)])
  }

  // Update an already-installed runtime in place. A no-op update (winget/brew
  // finds nothing newer) reports as "already up to date" rather than an error.
  const updateNow = (rt: (typeof runtimes)[number]) => {
    const cmd = runtimeUpgradeCommandFor(rt, hostOS)
    if (!cmd) return
    void run([runtimeUpgradeStep(rt.id, cmd, t)])
  }

  return (
    <CapabilityWorkbench
      title={t.environment.title}
      subtitle={t.environment.subtitle}
      help={<HelpTip text={t.help.runtime} />}
      actionsLabel={t.environment.actionsLabel}
      lead={
        <SectionStatus
          label={t.environment.summaryLabel}
          facts={[
            { label: t.environment.metricCatalog, value: runtimes.length },
            {
              label: t.environment.metricInstalled,
              value: detectionsMeasured ? installedCount : "—",
            },
            { label: t.environment.metricMissing, value: detectionsMeasured ? missingCount : "—" },
          ]}
          notes={[detectionsMeasured ? null : t.environment.metricPending]}
        />
      }
      primary={
        <section aria-label={t.environment.catalogPanel} className="min-w-0 rounded-lg border">
          {/* Same as the CLIs section: without detections every version below is
              blank, which looks like a broken page rather than a web-mode limit. */}
          {!isTauri() && mounted ? (
            <div className="border-b p-4">
              <DesktopOnlyNote>{t.environment.notTauri}</DesktopOnlyNote>
            </div>
          ) : null}
          <div className="divide-y">
            {runtimes.map((rt) => {
              const meta = t.catalog.runtime[rt.id]
              const d = detections[rt.id]
              const methods = installMethodsFor(rt, hostOS)
              const installable = methods.length > 0
              const updatable = !!runtimeUpgradeCommandFor(rt, hostOS)
              const selectedMethodId = methodChoice[rt.id] ?? methods[0]?.id
              const selectedMethod = methods.find((m) => m.id === selectedMethodId)
              const windowsBuildUnsupported =
                hostOS === "win" &&
                rt.minWindowsBuild !== undefined &&
                paths?.windowsBuild !== undefined &&
                paths.windowsBuild !== null &&
                paths.windowsBuild < rt.minWindowsBuild
              // Offer a chooser only for missing runtimes that have >1 channel.
              const showMethodPicker =
                !!d && !d.installed && methods.length > 1 && !windowsBuildUnsupported
              // A winget/brew-managed runtime the manager DOESN'T own can't be updated
              // or reinstalled in place — offer its official download page instead.
              // Only once ownership is a confirmed `false` (unknown/pending keeps the
              // normal actions; the runner still warns if winget can't update).
              const pm = runtimePkgManager(rt, hostOS)
              const notManaged = !!pm && runtimeOwned[rt.id] === false && !!rt.downloadUrl
              return (
                <div key={rt.id} className="min-w-0 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-48 flex-1">
                      <span className="font-medium">{meta?.title ?? rt.id}</span>
                      <p className="text-sm text-muted-foreground">{meta?.description}</p>
                    </div>
                    {d ? (
                      d.installed ? (
                        <>
                          <Badge
                            variant="secondary"
                            className="min-w-0 shrink font-normal text-ellipsis"
                          >
                            {t.envcheck.installed}
                            {d.version ? ` · ${extractSemver(d.version) ?? d.version}` : ""}
                          </Badge>
                          {windowsBuildUnsupported ? null : notManaged ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => void openUrl(rt.downloadUrl!)}
                            >
                              {t.shell.downloadLatest}
                              <ExternalLink className="size-3.5" />
                            </Button>
                          ) : (
                            <>
                              {updatable ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void updateNow(rt)}
                                >
                                  {t.shell.update}
                                </Button>
                              ) : null}
                              {installable ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void installNow(rt)}
                                >
                                  {t.shell.reinstall}
                                </Button>
                              ) : null}
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <Badge
                            variant="outline"
                            className="shrink-0 font-normal text-muted-foreground"
                          >
                            {t.envcheck.notFound}
                          </Badge>
                          {installable && !windowsBuildUnsupported ? (
                            <Button variant="outline" size="sm" onClick={() => void installNow(rt)}>
                              {t.shell.installNow}
                            </Button>
                          ) : null}
                        </>
                      )
                    ) : null}
                  </div>
                  {showMethodPicker ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.shell.installMethod}
                        </span>
                        <Select
                          value={selectedMethodId}
                          onValueChange={(v) =>
                            setMethodChoice((prev) => ({ ...prev, [rt.id]: v }))
                          }
                        >
                          <SelectTrigger className="h-8 w-full min-w-0 sm:w-[220px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {methods.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {t.catalog.methods[m.id]?.title ?? m.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {selectedMethod ? (
                        <p className="text-xs text-muted-foreground">
                          {t.catalog.methods[selectedMethod.id]?.description}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {d && !d.installed && !installable ? (
                    <p className="text-xs text-muted-foreground">
                      {rt.manualNote ?? t.environment.noInstaller}
                    </p>
                  ) : null}
                  {d && windowsBuildUnsupported ? (
                    <p className="text-xs text-muted-foreground">
                      {t.environment.windowsBuildRequired(rt.minWindowsBuild!)}
                    </p>
                  ) : null}
                  {notManaged && pm && !windowsBuildUnsupported ? (
                    <p className="text-xs text-muted-foreground">
                      {t.environment.notManaged(pm.manager)}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      }
      aside={
        <CapabilityTile
          title={t.environment.detectionTitle}
          description={t.environment.installHint}
          action={
            refresh ? (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-2"
                onClick={() => void recheck()}
                disabled={refreshing}
              >
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
                {refreshing ? t.environment.detecting : t.environment.recheck}
              </Button>
            ) : null
          }
        />
      }
    />
  )
}
