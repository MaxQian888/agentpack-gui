"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { SKILLS } from "@/lib/agentpack/registry"
import { skillInstallStep, skillRemoveStep } from "@/lib/agentpack/plan"
import type { AgentTarget } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { useRunnerCtx } from "../run/runner-context"

const TARGETS: AgentTarget[] = ["claude", "codex"]

export function SkillsSection() {
  const t = useT()
  const skills = useAppStore((s) => s.plan.skills)
  const setSkill = useAppStore((s) => s.setSkill)
  const paths = useAppStore((s) => s.paths)
  const { run } = useRunnerCtx()

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

  const installNow = (id: string, title: string, targets: AgentTarget[]) =>
    void run([skillInstallStep(id, title, targets, t)])

  const uninstallNow = (id: string, title: string, targets: AgentTarget[]) =>
    void run([skillRemoveStep(id, title, targets, destsFor(id, targets), t)])

  return (
    <SectionShell title={t.skills.title} subtitle={t.skillsManage.categorySubtitle}>
      <div className="flex flex-col gap-3">
        {SKILLS.map((skill) => {
          const meta = t.catalog.skills[skill.id]
          const targets = targetsFor(skill.id)
          return (
            <Card key={skill.id} className="gap-3 p-4">
              <div>
                <span className="font-medium">{meta?.title ?? skill.id}</span>
                <p className="text-sm text-muted-foreground">{meta?.description}</p>
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
