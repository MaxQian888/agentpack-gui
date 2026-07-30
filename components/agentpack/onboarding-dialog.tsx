"use client"

import { useState } from "react"
import { ArrowLeftRight, Server, Sparkles, Terminal, Wrench } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { PRESETS } from "@/lib/agentpack/presets"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { OnboardingNetworkStep } from "./onboarding-network-step"

/** Bundle ids offered on first run, in "gentlest first" order. */
const PRESET_IDS = PRESETS.map((p) => p.id)
const DEFAULT_PRESET = "recommended"

/** The three stops, in order. */
const STEPS = ["intro", "network", "install"] as const
type Step = (typeof STEPS)[number]

/**
 * First-run welcome wizard, in three steps:
 *
 *  1. **intro** — what agentpack does, and which bundle to start from.
 *  2. **network** — the self-check. This step earns its place: a blocked or slow
 *     network is the most common reason a first install fails, and finding that
 *     out *before* running beats watching six steps go red. It reports what the
 *     startup probe measured and adopts the best route in one click.
 *  3. **install** — preview toggle, then run.
 *
 * Controlled by the caller: `open` comes from the store's `onboardingOpen` flag
 * (set on a fresh install, or manually from About). Dismissing — via the button,
 * Esc, or the overlay — calls `onDismiss`; installing calls `onInstall`.
 */
export function OnboardingDialog({
  open,
  onInstall,
  onDismiss,
  onTour,
}: {
  open: boolean
  onInstall: (presetId: string) => void
  onDismiss: () => void
  /** Start the guided product tour instead of installing right away. */
  onTour: () => void
}) {
  const t = useT()
  const w = t.welcome
  const dryRun = useAppStore((s) => s.dryRun)
  const toggleDryRun = useAppStore((s) => s.toggleDryRun)
  const probe = useAppStore((s) => s.networkProbe)
  const probing = useAppStore((s) => s.networkProbing)
  const [preset, setPreset] = useState(DEFAULT_PRESET)
  const [step, setStep] = useState<Step>("intro")

  const index = STEPS.indexOf(step)
  const isLast = index === STEPS.length - 1
  const back = () => setStep(STEPS[Math.max(0, index - 1)])
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)])

  const bullets = [
    { icon: Terminal, text: w.whatClis },
    { icon: Server, text: w.whatMcp },
    { icon: Wrench, text: w.whatSkills },
    { icon: ArrowLeftRight, text: w.whatCcswitch },
  ]

  const subtitle = step === "intro" ? w.intro : step === "network" ? w.networkIntro : w.installIntro

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onDismiss()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          {/* The step counter sits beside the title, not inside it: folding it
              into DialogTitle would append "1 / 3" to the dialog's accessible
              name on every step. */}
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" aria-hidden="true" />
              {w.title}
            </DialogTitle>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {t.tour.progress(index + 1, STEPS.length)}
            </span>
          </div>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {step === "intro" ? (
          <>
            {/* Plain-language "what it does" list. */}
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {w.whatTitle}
              </div>
              {bullets.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-2.5 text-sm">
                  <Icon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>{text}</span>
                </div>
              ))}
            </div>

            {/* Preset picker. */}
            <div className="flex flex-col gap-2">
              <div>
                <div className="text-sm font-medium">{w.presetLabel}</div>
                <p className="text-xs text-muted-foreground">{w.presetHint}</p>
              </div>
              <RadioGroup value={preset} onValueChange={setPreset} className="gap-2">
                {PRESET_IDS.map((id) => {
                  const meta = t.presets[id]
                  const active = preset === id
                  return (
                    <Label
                      key={id}
                      htmlFor={`onboarding-preset-${id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:border-primary/50",
                        active && "border-primary ring-1 ring-primary"
                      )}
                    >
                      <RadioGroupItem
                        id={`onboarding-preset-${id}`}
                        value={id}
                        className="mt-0.5"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{meta?.title ?? id}</span>
                        <span className="text-xs text-muted-foreground">{meta?.description}</span>
                      </span>
                    </Label>
                  )
                })}
              </RadioGroup>
            </div>
          </>
        ) : null}

        {step === "network" ? <OnboardingNetworkStep probe={probe} probing={probing} /> : null}

        {step === "install" ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="onboarding-preview" className="cursor-pointer text-sm font-medium">
                {w.previewLabel}
              </Label>
              <p className="text-xs text-muted-foreground">{w.previewHint}</p>
            </div>
            <Switch id="onboarding-preview" checked={dryRun} onCheckedChange={toggleDryRun} />
          </div>
        ) : null}

        <button
          type="button"
          onClick={onTour}
          className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t.tour.start} →
        </button>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onDismiss}>
            {w.later}
          </Button>
          {index > 0 ? (
            <Button variant="outline" onClick={back}>
              {t.tour.back}
            </Button>
          ) : null}
          {isLast ? (
            <Button onClick={() => onInstall(preset)}>
              {dryRun ? w.installPreview : w.install}
            </Button>
          ) : (
            <Button onClick={next}>{t.nav.continue}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
