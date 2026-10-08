"use client"

import { useState } from "react"
import { AppWindow, ArrowLeftRight, Server, Sparkles, Terminal, Wrench } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { PRESETS, presetSelection, skillTargetsFor, type Surface } from "@/lib/agentpack/presets"
import { findMcp, SKILLS } from "@/lib/agentpack/registry"
import type { OnboardingProgress } from "@/lib/tauri/settings"
import { probeSuggestsChange } from "@/lib/agentpack/network/probe"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { OnboardingNetworkStep } from "./onboarding-network-step"
import { KeyInput } from "./sections/mcp/helpers"

/** Bundle ids offered on first run, in "gentlest first" order. */
const PRESET_IDS = PRESETS.map((p) => p.id)
const DEFAULT_PRESET = "recommended"
/** The desktop app needs no terminal and no Node, so it leads. */
const DEFAULT_SURFACE: Surface = "gui"

const SURFACES: readonly Surface[] = ["gui", "cli", "both"]

/** Every stop, in order. `network` is dropped when there's nothing to report. */
const STEPS = ["surface", "bundle", "network", "install"] as const
type Step = (typeof STEPS)[number]

/** Persisted progress is plain JSON, so a stale or hand-edited step falls back. */
function asStep(step: string | undefined): Step {
  return STEPS.find((s) => s === step) ?? "surface"
}

/** The skills a bundle brings, which the last step then lets the user adjust. */
function skillsOf(presetId: string): string[] {
  return presetSelection(presetId)?.skills.map((s) => s.id) ?? []
}

/**
 * First-run welcome wizard.
 *
 *  1. **surface** — window or terminal. Asked first and on its own because it
 *     decides what "install Claude" even means, and because the honest answer
 *     for someone who has never opened a terminal is the desktop app.
 *  2. **bundle** — which capabilities to set up. Kept separate from the surface
 *     so bundles don't need a GUI variant apiece (see `applySurface`).
 *  3. **network** — the self-check, *only when the probe found something*. A
 *     blocked network is the most common reason a first install fails, and
 *     finding out before the run beats watching six steps go red — but a
 *     healthy machine shouldn't be made to read green ticks and press Continue.
 *  4. **install** — run it.
 *
 * There is no dry-run toggle here any more. "Preview without changing anything"
 * is a real feature and it stays in the header, but as the *first* question a
 * newcomer is asked it only invites the wrong answer: they press Preview, watch
 * every step report that it would have done something, and conclude the install
 * didn't work.
 *
 * Controlled by the caller: `open` comes from the store's `onboardingOpen` flag
 * (set on a fresh install, or manually from About). The two ways out are kept
 * apart on purpose — `onLater` is the user saying "not now" and is what marks
 * them onboarded, while `onSuspend` (Esc, the overlay) is a mis-click and only
 * records where they got to. `progress` restores that on the next launch.
 */
export function OnboardingDialog({
  open,
  progress,
  onProgress,
  onInstall,
  onLater,
  onSuspend,
  onTour,
}: {
  open: boolean
  /** Where a previously suspended run got to, or null to start from the top. */
  progress: OnboardingProgress | null
  /** Fired on every answer, so the caller can persist it if the wizard is suspended. */
  onProgress: (progress: OnboardingProgress) => void
  /**
   * `keys` carries only the API keys the user actually filled in; `skills` is
   * the final skill selection, which the bundle seeds and the user adjusts.
   */
  onInstall: (
    presetId: string,
    surface: Surface,
    keys: Record<string, string>,
    skills: string[]
  ) => void
  /** "Maybe later" — a deliberate no, which marks the user as onboarded. */
  onLater: () => void
  /** Esc / overlay — an incidental close, which only saves progress. */
  onSuspend: () => void
  /** Start the guided product tour instead of installing right away. */
  onTour: () => void
}) {
  const t = useT()
  const w = t.welcome
  const probe = useAppStore((s) => s.networkProbe)
  const probing = useAppStore((s) => s.networkProbing)
  const [preset, setPreset] = useState(progress?.preset ?? DEFAULT_PRESET)
  const [surface, setSurface] = useState<Surface>(progress?.surface ?? DEFAULT_SURFACE)
  const [step, setStep] = useState<Step>(asStep(progress?.step))
  // Kept local until Install: an abandoned wizard shouldn't leave half-typed keys
  // in the shared plan, and they are deliberately never persisted to disk.
  const [keys, setKeys] = useState<Record<string, string>>({})
  /**
   * Which skills to install. Seeded from the bundle, then adjustable on the last
   * step — the bundles can't choose these for you (they're per-stack: Rust,
   * Android, STM32…), which is why `minimal` and `recommended` carry none, and
   * why the wizard promised skills it never delivered until it started asking.
   */
  const [skills, setSkills] = useState<string[]>(() => skillsOf(progress?.preset ?? DEFAULT_PRESET))

  // Every answer is reported up as a whole, so the caller never has to reassemble
  // one from three separate callbacks.
  const report = (patch: Partial<OnboardingProgress>) =>
    onProgress({ step, preset, surface, ...patch })
  // Changing the bundle re-seeds the skills, so the last step always opens
  // showing what the bundle you just picked would install.
  const pickPreset = (id: string) => {
    setPreset(id)
    setSkills(skillsOf(id))
    report({ preset: id })
  }
  const toggleSkill = (id: string) =>
    setSkills((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  const pickSurface = (id: Surface) => {
    setSurface(id)
    report({ surface: id })
  }

  // Skipping is done by removing the step from the sequence rather than by
  // jumping over it, so Back, Continue and the counter all stay consistent
  // without any of them special-casing it.
  const steps = STEPS.filter((s) => s !== "network" || probing || probeSuggestsChange(probe))
  // A step can vanish under the user if the probe lands late (a healthy network
  // drops `network` from the sequence). Fall back to the LAST step rather than
  // rendering nothing — clamping indexOf's -1 would send them back to step 1,
  // undoing answers they already gave.
  const found = steps.indexOf(step)
  const index = found === -1 ? steps.length - 1 : found
  const current = steps[index]!
  const isLast = index === steps.length - 1
  const go = (to: Step) => {
    setStep(to)
    report({ step: to })
  }
  const back = () => go(steps[Math.max(0, index - 1)]!)
  const next = () => go(steps[Math.min(steps.length - 1, index + 1)]!)

  const bullets = [
    { icon: Terminal, text: w.whatClis },
    { icon: Server, text: w.whatMcp },
    { icon: Wrench, text: w.whatSkills },
    { icon: ArrowLeftRight, text: w.whatCcswitch },
  ]

  const surfaceMeta: Record<Surface, { icon: typeof AppWindow; title: string; hint: string }> = {
    gui: { icon: AppWindow, title: w.surfaceGui, hint: w.surfaceGuiHint },
    cli: { icon: Terminal, title: w.surfaceCli, hint: w.surfaceCliHint },
    both: { icon: Sparkles, title: w.surfaceBoth, hint: w.surfaceBothHint },
  }

  const subtitle =
    current === "surface"
      ? w.intro
      : current === "bundle"
        ? w.bundleIntro
        : current === "network"
          ? w.networkIntro
          : w.installIntro

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onSuspend()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          {/* The step counter sits beside the title, not inside it: folding it
              into DialogTitle would append "1 / 4" to the dialog's accessible
              name on every step. */}
          {/* `pr-8` keeps the counter clear of the dialog's close button,
              which is absolutely placed in the same top-right corner. */}
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" aria-hidden="true" />
              {w.title}
            </DialogTitle>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {t.tour.progress(index + 1, steps.length)}
            </span>
          </div>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {current === "surface" ? (
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

            <div className="flex flex-col gap-2">
              <div>
                <div className="text-sm font-medium">{w.surfaceLabel}</div>
                <p className="text-xs text-muted-foreground">{w.surfaceHint}</p>
              </div>
              <RadioGroup
                value={surface}
                onValueChange={(v) => pickSurface(v as Surface)}
                className="gap-2"
              >
                {SURFACES.map((id) => {
                  const meta = surfaceMeta[id]
                  const Icon = meta.icon
                  return (
                    <Label
                      key={id}
                      htmlFor={`onboarding-surface-${id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:border-primary/50",
                        surface === id && "border-primary ring-1 ring-primary"
                      )}
                    >
                      <RadioGroupItem
                        id={`onboarding-surface-${id}`}
                        value={id}
                        className="mt-0.5"
                      />
                      <span className="flex flex-1 items-start gap-2.5">
                        <Icon
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {meta.title}
                            {id === DEFAULT_SURFACE ? (
                              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                {w.recommendedTag}
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">{meta.hint}</span>
                        </span>
                      </span>
                    </Label>
                  )
                })}
              </RadioGroup>
            </div>
          </>
        ) : null}

        {current === "bundle" ? (
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-sm font-medium">{w.presetLabel}</div>
              <p className="text-xs text-muted-foreground">{w.presetHint}</p>
            </div>
            <RadioGroup value={preset} onValueChange={pickPreset} className="gap-2">
              {PRESET_IDS.map((id) => {
                const meta = t.presets[id]
                // Its size, for the surface already chosen — read from the same
                // function the store applies, so it is the real bundle rather
                // than a second description of it. Without it the only way to
                // tell Minimal from Everything is to pick one and walk to the
                // last step, which is a question answered by trial and error.
                const picked = presetSelection(id, surface)
                return (
                  <Label
                    key={id}
                    htmlFor={`onboarding-preset-${id}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:border-primary/50",
                      preset === id && "border-primary ring-1 ring-primary"
                    )}
                  >
                    <RadioGroupItem id={`onboarding-preset-${id}`} value={id} className="mt-0.5" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{meta?.title ?? id}</span>
                      <span className="text-xs text-muted-foreground">{meta?.description}</span>
                      {picked ? (
                        <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {t.presetsScreen.presetCounts(
                            picked.clis.length,
                            picked.skills.length,
                            picked.mcps.length
                          )}
                        </span>
                      ) : null}
                    </span>
                  </Label>
                )
              })}
            </RadioGroup>
          </div>
        ) : null}

        {current === "network" ? <OnboardingNetworkStep probe={probe} probing={probing} /> : null}

        {current === "install" ? (
          <InstallSummary
            preset={preset}
            surface={surface}
            keys={keys}
            onKeyChange={(id, v) => setKeys((prev) => ({ ...prev, [id]: v }))}
            skills={skills}
            onSkillToggle={toggleSkill}
          />
        ) : null}

        <button
          type="button"
          onClick={onTour}
          className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t.tour.start} →
        </button>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onLater}>
            {w.later}
          </Button>
          {index > 0 ? (
            <Button variant="outline" onClick={back}>
              {t.tour.back}
            </Button>
          ) : null}
          {isLast ? (
            <Button onClick={() => onInstall(preset, surface, nonEmpty(keys), skills)}>
              {w.install}
            </Button>
          ) : (
            <Button onClick={next}>{w.continue}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Drop the keys the user left blank, so an empty box never becomes an empty key. */
function nonEmpty(keys: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim() !== ""))
}

/**
 * The final step: what the chosen bundle actually installs, the skills to go
 * with it, and the API keys it needs. All three are here for the same reason —
 * the wizard used to end on a blank screen with an Install button, so the first
 * time anyone saw the list was in the review panel, a key-gated server
 * (context7, github, both in the Recommended bundle) went in without its key and
 * silently didn't work, and the skills the first screen promised were never
 * installed at all unless you picked "everything".
 *
 * The CLI and MCP lists come from `presetSelection`, the same function the store
 * applies, so this is a preview of the real plan rather than a second
 * description of it. Skills are the one editable part: they're per-stack, so a
 * bundle can't pick them for you.
 */
function InstallSummary({
  preset,
  surface,
  keys,
  onKeyChange,
  skills,
  onSkillToggle,
}: {
  preset: string
  surface: Surface
  keys: Record<string, string>
  onKeyChange: (id: string, value: string) => void
  skills: string[]
  onSkillToggle: (id: string) => void
}) {
  const t = useT()
  const w = t.welcome
  const detections = useAppStore((s) => s.detections)
  const picked = presetSelection(preset, surface)

  const clis = picked?.clis ?? []
  const mcps = picked?.mcps ?? []
  const skillTargets = skillTargetsFor(clis)
  const targetNames = (targets: readonly string[]) =>
    targets.map((tg) => t.mcp.targets[tg] ?? tg).join(" · ")
  // Only the servers this bundle actually selects, so the key list can't ask for
  // a credential that nothing here will use.
  const keyed = mcps
    .map((m) => findMcp(m.id))
    .filter((m): m is NonNullable<typeof m> => !!m?.keyEnv)

  if (clis.length + mcps.length === 0 && SKILLS.length === 0) {
    return <p className="text-sm text-muted-foreground">{w.summaryNothing}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
        <SummaryGroup icon={Terminal} title={w.summaryClis}>
          {clis.map((id) => (
            <SummaryRow
              key={id}
              label={t.catalog.cli[id]?.title ?? id}
              installed={detections[id]?.installed}
              installedLabel={w.summaryInstalled}
            />
          ))}
        </SummaryGroup>
        {mcps.length > 0 ? (
          <SummaryGroup
            icon={Server}
            title={w.summaryMcp}
            note={w.summaryWritesTo(targetNames(mcps[0]!.targets))}
          >
            {mcps.map((m) => (
              <SummaryRow key={m.id} label={t.catalog.mcp[m.id]?.title ?? m.id} />
            ))}
          </SummaryGroup>
        ) : null}
      </div>

      {/* Checkable, unlike the two lists above: the bundle seeds these but can't
          know whether you write Rust or Android, so it asks. */}
      <div className="flex flex-col gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wrench className="size-4 text-muted-foreground" aria-hidden="true" />
            {w.summarySkills}
          </div>
          <p className="text-xs text-muted-foreground">{w.skillsHint}</p>
          {skills.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {w.summaryWritesTo(targetNames(skillTargets))}
            </p>
          ) : null}
        </div>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {SKILLS.map((skill) => (
            <label
              key={skill.id}
              htmlFor={`onboarding-skill-${skill.id}`}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-muted/50"
            >
              <Checkbox
                id={`onboarding-skill-${skill.id}`}
                checked={skills.includes(skill.id)}
                onCheckedChange={() => onSkillToggle(skill.id)}
              />
              <span className="min-w-0 flex-1 truncate">
                {t.catalog.skills[skill.id]?.title ?? skill.id}
              </span>
            </label>
          ))}
        </div>
      </div>

      {keyed.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div>
            <div className="text-sm font-medium">{w.keysTitle}</div>
            <p className="text-xs text-muted-foreground">{w.keysHint}</p>
          </div>
          {keyed.map((server) => (
            <div key={server.id} className="flex flex-col gap-1">
              <Label htmlFor={`onboarding-key-${server.id}`} className="text-xs font-normal">
                {t.catalog.mcp[server.id]?.title ?? server.id}
              </Label>
              <KeyInput
                ariaLabel={`${server.id} ${server.keyEnv}`}
                placeholder={server.keyEnv}
                value={keys[server.id] ?? ""}
                onChange={(v) => onKeyChange(server.id, v)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** A titled group in the summary, with an optional "configured for: …" sub-line. */
function SummaryGroup({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: typeof AppWindow
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-5.5">{children}</div>
    </div>
  )
}

/** One item, with a green dot when it's already on the machine. */
function SummaryRow({
  label,
  installed,
  installedLabel,
}: {
  label: string
  installed?: boolean
  installedLabel?: string
}) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      {label}
      {installed ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--hm-ok)]"
          title={installedLabel}
          aria-label={installedLabel}
        />
      ) : null}
    </span>
  )
}
