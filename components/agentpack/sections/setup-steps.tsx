/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
/* Hallmark · genre: modern-minimal · macrostructure: ordered checklist band · theme: inherited Cobalt · contrast: pass · slop: pass · mobile: pass */
"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type SetupStepStatus = "done" | "current" | "waiting" | "blocked"

export interface SetupStep {
  id: string
  /** The verb, not the noun: "Start the bridge", not "Bridge service". */
  title: string
  /** One plain sentence saying what this step is for, in a beginner's words. */
  description?: React.ReactNode
  /**
   * What the machine measured once the step is settled — a version, a path, a
   * count. Set in mono, because that is what mono means here (design.md §4).
   */
  note?: React.ReactNode
  status: SetupStepStatus
  /** The one control that advances this step. Omit for a step with nothing to do. */
  action?: React.ReactNode
  /** A quieter control alongside it (Uninstall, Show in folder). */
  secondaryAction?: React.ReactNode
}

const MARKER: Record<SetupStepStatus, string> = {
  done: "border-[var(--hm-ok)] text-[var(--hm-ok)]",
  current: "border-primary bg-primary text-primary-foreground",
  waiting: "border-border text-muted-foreground",
  blocked: "border-[var(--hm-warn)] text-[var(--hm-warn)]",
}

/**
 * A section's first-run path, as a numbered checklist.
 *
 * These pages describe staged work — nothing can be started before it is
 * installed, nothing opens before it is started — and the old layout expressed
 * that as three sibling cards of equal weight, each with its own badge row and
 * its own disabled buttons. Someone who had never heard of the tool could not
 * tell which card to touch first, and a disabled button says "not now" without
 * ever saying *why*.
 *
 * So the order is the layout. One panel, one row per step, in the order they
 * must happen. A row states where it stands (done · doing now · waiting on the
 * step above), why in a sentence, and carries the single control that advances
 * it. A step that is done keeps its measured fact and drops its button — the
 * checklist shortens as you work through it instead of staying a wall.
 *
 * The accent appears exactly once here: on the marker of the step you are on.
 * Not on the buttons — a checklist of primary buttons is four primaries, which
 * is three more than design.md allows on a view.
 */
export function SetupSteps({
  title,
  hint,
  steps,
  progressLabel,
  statusLabels,
}: {
  title: string
  hint?: React.ReactNode
  steps: readonly SetupStep[]
  /** Renders the tally, e.g. `(done, total) => "2 of 4 done"`. */
  progressLabel?: (done: number, total: number) => string
  /**
   * The four states as words, for assistive tech. The marker that carries them
   * visually is a colour and a glyph, so without these a screen reader hears
   * four identical rows.
   */
  statusLabels: Record<SetupStepStatus, string>
}) {
  const done = steps.filter((step) => step.status === "done").length

  return (
    <section aria-label={title} className="min-w-0 rounded-lg border">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3">
        <h3 className="font-medium">{title}</h3>
        {progressLabel ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {progressLabel(done, steps.length)}
          </span>
        ) : null}
        {hint ? (
          <p className="min-w-0 basis-full text-xs leading-relaxed text-muted-foreground">{hint}</p>
        ) : null}
      </div>

      <ol className="min-w-0 divide-y border-t">
        {steps.map((step, index) => (
          <li
            key={step.id}
            data-status={step.status}
            className={cn(
              "flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3",
              step.status === "current" && "bg-[var(--hm-accent-soft)]/40"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[var(--hm-radius-dot)] border font-mono text-[var(--hm-text-2xs)] tabular-nums",
                MARKER[step.status]
              )}
            >
              {step.status === "done" ? <Check className="size-3" /> : index + 1}
            </span>

            <div className="min-w-0 flex-1 basis-48">
              <div
                className={cn(
                  "text-sm font-medium",
                  step.status === "waiting" && "text-muted-foreground"
                )}
              >
                {step.title}
              </div>
              {/* The visual state is a colour and a glyph on an aria-hidden
                  marker; without this the four rows sound identical. Kept out
                  of the title element so the title still matches exactly. */}
              <span className="sr-only">{statusLabels[step.status]}</span>
              {step.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              ) : null}
              {step.note ? (
                <p className="mt-1 font-mono text-[var(--hm-text-2xs)] text-muted-foreground [overflow-wrap:anywhere]">
                  {step.note}
                </p>
              ) : null}
            </div>

            {step.action || step.secondaryAction ? (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {step.action}
                {step.secondaryAction}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
