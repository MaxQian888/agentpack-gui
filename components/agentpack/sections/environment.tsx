"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RUNTIMES, installMethodsFor } from "@/lib/agentpack/registry"
import { runtimeInstallStep } from "@/lib/agentpack/plan"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { useRunnerCtx } from "../run/runner-context"

export function EnvironmentSection() {
  const t = useT()
  const detections = useAppStore((s) => s.detections)
  const effectiveOS = useAppStore((s) => s.effectiveOS)
  const { run } = useRunnerCtx()
  // Chosen install method per runtime (runtimes are installed directly, not via
  // the plan, so the choice is local UI state rather than store state).
  const [methodChoice, setMethodChoice] = useState<Record<string, string>>({})

  const installNow = (rt: (typeof RUNTIMES)[number]) => {
    const methods = installMethodsFor(rt, effectiveOS())
    const chosen = methods.find((m) => m.id === methodChoice[rt.id]) ?? methods[0]
    if (!chosen) return
    // The central afterRun hook re-detects runtimes once the install completes.
    void run([runtimeInstallStep(rt.id, chosen.command, t, chosen.requiresElevation)])
  }

  return (
    <SectionShell title={t.environment.title} subtitle={t.environment.subtitle}>
      <p className="-mt-2 text-xs text-muted-foreground">{t.environment.installHint}</p>
      <div className="flex flex-col gap-3">
        {RUNTIMES.map((rt) => {
          const meta = t.catalog.runtime[rt.id]
          const d = detections[rt.id]
          const methods = installMethodsFor(rt, effectiveOS())
          const installable = methods.length > 0
          const selectedMethodId = methodChoice[rt.id] ?? methods[0]?.id
          const selectedMethod = methods.find((m) => m.id === selectedMethodId)
          // Offer a chooser only for missing runtimes that have >1 channel.
          const showMethodPicker = !!d && !d.installed && methods.length > 1
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
              {showMethodPicker ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t.shell.installMethod}
                    </span>
                    <Select
                      value={selectedMethodId}
                      onValueChange={(v) => setMethodChoice((prev) => ({ ...prev, [rt.id]: v }))}
                    >
                      <SelectTrigger className="h-8 w-[220px]">
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
            </Card>
          )
        })}
      </div>
    </SectionShell>
  )
}
