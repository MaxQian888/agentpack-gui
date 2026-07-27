"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  GH_MIRROR_PRESETS,
  NPM_REGISTRY_PRESETS,
  matchPreset,
  type MirrorPreset,
} from "@/lib/agentpack/network/mirrors"
import { saveSettings } from "@/lib/tauri/settings"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"

/** One-click preset chips; the selected one is highlighted. */
function Presets({
  presets,
  value,
  onPick,
}: {
  presets: readonly MirrorPreset[]
  value: string | null | undefined
  onPick: (url: string | null) => void
}) {
  const selected = matchPreset(presets, value)
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          size="sm"
          variant={selected?.id === preset.id ? "secondary" : "outline"}
          className="h-7 px-2.5 text-xs font-normal"
          onClick={() => onPick(preset.url)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  )
}

/**
 * Package / download sources. The npm registry rides the plan (it's applied by a
 * run, like every other config write); the GitHub mirror prefix is an app
 * setting the skills downloader reads directly, so it saves immediately.
 */
export function MirrorsCard() {
  const t = useT()
  const m = t.network.mirrors
  const npmRegistry = useAppStore((s) => s.plan.network.npmRegistry)
  const setNetwork = useAppStore((s) => s.setNetwork)
  const ghMirrorPrefix = useAppStore((s) => s.settings.ghMirrorPrefix)
  const setSettings = useAppStore((s) => s.setSettings)

  const saveGhMirror = (prefix: string | null) => {
    setSettings({ ghMirrorPrefix: prefix })
    void saveSettings({ ghMirrorPrefix: prefix })
  }

  return (
    <Card className="gap-4 p-5">
      <div>
        <h3 className="font-medium">{m.title}</h3>
        <p className="text-sm text-muted-foreground">{m.subtitle}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="net-registry">{m.npmLabel}</Label>
        <Input
          id="net-registry"
          placeholder="https://registry.npmmirror.com"
          value={npmRegistry ?? ""}
          onChange={(e) => setNetwork({ npmRegistry: e.target.value || undefined })}
        />
        <Presets
          presets={NPM_REGISTRY_PRESETS}
          value={npmRegistry}
          onPick={(url) => setNetwork({ npmRegistry: url ?? undefined })}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="net-gh-mirror">{m.ghLabel}</Label>
        <Input
          id="net-gh-mirror"
          placeholder="https://gh-proxy.com/"
          value={ghMirrorPrefix ?? ""}
          onChange={(e) => saveGhMirror(e.target.value || null)}
        />
        <Presets presets={GH_MIRROR_PRESETS} value={ghMirrorPrefix} onPick={saveGhMirror} />
        <p className="text-xs text-muted-foreground">{m.ghHint}</p>
      </div>
    </Card>
  )
}
