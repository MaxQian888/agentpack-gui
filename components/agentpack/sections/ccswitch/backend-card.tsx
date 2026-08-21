/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
"use client"

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n/provider"
import type { ProviderBackend } from "@/lib/agentpack/ccswitch/types"
import { cn } from "@/lib/utils"

/**
 * Where provider records live — the one decision that changes what the rest of
 * this page even shows.
 *
 * It used to be a two-button ToggleGroup with the selected mode's sentence
 * printed underneath, plus a separate Alert restating the native mode's
 * sentence a third time. Two panels and three copies for a binary choice, and
 * the consequence of each option was only readable *after* choosing it.
 *
 * Both consequences are on screen at once now, side by side, which is what a
 * choice looks like. The recommendation is stated rather than implied by button
 * order: someone who has never heard of cc-switch should not have to infer that
 * they don't need it.
 */
export function BackendCard({
  backend,
  disabled,
  onSelect,
}: {
  backend: ProviderBackend
  disabled: boolean
  onSelect: (value: string) => void
}) {
  const t = useT()
  const c = t.ccswitch

  const options = [
    {
      value: "native" as const,
      label: c.backendNative,
      hint: c.backendNativeHint,
      recommended: true,
    },
    {
      value: "ccswitch" as const,
      label: c.backendCcSwitch,
      hint: c.backendCcSwitchHint,
      recommended: false,
    },
  ]

  return (
    <section aria-label={c.backendTitle} className="min-w-0 rounded-lg border p-4">
      <h3 className="font-medium">{c.backendTitle}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.backendHint}</p>

      <RadioGroup
        value={backend}
        onValueChange={onSelect}
        disabled={disabled}
        className="mt-3 grid gap-2 sm:grid-cols-2"
      >
        {options.map((option) => (
          <Label
            key={option.value}
            htmlFor={`backend-${option.value}`}
            data-selected={backend === option.value ? "true" : "false"}
            className={cn(
              "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-[var(--hm-radius-control)] border p-3 font-normal",
              "hover:bg-[var(--hm-paper-3)] has-disabled:cursor-default has-disabled:opacity-60",
              backend === option.value && "border-primary/50 bg-[var(--hm-accent-soft)]/40"
            )}
          >
            <RadioGroupItem
              id={`backend-${option.value}`}
              value={option.value}
              aria-label={option.label}
              className="mt-0.5 shrink-0"
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                {option.label}
                {option.recommended ? (
                  <span className="font-mono text-[var(--hm-text-2xs)] tracking-[var(--hm-tracking-mono)] text-muted-foreground uppercase">
                    {c.backendRecommended}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {option.hint}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
    </section>
  )
}
