"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CLI_TOOLS,
  clisByKind,
  installMethodsFor,
  upgradeCommandFor,
} from "@/lib/agentpack/registry"
import { cliInstallStep } from "@/lib/agentpack/plan"
import { extractSemver, isUpgradeAvailable, majorVersion } from "@/lib/agentpack/version"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { CapabilityTile, CapabilityWorkbench } from "./capability-workbench"
import { SectionStatus } from "./section-status"
import { HelpTip } from "../help-tip"
import { useRunnerCtx } from "../run/runner-context"
import { DesktopOnlyNote } from "../desktop-only-note"
import { useMounted } from "@/hooks/use-mounted"
import { isTauri } from "@/lib/tauri"

export function ClisSection({ onOpenRuntimes }: { onOpenRuntimes?: () => void } = {}) {
  const t = useT()
  const clis = useAppStore((s) => s.plan.clis)
  const cliMethods = useAppStore((s) => s.plan.cliMethods)
  const toggleCli = useAppStore((s) => s.toggleCli)
  const setCliMethod = useAppStore((s) => s.setCliMethod)
  const detections = useAppStore((s) => s.detections)
  const latestVersions = useAppStore((s) => s.latestVersions)
  const cliManagers = useAppStore((s) => s.cliManagers)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()
  // Paired with isTauri() because that's false in the pre-rendered HTML — see
  // the same guard on the dashboard. Without it the note hydration-mismatches.
  const mounted = useMounted()
  const detectionsMeasured = CLI_TOOLS.every((tool) => detections[tool.id] !== undefined)
  const installedCount = CLI_TOOLS.filter((tool) => detections[tool.id]?.installed).length
  const updateCount = CLI_TOOLS.filter((tool) => {
    const detected = detections[tool.id]
    return isUpgradeAvailable(detected?.version, latestVersions[tool.id])
  }).length

  // Node as this machine reports it, for the `engines.node` floors below.
  const nodeVersion = detections["node"]?.installed ? detections["node"].version : undefined
  const nodeMajor = majorVersion(nodeVersion)

  /**
   * The Node major this tool's npm update needs and this machine doesn't have,
   * or undefined when the update is safe to stage.
   *
   * npm rejects a package whose `engines.node` floor is above the Node here, and
   * it does it mid-install with EBADENGINE buried in its output. Upgrade below
   * goes straight to `cliInstallStep`, so it never passes the floor check
   * `buildSteps` does — the same hole `diagnostics.ts` closes for the overview.
   *
   * Only the npm path: a native install upgrades through its own installer,
   * where Node's version is irrelevant. An unknown manager counts as npm because
   * that is exactly what `upgradeCommandFor` would run.
   */
  const blockingNodeFloor = (tool: (typeof CLI_TOOLS)[number]) => {
    const floor = tool.minNodeMajor
    const npmPath = !!tool.npmPackage && cliManagers[tool.id] !== "native"
    if (!npmPath || floor === undefined || nodeMajor === undefined) return undefined
    return nodeMajor < floor ? floor : undefined
  }

  const upgradeNow = (tool: (typeof CLI_TOOLS)[number]) => {
    if (blockingNodeFloor(tool) !== undefined) return
    const cmd = upgradeCommandFor(tool, effectiveOS(), cliManagers[tool.id])
    if (!cmd) return
    void run([cliInstallStep(tool.id, cmd, true, t)])
  }

  return (
    <CapabilityWorkbench
      title={t.tools.title}
      subtitle={t.tools.subtitle}
      help={<HelpTip text={t.help.cli} />}
      actionsLabel={t.tools.actionsLabel}
      lead={
        <SectionStatus
          label={t.tools.summaryLabel}
          facts={[
            { label: t.tools.metricCatalog, value: CLI_TOOLS.length },
            { label: t.tools.metricInstalled, value: detectionsMeasured ? installedCount : "—" },
            { label: t.tools.metricUpdates, value: detectionsMeasured ? updateCount : "—" },
            { label: t.tools.metricSelected, value: clis.length },
          ]}
          notes={[detectionsMeasured ? null : t.tools.metricPending]}
        />
      }
      primary={
        <section aria-label={t.tools.catalogPanel} className="min-w-0 rounded-lg border">
          {/* Detections are empty in web mode, so every status badge below silently
              renders nothing — indistinguishable from "you have none of these". */}
          {!isTauri() && mounted ? (
            <div className="border-b p-4">
              <DesktopOnlyNote>{t.tools.notTauri}</DesktopOnlyNote>
            </div>
          ) : null}
          {clisByKind().map(({ kind, tools }, groupIndex) => (
            <section key={kind} className={groupIndex === 0 ? "min-w-0" : "min-w-0 border-t"}>
              <div className="bg-muted/30 px-4 py-3">
                <h3 className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
                  {t.tools.kinds[kind] ?? kind}
                </h3>
                {t.tools.kindNotes[kind] ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t.tools.kindNotes[kind]}</p>
                ) : null}
              </div>
              <div className="divide-y">
                {tools.map((tool) => {
                  const meta = t.catalog.cli[tool.id]
                  const d = detections[tool.id]
                  const latest = latestVersions[tool.id]
                  const canUpgrade = !tool.gui && isUpgradeAvailable(d?.version, latest)
                  // The update is real; npm just can't be the one to apply it.
                  // Gated on the same detection as the Upgrade button it replaces,
                  // so the note below can never outlive the row's install badge.
                  const nodeFloor = canUpgrade && d?.installed ? blockingNodeFloor(tool) : undefined
                  const upToDate = !tool.gui && !!latest && !canUpgrade
                  const checked = clis.includes(tool.id)
                  const methods = installMethodsFor(tool, effectiveOS())
                  const selectedMethodId = cliMethods?.[tool.id] ?? methods[0]?.id
                  const selectedMethod = methods.find((mth) => mth.id === selectedMethodId)
                  // Only offer the chooser when the tool has more than one channel and
                  // the user actually selected it for install.
                  const showMethodPicker = checked && methods.length > 1
                  return (
                    <div key={tool.id} className="min-w-0 p-4">
                      <div className="flex w-full flex-wrap items-center gap-3">
                        <Checkbox
                          id={`cli-${tool.id}`}
                          checked={checked}
                          onCheckedChange={() => toggleCli(tool.id)}
                        />
                        <label
                          htmlFor={`cli-${tool.id}`}
                          className="min-w-48 flex-1 cursor-pointer"
                        >
                          <span className="font-medium">{meta?.title ?? tool.id}</span>
                          <p className="text-sm text-muted-foreground">{meta?.description}</p>
                        </label>
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
                              {canUpgrade ? (
                                nodeFloor === undefined ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => upgradeNow(tool)}
                                  >
                                    {t.shell.upgrade}
                                  </Button>
                                ) : onOpenRuntimes ? (
                                  <Button variant="outline" size="sm" onClick={onOpenRuntimes}>
                                    {t.diagnostics.openRuntimes}
                                  </Button>
                                ) : null
                              ) : upToDate ? (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 font-normal text-muted-foreground"
                                >
                                  {t.envcheck.latest}
                                </Badge>
                              ) : null}
                            </>
                          ) : (
                            <Badge
                              variant="outline"
                              className="shrink-0 font-normal text-muted-foreground"
                            >
                              {t.envcheck.notFound}
                            </Badge>
                          )
                        ) : null}
                      </div>
                      {nodeFloor !== undefined ? (
                        <p className="mt-2 pl-7 text-xs text-muted-foreground">
                          {t.diagnostics.nodeFloorDetail(
                            nodeFloor,
                            nodeVersion ?? String(nodeMajor)
                          )}
                        </p>
                      ) : null}
                      {showMethodPicker ? (
                        <div className="flex flex-col gap-1 border-t pt-3 pl-7">
                          <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                            <span className="text-xs font-medium text-muted-foreground">
                              {t.shell.installMethod}
                            </span>
                            <Select
                              value={selectedMethodId}
                              onValueChange={(v) => setCliMethod(tool.id, v)}
                            >
                              <SelectTrigger className="h-8 w-full min-w-0 sm:w-[220px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {methods.map((mth) => (
                                  <SelectItem key={mth.id} value={mth.id}>
                                    {t.catalog.methods[mth.id]?.title ?? mth.id}
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
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </section>
      }
      aside={
        <CapabilityTile title={t.tools.overviewTitle} description={t.tools.overviewHint}>
          <p className="text-xs text-muted-foreground">{t.tools.upgradeNote}</p>
        </CapabilityTile>
      }
    />
  )
}
