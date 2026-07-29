"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n/provider"
import { VISIBLE_APP_KEYS } from "@/lib/agentpack/ccswitch/settings"
import type { VisibleApps } from "@/lib/agentpack/ccswitch/types"

/**
 * Which apps cc-switch shows in its own UI. Written to cc-switch's settings
 * file rather than its database, so it needs an explicit Apply — unlike the
 * provider rows, nothing here takes effect until the file is written.
 */
export function VisibleAppsCard({
  visible,
  disabled,
  onChange,
  onApply,
}: {
  visible: VisibleApps
  disabled: boolean
  onChange: (next: VisibleApps) => void
  onApply: () => void
}) {
  const t = useT()
  const c = t.ccswitch

  return (
    <Card className="gap-3 p-4">
      <div className="font-medium">{c.visibleTitle}</div>
      <div className="grid grid-cols-2 gap-3">
        {VISIBLE_APP_KEYS.map((key) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <Label htmlFor={`va-${key}`} className="cursor-pointer text-sm font-normal">
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
      <div>
        <Button variant="outline" size="sm" onClick={onApply} disabled={disabled}>
          {t.shell.apply}
        </Button>
      </div>
    </Card>
  )
}
