/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
"use client"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/provider"
import { RECOMMENDED_PROVIDERS } from "@/lib/agentpack/ccswitch/preset"
import { officialForm } from "@/lib/agentpack/ccswitch/official"
import { cn } from "@/lib/utils"
import type { ProviderApp, ProviderForm as ProviderFormData } from "@/lib/agentpack/ccswitch/types"

/**
 * The pre-filled ways in: an official-login row per app that lacks one, and the
 * relay presets.
 *
 * These were one unlabelled bag of nine identical buttons whose panel
 * description was `setCurrentNote` — copy about what happens when you make a
 * provider *current*, under a heading that says "Add provider". A beginner
 * reading it learned nothing about either.
 *
 * Two named groups now, because they answer two different questions ("use my
 * own account" vs "use a relay"), and one honest sentence about what a click
 * actually does: it opens the form. Nothing here writes.
 */
export function QuickAddCard({
  missingOfficial,
  disabled,
  flat = false,
  onPick,
}: {
  missingOfficial: readonly ProviderApp[]
  disabled: boolean
  /**
   * Drop the panel chrome. Inside the provider list's empty state this is
   * already within a panel, and design.md is blunt about a box inside a box —
   * what it needs there is a rule, which the empty state supplies.
   */
  flat?: boolean
  onPick: (initial: Partial<ProviderFormData>) => void
}) {
  const t = useT()
  const c = t.ccswitch

  return (
    <section
      aria-label={c.quickAddTitle}
      className={cn("min-w-0", !flat && "rounded-lg border p-4")}
    >
      <h3 className="font-medium">{c.quickAddTitle}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.quickAddHint}</p>

      <div className="mt-3 min-w-0 space-y-3">
        <div className="min-w-0">
          <div className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
            {c.quickAddOfficial}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {missingOfficial.length > 0 ? (
              missingOfficial.map((app) => (
                <Button
                  key={`official-${app}`}
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onPick(officialForm(app, c.officialName))}
                >
                  {c.addOfficial(app)}
                </Button>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{c.quickAddAllOfficial}</p>
            )}
          </div>
        </div>

        <div className="min-w-0 border-t pt-3">
          <div className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
            {c.quickAddPresets}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {RECOMMENDED_PROVIDERS.map((preset) => (
              <Button
                key={preset.key}
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onPick(preset.form)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
