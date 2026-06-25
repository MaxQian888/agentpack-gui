"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { SKILLS } from "@/lib/agentpack/registry"
import { skillInstallStep, skillRemoveStep } from "@/lib/agentpack/plan"
import type { AgentTarget, Paths } from "@/lib/agentpack/types"
import { pathExists } from "@/lib/tauri/commands"
import { isTauri } from "@/lib/tauri"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { useRunnerCtx } from "../run/runner-context"

const TARGETS: AgentTarget[] = ["claude", "codex"]

type SkillStatus = Record<string, Partial<Record<AgentTarget, boolean>>>

function skillMarkerPath(paths: Paths, id: string, target: AgentTarget): string {
  const dir = target === "claude" ? paths.claudeSkillsDir : paths.codexSkillsDir
  return `${dir}/${id}/SKILL.md`
}

async function detectStatus(paths: Paths): Promise<SkillStatus> {
  const entries = await Promise.all(
    SKILLS.map(async (skill) => {
      const perTarget = await Promise.all(
        TARGETS.map(
          async (tg) => [tg, await pathExists(skillMarkerPath(paths, skill.id, tg))] as const
        )
      )
      return [skill.id, Object.fromEntries(perTarget)] as const
    })
  )
  return Object.fromEntries(entries)
}

export function SkillsSection() {
  const t = useT()
  const skills = useAppStore((s) => s.plan.skills)
  const setSkill = useAppStore((s) => s.setSkill)
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()
  const [status, setStatus] = useState<SkillStatus>({})

  const loadStatus = useCallback(async () => {
    if (!isTauri() || !paths) return
    setStatus(await detectStatus(paths))
  }, [paths])

  useEffect(() => {
    if (!isTauri() || !paths) return
    let cancelled = false
    detectStatus(paths).then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [paths])

  const targetsFor = (id: string): AgentTarget[] => skills.find((s) => s.id === id)?.targets ?? []

  const toggleTarget = (id: string, target: AgentTarget) => {
    const current = targetsFor(id)
    const next = current.includes(target)
      ? current.filter((x) => x !== target)
      : [...current, target]
    setSkill(id, next)
  }

  const destsFor = (id: string, targets: AgentTarget[]): string[] =>
    paths
      ? targets.map(
          (tg) => `${tg === "claude" ? paths.claudeSkillsDir : paths.codexSkillsDir}/${id}`
        )
      : []

  const installNow = async (id: string, title: string, targets: AgentTarget[]) => {
    await run([skillInstallStep(id, title, targets, t)])
    await loadStatus()
  }

  const uninstallNow = async (id: string, title: string, targets: AgentTarget[]) => {
    await run([skillRemoveStep(id, title, targets, destsFor(id, targets), t)])
    await loadStatus()
  }

  return (
    <SectionShell title={t.skills.title} subtitle={t.skillsManage.categorySubtitle}>
      <div className="flex flex-col gap-3">
        {SKILLS.map((skill) => {
          const meta = t.catalog.skills[skill.id]
          const targets = targetsFor(skill.id)
          const st = status[skill.id]
          const anyInstalled = st ? Object.values(st).some(Boolean) : false
          return (
            <Card key={skill.id} className="gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-medium">{meta?.title ?? skill.id}</span>
                  <p className="text-sm text-muted-foreground">{meta?.description}</p>
                </div>
                {st ? (
                  <Badge
                    variant={anyInstalled ? "secondary" : "outline"}
                    className="shrink-0 font-normal text-muted-foreground"
                  >
                    {anyInstalled
                      ? `${t.skillsManage.installed}${
                          st.claude && st.codex ? "" : ` (${st.claude ? "claude" : "codex"})`
                        }`
                      : t.skillsManage.notInstalled}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-5">
                  {TARGETS.map((target) => (
                    <label
                      key={target}
                      className="flex cursor-pointer items-center gap-2 text-sm capitalize"
                    >
                      <Checkbox
                        checked={targets.includes(target)}
                        onCheckedChange={() => toggleTarget(skill.id, target)}
                      />
                      {target}
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
      </div>
    </SectionShell>
  )
}
