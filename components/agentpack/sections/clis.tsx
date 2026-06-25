"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { CLI_TOOLS } from "@/lib/agentpack/registry"
import { cliInstallStep } from "@/lib/agentpack/plan"
import { isUpgradeAvailable } from "@/lib/agentpack/version"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { useRunnerCtx } from "../run/runner-context"

export function ClisSection() {
  const t = useT()
  const clis = useAppStore((s) => s.plan.clis)
  const toggleCli = useAppStore((s) => s.toggleCli)
  const detections = useAppStore((s) => s.detections)
  const latestVersions = useAppStore((s) => s.latestVersions)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()

  const upgradeNow = (tool: (typeof CLI_TOOLS)[number]) => {
    const cmd = tool.upgrade?.[effectiveOS()] ?? tool.install[effectiveOS()]
    if (!cmd) return
    void run([cliInstallStep(tool.id, cmd, true, t)])
  }

  return (
    <SectionShell title={t.tools.title} subtitle={t.tools.subtitle}>
      <p className="-mt-2 text-xs text-muted-foreground">{t.tools.upgradeNote}</p>
      <div className="flex flex-col gap-3">
        {CLI_TOOLS.map((tool) => {
          const meta = t.catalog.cli[tool.id]
          const d = detections[tool.id]
          const latest = latestVersions[tool.id]
          const canUpgrade = !tool.gui && isUpgradeAvailable(d?.version, latest)
          const upToDate = !tool.gui && !!latest && !canUpgrade
          const checked = clis.includes(tool.id)
          return (
            <Card key={tool.id} className="flex-row items-center gap-3 p-4">
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
                    <Badge variant="secondary" className="shrink-0 font-normal">
                      {t.envcheck.installed}
                      {d.version ? ` · ${d.version}` : ""}
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
                  <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                    {t.envcheck.notFound}
                  </Badge>
                )
              ) : null}
            </Card>
          )
        })}
      </div>
    </SectionShell>
  )
}
