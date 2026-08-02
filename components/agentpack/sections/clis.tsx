"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import { extractSemver, isUpgradeAvailable } from "@/lib/agentpack/version"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { HelpTip } from "../help-tip"
import { useRunnerCtx } from "../run/runner-context"
import { DesktopOnlyNote } from "../desktop-only-note"
import { useMounted } from "@/hooks/use-mounted"
import { isTauri } from "@/lib/tauri"

export function ClisSection() {
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

  const upgradeNow = (tool: (typeof CLI_TOOLS)[number]) => {
    const cmd = upgradeCommandFor(tool, effectiveOS(), cliManagers[tool.id])
    if (!cmd) return
    void run([cliInstallStep(tool.id, cmd, true, t)])
  }

  return (
    <SectionShell
      title={t.tools.title}
      subtitle={t.tools.subtitle}
      help={<HelpTip text={t.help.cli} />}
    >
      <p className="-mt-2 text-xs text-muted-foreground">{t.tools.upgradeNote}</p>
      {/* Detections are empty in web mode, so every status badge below silently
          renders nothing — indistinguishable from "you have none of these". */}
      {!isTauri() && mounted ? <DesktopOnlyNote>{t.tools.notTauri}</DesktopOnlyNote> : null}
      {/* Grouped rather than one flat column: the catalog is long enough now
          that "which of these is an agent?" was a question the list made the
          reader answer for themselves. */}
      {clisByKind().map(({ kind, tools }) => (
        <section key={kind} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
              {t.tools.kinds[kind] ?? kind}
            </h3>
            {t.tools.kindNotes[kind] ? (
              <p className="text-xs text-muted-foreground">{t.tools.kindNotes[kind]}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            {tools.map((tool) => {
              const meta = t.catalog.cli[tool.id]
              const d = detections[tool.id]
              const latest = latestVersions[tool.id]
              const canUpgrade = !tool.gui && isUpgradeAvailable(d?.version, latest)
              const upToDate = !tool.gui && !!latest && !canUpgrade
              const checked = clis.includes(tool.id)
              const methods = installMethodsFor(tool, effectiveOS())
              const selectedMethodId = cliMethods?.[tool.id] ?? methods[0]?.id
              const selectedMethod = methods.find((mth) => mth.id === selectedMethodId)
              // Only offer the chooser when the tool has more than one channel and
              // the user actually selected it for install.
              const showMethodPicker = checked && methods.length > 1
              return (
                <Card key={tool.id} className="flex-col gap-3 p-4">
                  <div className="flex w-full flex-row items-center gap-3">
                    <Checkbox
                      id={`cli-${tool.id}`}
                      checked={checked}
                      onCheckedChange={() => toggleCli(tool.id)}
                    />
                    <label htmlFor={`cli-${tool.id}`} className="flex-1 cursor-pointer">
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
                            <Button variant="outline" size="sm" onClick={() => upgradeNow(tool)}>
                              {t.shell.upgrade}
                            </Button>
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
                  {showMethodPicker ? (
                    <div className="flex flex-col gap-1 border-t pt-3 pl-7">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.shell.installMethod}
                        </span>
                        <Select
                          value={selectedMethodId}
                          onValueChange={(v) => setCliMethod(tool.id, v)}
                        >
                          <SelectTrigger className="h-8 w-[220px]">
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
                </Card>
              )
            })}
          </div>
        </section>
      ))}
    </SectionShell>
  )
}
