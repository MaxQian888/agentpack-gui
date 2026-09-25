"use client"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n/provider"
import { VISIBLE_APP_KEYS } from "@/lib/agentpack/ccswitch/settings"
import type { VisibleApps } from "@/lib/agentpack/ccswitch/types"

/**
 * Which apps cc-switch shows in its own UI. Written to cc-switch's settings
 * file rather than its database, so it needs an explicit Apply — unlike the
 * provider rows, nothing here takes effect until the file is written.
 *
 * Apply is only live once a switch differs from the file: applying the file's
 * own contents back to it staged a review of a write that changed nothing.
 */
export function VisibleAppsCard({
  visible,
  changed,
  disabled,
  onChange,
  onApply,
}: {
  visible: VisibleApps
  /** Whether any switch differs from what cc-switch's settings file says. */
  changed: boolean
  disabled: boolean
  onChange: (next: VisibleApps) => void
  onApply: () => void
}) {
  const t = useT()
  const c = t.ccswitch

  return (
    <section aria-label={c.visibleTitle} className="min-w-0 rounded-lg border p-4">
      <h3 className="font-medium">{c.visibleTitle}</h3>
      <div className="mt-3 divide-y">
        {VISIBLE_APP_KEYS.map((key) => (
          <div key={key} className="flex min-w-0 items-center justify-between gap-2 py-1.5">
            <Label htmlFor={`va-${key}`} className="min-w-0 cursor-pointer text-sm font-normal">
              {c.appLabels[key]}
            </Label>
            <Switch
              id={`va-${key}`}
              checked={visible[key]}
              onCheckedChange={(v) => onChange({ ...visible, [key]: v })}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onApply}
          disabled={disabled || !changed}
          aria-describedby={changed ? undefined : "ccswitch-visible-unchanged"}
        >
          {t.shell.apply}
        </Button>
        {changed ? null : (
          <p id="ccswitch-visible-unchanged" className="min-w-0 text-xs text-muted-foreground">
            {c.visibleUnchanged}
          </p>
        )}
      </div>
    </section>
  )
}
