"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { matchPreset, PRESETS } from "@/lib/agentpack/presets"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { HelpTip } from "../help-tip"

const OPTIONS = ["custom", ...PRESETS.map((p) => p.id)] as const

export function PresetsSection({ onCustomize }: { onCustomize?: () => void }) {
  const t = useT()
  const plan = useAppStore((s) => s.plan)
  const applyPreset = useAppStore((s) => s.applyPreset)
  const resetPlan = useAppStore((s) => s.resetPlan)
  // Derived from the plan rather than remembered locally, so the tick agrees with
  // what will actually be installed — including a bundle picked in the header Run ▾
  // menu, or one the user has since edited item by item. Nothing picked at all ticks
  // nothing (an empty plan isn't a "Custom" choice the user made yet).
  const anyPicked = plan.clis.length + plan.skills.length + plan.mcps.length > 0
  const selected = anyPicked ? matchPreset(plan) : null

  const choose = (id: string) => {
    // "Custom" clears the plan and opens the one-page customize dialog (the same
    // component the header Run ▾ menu uses) so the user can hand-pick items.
    if (id === "custom") {
      resetPlan()
      onCustomize?.()
    } else applyPreset(id)
  }

  return (
    <SectionShell
      title={t.presetsScreen.title}
      subtitle={t.presetsScreen.subtitle}
      help={<HelpTip text={t.help.preset} />}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((id) => {
          const meta = t.presets[id]
          const active = selected === id
          return (
            <Card
              key={id}
              role="button"
              tabIndex={0}
              onClick={() => choose(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") choose(id)
              }}
              className={cn(
                "h-full cursor-pointer gap-1.5 p-4 transition-colors hover:border-primary/50 hover:bg-muted/30",
                active && "border-primary bg-primary/5 ring-1 ring-primary"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{meta?.title ?? id}</span>
                {active ? <Check className="size-4 shrink-0 text-primary" /> : null}
              </div>
              <p className="text-sm text-muted-foreground">{meta?.description}</p>
            </Card>
          )
        })}
      </div>
    </SectionShell>
  )
}
