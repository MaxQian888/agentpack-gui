"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  BREW_MIRROR_PRESETS,
  GH_MIRROR_PRESETS,
  NPM_REGISTRY_PRESETS,
  PYPI_INDEX_PRESETS,
  matchPreset,
  type MirrorPreset,
} from "@/lib/agentpack/network/mirrors"
import type { CheckResult, RankedBrew } from "@/lib/agentpack/network/probe"
import { saveSettings } from "@/lib/tauri/settings"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { cn } from "@/lib/utils"

/** Measured latency per preset id, so a chip can say how fast it actually is. */
type Measurements = Map<string, CheckResult | null>

const measure = (ranked: readonly { preset: { id: string }; result: CheckResult | null }[]) =>
  new Map(ranked.map((r) => [r.preset.id, r.result]))

/**
 * One-click preset chips. Each carries its measured latency, because "which
 * mirror should I pick" is unanswerable from a list of names — and a chip for a
 * mirror this machine can't reach is worse than useless.
 */
function Presets({
  presets,
  value,
  measurements,
  onPick,
}: {
  presets: readonly MirrorPreset[]
  value: string | null | undefined
  measurements?: Measurements
  onPick: (url: string | null) => void
}) {
  const t = useT()
  const selected = matchPreset(presets, value)
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => {
        const result = measurements?.get(preset.id)
        const unreachable = !!measurements && result !== undefined && !result?.ok
        return (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant={selected?.id === preset.id ? "secondary" : "outline"}
            className={cn("h-7 gap-1.5 px-2.5 text-xs font-normal", unreachable && "opacity-50")}
            onClick={() => onPick(preset.url)}
          >
            {preset.label}
            {result?.ok && result.latencyMs !== undefined ? (
              <span className="tabular-nums text-muted-foreground">{result.latencyMs}ms</span>
            ) : unreachable ? (
              <span className="text-muted-foreground">{t.network.probe.unreachable}</span>
            ) : null}
          </Button>
        )
      })}
    </div>
  )
}

/**
 * Package / download sources. The npm registry rides the plan (it's applied by a
 * run, like every other config write); the GitHub mirror prefix is an app
 * setting the skills downloader reads directly, so it saves immediately.
 *
 * PyPI and Homebrew are shown but not written anywhere: both are environment
 * variables, and agentpack applies them only for a failed install's retry. The
 * hint under each says so rather than implying a setting that doesn't exist.
 */
export function MirrorsCard() {
  const t = useT()
  const m = t.network.mirrors
  const npmRegistry = useAppStore((s) => s.plan.network.npmRegistry)
  const setNetwork = useAppStore((s) => s.setNetwork)
  const ghMirrorPrefix = useAppStore((s) => s.settings.ghMirrorPrefix)
  const setSettings = useAppStore((s) => s.setSettings)
  const probe = useAppStore((s) => s.networkProbe)

  const saveGhMirror = (prefix: string | null) => {
    setSettings({ ghMirrorPrefix: prefix })
    void saveSettings({ ghMirrorPrefix: prefix })
  }

  const npmMeasurements = probe ? measure(probe.npm) : undefined
  const ghMeasurements = probe ? measure(probe.gh) : undefined
  const pypiMeasurements = probe ? measure(probe.pypi) : undefined

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
          measurements={npmMeasurements}
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
        <Presets
          presets={GH_MIRROR_PRESETS}
          value={ghMirrorPrefix}
          measurements={ghMeasurements}
          onPick={saveGhMirror}
        />
        <p className="text-xs text-muted-foreground">{m.ghHint}</p>
      </div>

      {/* Read-only: these are applied as env vars during a retry, never written. */}
      <div className="grid gap-2">
        <Label>{m.pypiLabel}</Label>
        <Presets
          presets={PYPI_INDEX_PRESETS}
          value={null}
          measurements={pypiMeasurements}
          onPick={() => {}}
        />
        <p className="text-xs text-muted-foreground">{m.autoHint}</p>
      </div>

      <div className="grid gap-2">
        <Label>{m.brewLabel}</Label>
        <BrewPresets ranked={probe?.brew} />
        <p className="text-xs text-muted-foreground">{m.autoHint}</p>
      </div>
    </Card>
  )
}

/** Homebrew mirrors carry two domains each, so they don't fit `MirrorPreset`. */
function BrewPresets({ ranked }: { ranked: readonly RankedBrew[] | undefined }) {
  const t = useT()
  const byId = ranked ? new Map(ranked.map((r) => [r.preset.id, r.result])) : undefined
  return (
    <div className="flex flex-wrap gap-1.5">
      {BREW_MIRROR_PRESETS.map((preset) => {
        const result = byId?.get(preset.id)
        const unreachable = !!byId && result !== undefined && !result?.ok
        return (
          <span
            key={preset.id}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs",
              unreachable && "opacity-50"
            )}
          >
            {preset.label}
            {result?.ok && result.latencyMs !== undefined ? (
              <span className="tabular-nums text-muted-foreground">{result.latencyMs}ms</span>
            ) : unreachable ? (
              <span className="text-muted-foreground">{t.network.probe.unreachable}</span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
