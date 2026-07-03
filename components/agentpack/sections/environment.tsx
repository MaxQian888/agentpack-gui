"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { RUNTIMES } from "@/lib/agentpack/registry"
import { runtimeInstallStep } from "@/lib/agentpack/plan"
import { isTauri } from "@/lib/tauri"
import { detectRuntime } from "@/lib/tauri/commands"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { useRunnerCtx } from "../run/runner-context"

export function EnvironmentSection() {
  const t = useT()
  const detections = useAppStore((s) => s.detections)
  const setDetection = useAppStore((s) => s.setDetection)
  const dryRun = useAppStore((s) => s.dryRun)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()

  const installNow = async (rt: (typeof RUNTIMES)[number]) => {
    const cmd = rt.install[effectiveOS()]
    if (!cmd) return
    await run([runtimeInstallStep(rt.id, cmd, t)])
    // Re-detect after a real install so the badge flips to "installed".
    if (!dryRun && isTauri()) setDetection(rt.id, await detectRuntime(rt))
  }

  return (
    <SectionShell title={t.environment.title} subtitle={t.environment.subtitle}>
      <p className="-mt-2 text-xs text-muted-foreground">{t.environment.installHint}</p>
      <div className="flex flex-col gap-3">
        {RUNTIMES.map((rt) => {
          const meta = t.catalog.runtime[rt.id]
          const d = detections[rt.id]
          const installable = !!rt.install[effectiveOS()]
          return (
            <Card key={rt.id} className="flex-col items-stretch gap-2 p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <span className="font-medium">{meta?.title ?? rt.id}</span>
                  <p className="text-sm text-muted-foreground">{meta?.description}</p>
                </div>
                {d ? (
                  d.installed ? (
                    <Badge variant="secondary" className="shrink-0 font-normal">
                      {t.envcheck.installed}
                      {d.version ? ` · ${d.version}` : ""}
                    </Badge>
                  ) : (
                    <>
                      <Badge
                        variant="outline"
                        className="shrink-0 font-normal text-muted-foreground"
                      >
                        {t.envcheck.notFound}
                      </Badge>
                      {installable ? (
                        <Button variant="outline" size="sm" onClick={() => void installNow(rt)}>
                          {t.shell.installNow}
                        </Button>
                      ) : null}
                    </>
                  )
                ) : null}
              </div>
              {d && !d.installed && !installable ? (
                <p className="text-xs text-muted-foreground">
                  {rt.manualNote ?? t.environment.noInstaller}
                </p>
              ) : null}
            </Card>
          )
        })}
      </div>
    </SectionShell>
  )
}
