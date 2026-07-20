"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { SKILLS } from "@/lib/agentpack/registry"
import { skillInstallStep, skillRemoveStep } from "@/lib/agentpack/plan"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SKILL_SOURCES } from "@/lib/skills/browse"
import { skillDestPath } from "@/lib/skills/paths"
import type { InstalledSkill, SkillsScanResult, SkillSource } from "@/lib/skills/types"
import { useRunnerCtx } from "../../run/runner-context"
import { useInstallGuard } from "./install-conflict-dialog"

/** Sources that currently have the bundled skill `id` installed, from the scan. */
function installedSources(skills: InstalledSkill[], id: string): SkillSource[] {
  const out: SkillSource[] = []
  for (const source of SKILL_SOURCES) {
    if (skills.some((s) => s.source === source && s.dirName === id)) out.push(source)
  }
  return out
}

/**
 * The six bundled domain skills, each installable into (or removable from) any of
 * the four skill roots (claude/codex/opencode/agents). Target selection is local
 * to this tab — the bundled catalog is self-contained and no longer feeds the
 * onboarding plan. Installs are guarded against overwriting an existing skill.
 */
export function CatalogTab({
  scan,
  refresh,
}: {
  scan: SkillsScanResult | null
  refresh: () => void
}) {
  const t = useT()
  const sb = t.skillsBrowser
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()
  const { guard, dialog } = useInstallGuard()
  const [selected, setSelected] = useState<Record<string, SkillSource[]>>({})

  const skills = scan?.skills ?? []
  const targetsFor = (id: string): SkillSource[] => selected[id] ?? []

  const toggleTarget = (id: string, target: SkillSource) =>
    setSelected((prev) => {
      const cur = prev[id] ?? []
      const next = cur.includes(target) ? cur.filter((x) => x !== target) : [...cur, target]
      return { ...prev, [id]: next }
    })

  const installNow = async (id: string, title: string, targets: SkillSource[]) => {
    if (!paths || targets.length === 0) return
    const resolved = await guard([{ dirName: id, targets }], skills)
    if (!resolved || resolved.length === 0) return
    await run([skillInstallStep(id, title, resolved[0].targets, t)])
    refresh()
  }

  const uninstallNow = async (id: string, title: string, targets: SkillSource[]) => {
    if (!paths || targets.length === 0) return
    const dests = targets.map((tg) => skillDestPath(paths, tg, id))
    await run([skillRemoveStep(id, title, targets, dests, t)])
    refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {SKILLS.map((skill) => {
        const meta = t.catalog.skills[skill.id]
        const targets = targetsFor(skill.id)
        const installed = installedSources(skills, skill.id)
        const installedLabel =
          installed.length === 0
            ? sb.catalogNotInstalled
            : sb.catalogInstalledIn(installed.map((s) => sb.sources[s] ?? s).join(", "))
        return (
          <Card key={skill.id} className="gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="font-medium">{meta?.title ?? skill.id}</span>
                <p className="text-sm text-muted-foreground">{meta?.description}</p>
              </div>
              <Badge
                variant={installed.length ? "secondary" : "outline"}
                className="shrink-0 font-normal text-muted-foreground"
              >
                {installedLabel}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {SKILL_SOURCES.map((target) => (
                  <label key={target} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={targets.includes(target)}
                      onCheckedChange={() => toggleTarget(skill.id, target)}
                    />
                    {sb.sources[target] ?? target}
                  </label>
                ))}
              </div>
              {targets.length > 0 ? (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => installNow(skill.id, meta?.title ?? skill.id, targets)}
                  >
                    {t.shell.installNow}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => uninstallNow(skill.id, meta?.title ?? skill.id, targets)}
                  >
                    {t.shell.uninstallNow}
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        )
      })}
      {dialog}
    </div>
  )
}
