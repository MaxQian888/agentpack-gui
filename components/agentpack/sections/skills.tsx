"use client"

import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { SKILLS } from "@/lib/agentpack/registry"
import type { AgentTarget } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"

const TARGETS: AgentTarget[] = ["claude", "codex"]

export function SkillsSection() {
  const t = useT()
  const skills = useAppStore((s) => s.plan.skills)
  const setSkill = useAppStore((s) => s.setSkill)

  const targetsFor = (id: string): AgentTarget[] => skills.find((s) => s.id === id)?.targets ?? []

  const toggleTarget = (id: string, target: AgentTarget) => {
    const current = targetsFor(id)
    const next = current.includes(target)
      ? current.filter((x) => x !== target)
      : [...current, target]
    setSkill(id, next)
  }

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
            </Card>
          )
        })}
      </div>
    </SectionShell>
  )
}
