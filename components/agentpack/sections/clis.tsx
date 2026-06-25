"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { CLI_TOOLS } from "@/lib/agentpack/registry"
import { detectCli } from "@/lib/tauri/commands"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"

type Detection = { installed: boolean; version?: string }

export function ClisSection() {
  const t = useT()
  const clis = useAppStore((s) => s.plan.clis)
  const toggleCli = useAppStore((s) => s.toggleCli)
  const [detected, setDetected] = useState<Record<string, Detection>>({})

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    Promise.all(
      CLI_TOOLS.map(async (tool) => [tool.id, await detectCli(tool.bin, !!tool.gui)] as const)
    ).then((entries) => {
      if (!cancelled) setDetected(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SectionShell title={t.tools.title} subtitle={t.tools.subtitle}>
      <p className="-mt-2 text-xs text-muted-foreground">{t.tools.upgradeNote}</p>
      <div className="flex flex-col gap-3">
        {CLI_TOOLS.map((tool) => {
          const meta = t.catalog.cli[tool.id]
          const d = detected[tool.id]
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
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {t.envcheck.installed}
                    {d.version ? ` · ${d.version}` : ""}
                  </Badge>
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
