"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, Loader2, Play, Sparkles, Terminal } from "lucide-react"
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
import {
  AGENT_CHOICES,
  asAgentChoice,
  DEFAULT_AGENT,
  needsProxyStep,
  networkAdoption,
  type AgentChoice,
} from "@/lib/agentpack/onboarding"
import type { InventoryInput } from "@/lib/agentpack/inventory"
import type { NavigateIntent, SectionKey } from "@/lib/agentpack/workspaces"
import type { OnboardingProgress } from "@/lib/tauri/settings"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { DesktopOnlyNote } from "./desktop-only-note"
import { OnboardingNetworkStep } from "./onboarding-network-step"
import { RunBody, RunProgress, useRunView } from "./run/run-view"

/** Every stop, in order. `network` is dropped unless the machine needs a proxy. */
const STEPS = ["agent", "network", "review"] as const
type Step = (typeof STEPS)[number]

/** Persisted progress is plain JSON, so a stale or hand-edited step falls back. */
function asStep(step: string | undefined): Step {
  return STEPS.find((s) => s === step) ?? "agent"
}

/** Everything the wizard asks, as one value the shell can stage from. */
export interface WizardAnswer {
  agent: AgentChoice
  desktop: boolean
  /** Keep the proxy the probe found (only asked when one is needed). */
  proxy: boolean
  /** Keep the faster npm / GitHub mirror the probe found. */
  mirrors: boolean
}

/**
 * What staging a review produced. `staged` is the only one with a review to
 * draw; the rest each have their own sentence, because "nothing happened"
 * reads as a broken button.
 */
export type StageOutcome = "staged" | "empty" | "unavailable" | "busy" | "failed"

type Stage = "idle" | "preparing" | StageOutcome

/**
 * First-run welcome wizard. It ends where the agent works, not where a list of
 * picks is handed to another panel.
 *
 *  1. **agent** — which coding agent, plus whether to add its desktop app.
 *     The one real question: everything else is derived (`wizardSelection`),
 *     including the three servers that need no account. Skills and key-gated
 *     servers are asked for afterwards, from Overview, once the agent works.
 *  2. **network** — only when the direct route fails and a proxy works. Kept by
 *     default; a faster mirror is a line in the review instead.
 *  3. **review** — the real review: the same staged steps, brief and Apply as
 *     the side panel, drawn here (`run({ inline })`). It is the only gate —
 *     there is no summary page before it, and no second panel after it — and
 *     the run, its failures and Retry all stay on this screen.
 *
 * There is no Preview button here. Preview is a real feature of the side
 * panel, but offered to a newcomer it only invites the wrong reading: every
 * step reports what it would have done, and the install looks like it failed.
 *
 * The ways out are kept apart on purpose. `onLater` ("Maybe later", or Done on
 * a machine with nothing to change) is a deliberate no and marks the user
 * onboarded; so does Install now, through `onApplied`. `onSuspend` (Esc, the
 * overlay, before Install now) is a mis-click and only records where they got
 * to. After Install now, closing just closes — and if the run is still going,
 * it carries on in the side panel.
 */
export function OnboardingDialog({
  open,
  progress,
  onProgress,
  scan = null,
  onStage,
  onApplied,
  onLater,
  onSuspend,
  onClose,
  onNavigate,
}: {
  open: boolean
  /** Where a previously suspended run got to, or null to start from the top. */
  progress: OnboardingProgress | null
  /** Fired on every answer, so the caller can persist it if the wizard is suspended. */
  onProgress: (progress: OnboardingProgress) => void
  /** The last dashboard scan, for the brief's "already installed" count. */
  scan?: InventoryInput["scan"]
  /** Stage the answer as a review this dialog draws. Resolves once staging is decided. */
  onStage: (answer: WizardAnswer) => Promise<StageOutcome>
  /** Install now was pressed. Carries the GitHub mirror the run was built with. */
  onApplied: (ghMirrorPrefix?: string) => void
  /** "Maybe later" — a deliberate no, which marks the user as onboarded. */
  onLater: () => void
  /** Esc / overlay before Install now — an incidental close, which only saves progress. */
  onSuspend: () => void
  /** Close after Install now. Onboarding is already recorded. */
  onClose: () => void
  /** Follow a failure's reading (or a to-do) to the page that fixes it. */
  onNavigate?: (section: SectionKey, intent?: NavigateIntent) => void
}) {
  const t = useT()
  const w = t.welcome
  const probe = useAppStore((s) => s.networkProbe)
  const probing = useAppStore((s) => s.networkProbing)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const view = useRunView(scan)

  const [agent, setAgent] = useState<AgentChoice>(asAgentChoice(progress?.agent))
  const [desktop, setDesktop] = useState(progress?.desktop ?? false)
  const [proxy, setProxy] = useState(progress?.proxy ?? true)
  const [mirrors, setMirrors] = useState(true)
  const [step, setStep] = useState<Step>(asStep(progress?.step))
  const [stage, setStage] = useState<Stage>("idle")
  // Install now has been pressed. From here on the review is a run log, and
  // closing the dialog no longer means "not now".
  const [applied, setApplied] = useState(false)
  // Bumped by "Try again", which restages the same answer.
  const [attempt, setAttempt] = useState(0)

  const answer: WizardAnswer = { agent, desktop, proxy, mirrors }
  const answerKey = JSON.stringify(answer)
  // The answer the current staging belongs to. A different answer — Back and a
  // new pick, or the mirror opt-out — restages; the same one never does.
  const stagedFor = useRef<string | null>(null)

  // Every answer is reported up as a whole, so the caller never has to reassemble
  // one from separate callbacks.
  const report = (patch: Partial<OnboardingProgress>) =>
    onProgress({ step, agent, desktop, proxy, ...patch })

  // Skipping is done by removing the step from the sequence rather than by
  // jumping over it, so Back, Continue and the counter all stay consistent
  // without any of them special-casing it. While the probe is in flight the
  // step stays in, so a proxy found late still gets asked about.
  const steps = STEPS.filter((s) => s !== "network" || probing || needsProxyStep(probe))
  // A step can vanish under the user if the probe lands late. Fall back to the
  // LAST step rather than rendering nothing — clamping indexOf's -1 would send
  // them back to step 1, undoing answers they already gave.
  const found = steps.indexOf(step)
  const index = found === -1 ? steps.length - 1 : found
  const current = steps[index]!

  /** Drop a review this dialog staged and is no longer showing. */
  const unstage = () => {
    if (view.awaitingConfirm) view.abandonPending()
    stagedFor.current = null
    setStage("idle")
  }
  const go = (to: Step) => {
    if (current === "review" && to !== "review") unstage()
    setStep(to)
    report({ step: to })
  }
  const back = () => go(steps[Math.max(0, index - 1)]!)
  const next = () => go(steps[Math.min(steps.length - 1, index + 1)]!)

  useEffect(() => {
    if (!open || current !== "review" || applied || stagedFor.current === answerKey) return
    stagedFor.current = answerKey
    setStage("preparing")
    void onStage(JSON.parse(answerKey) as WizardAnswer).then((outcome) => {
      // A later answer took over while this one was preparing.
      if (stagedFor.current === answerKey) setStage(outcome)
    })
  }, [open, current, applied, answerKey, attempt, onStage])

  const adoption = networkAdoption(probe, answer)
  const mirrorLabels = [
    adoption.npmRegistry ? `${adoption.npmRegistry.label} (npm)` : null,
    adoption.ghMirrorPrefix ? `${adoption.ghMirrorPrefix.label} (GitHub)` : null,
  ].filter((l): l is string => !!l)

  const install = () => {
    onApplied(adoption.ghMirrorPrefix?.url)
    setApplied(true)
    void view.applyPending()
  }
  const later = () => {
    unstage()
    onLater()
  }
  const dismiss = () => {
    if (applied) {
      // The run outlives the dialog; hand it to the side panel rather than
      // leave it running somewhere nobody can see.
      if (view.busy) setPanelOpen(true)
      onClose()
      return
    }
    unstage()
    onSuspend()
  }

  const ready = current === "review" && stage === "staged" && view.awaitingConfirm && !view.busy
  const subtitle =
    current === "agent"
      ? w.intro
      : current === "network"
        ? w.networkIntro
        : !applied
          ? // Only a staged review has "exact changes" to point at; every other
            // outcome is its own sentence, said once, up here.
            stage === "empty"
            ? w.nothingToDo
            : stage === "unavailable"
              ? w.picksReady
              : stage === "busy" || stage === "failed"
                ? w.stageFailed
                : w.reviewIntro
          : view.finished
            ? w.finishedIntro
            : w.installingIntro

  const agentMeta: Record<AgentChoice, { icon: typeof Bot; title: string; hint: string }> = {
    "claude-code": { icon: Terminal, title: w.agentClaude, hint: w.agentClaudeHint },
    codex: { icon: Bot, title: w.agentCodex, hint: w.agentCodexHint },
    both: { icon: Sparkles, title: w.agentBoth, hint: w.agentBothHint },
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && dismiss()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          {/* The step counter sits beside the title, not inside it: folding it
              into DialogTitle would append "1 / 3" to the dialog's accessible
              name on every step. `pr-8` keeps it clear of the close button,
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

        {current === "agent" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div>
                <div className="text-sm font-medium">{w.agentLabel}</div>
                <p className="text-xs text-muted-foreground">{w.agentHint}</p>
              </div>
              <RadioGroup
                value={agent}
                onValueChange={(v) => {
                  setAgent(v as AgentChoice)
                  report({ agent: v })
                }}
                className="gap-2"
              >
                {AGENT_CHOICES.map((id) => {
                  const meta = agentMeta[id]
                  const Icon = meta.icon
                  return (
                    <Label
                      key={id}
                      htmlFor={`onboarding-agent-${id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:border-primary/50",
                        agent === id && "border-primary ring-1 ring-primary"
                      )}
                    >
                      <RadioGroupItem id={`onboarding-agent-${id}`} value={id} className="mt-0.5" />
                      <span className="flex flex-1 items-start gap-2.5">
                        <Icon
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {meta.title}
                            {id === DEFAULT_AGENT ? (
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
            <Label
              htmlFor="onboarding-desktop"
              className="flex cursor-pointer items-start gap-3 font-normal"
            >
              <Checkbox
                id="onboarding-desktop"
                checked={desktop}
                onCheckedChange={(v) => {
                  setDesktop(v === true)
                  report({ desktop: v === true })
                }}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{w.desktopLabel}</span>
                <span className="text-xs text-muted-foreground">{w.desktopHint}</span>
              </span>
            </Label>
            <p className="text-xs text-muted-foreground">{w.coreNote}</p>
          </div>
        ) : null}

        {current === "network" ? (
          <OnboardingNetworkStep
            probe={probe}
            probing={probing}
            adopt={proxy}
            onAdoptChange={(v) => {
              setProxy(v)
              report({ proxy: v })
            }}
          />
        ) : null}

        {current === "review" ? (
          <div className="flex min-w-0 flex-col gap-4">
            {stage === "preparing" || stage === "idle" ? (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {w.preparing}
              </div>
            ) : stage === "unavailable" ? (
              <DesktopOnlyNote>{w.unavailable}</DesktopOnlyNote>
            ) : stage === "empty" || stage === "busy" || stage === "failed" ? null : (
              <>
                {!applied && mirrorLabels.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {w.mirrorNote(mirrorLabels.join(", "))}{" "}
                    <button
                      type="button"
                      onClick={() => {
                        unstage()
                        setMirrors(false)
                      }}
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      {w.mirrorDecline}
                    </button>
                  </p>
                ) : null}
                <RunProgress view={view} />
                <RunBody
                  view={view}
                  onNavigate={
                    onNavigate
                      ? (section, intent) => {
                          if (view.busy) setPanelOpen(true)
                          onNavigate(section, intent)
                        }
                      : undefined
                  }
                />
              </>
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          {applied ? (
            view.busy ? (
              <Button variant="outline" onClick={view.cancel}>
                {t.shell.cancel}
              </Button>
            ) : (
              <>
                {view.finished && view.canRetry ? (
                  <Button variant="outline" onClick={() => void view.retry()}>
                    {t.shell.retry}
                  </Button>
                ) : null}
                <Button onClick={onClose}>{w.done}</Button>
              </>
            )
          ) : (
            <>
              <Button variant="ghost" onClick={later}>
                {w.later}
              </Button>
              {index > 0 ? (
                <Button variant="outline" onClick={back}>
                  {t.tour.back}
                </Button>
              ) : null}
              {current !== "review" ? (
                <Button onClick={next}>{t.welcome.continue}</Button>
              ) : stage === "empty" || stage === "unavailable" ? (
                <Button onClick={later}>{w.done}</Button>
              ) : stage === "busy" || stage === "failed" ? (
                <Button
                  onClick={() => {
                    stagedFor.current = null
                    setAttempt((n) => n + 1)
                  }}
                >
                  {w.tryAgain}
                </Button>
              ) : (
                <Button disabled={!ready} onClick={install}>
                  <Play className="size-4" />
                  {w.installNow}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
