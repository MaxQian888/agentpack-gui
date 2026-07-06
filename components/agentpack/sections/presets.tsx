"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { PRESETS } from "@/lib/agentpack/presets"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { SectionShell } from "./section-shell"
import { HelpTip } from "../help-tip"

const OPTIONS = ["custom", ...PRESETS.map((p) => p.id)] as const

export function PresetsSection({ onCustomize }: { onCustomize?: () => void }) {
  const t = useT()
  const applyPreset = useAppStore((s) => s.applyPreset)
  const resetPlan = useAppStore((s) => s.resetPlan)
  const [selected, setSelected] = useState<string | null>(null)

  const choose = (id: string) => {
    setSelected(id)
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
                "cursor-pointer gap-1 p-4 transition-colors hover:border-primary/50",
                active && "border-primary ring-1 ring-primary"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{meta?.title ?? id}</span>
                {active ? <Check className="size-4 text-primary" /> : null}
              </div>
              <p className="text-sm text-muted-foreground">{meta?.description}</p>
            </Card>
          )
        })}
      </div>
    </SectionShell>
  )
}
