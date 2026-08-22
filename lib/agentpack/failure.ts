/**
 * Why a step failed, and what to do about it — the other half of
 * `preflight.ts`.
 *
 * The pre-flight brief says what is about to happen; this says what happened
 * instead. Both exist for the same reason: a run's own output is a record, not
 * an explanation. `npm ERR! code EBADENGINE` is a complete answer for someone
 * who already knows what it means, and a dead end for everyone else — and the
 * dead end arrives at the worst possible moment, on a first install, with a red
 * mark and a Retry button that will do exactly the same thing again.
 *
 * Four rules the shape enforces:
 *
 * 1. **Every reading ends somewhere real.** A cause is only worth naming if
 *    there is a page in this app, or one concrete act, that addresses it — Node
 *    too old goes to Runtimes, no disk goes to Clean up, refused downloads go to
 *    Network. "Check your configuration" is not a diagnosis; it is the absence
 *    of one wearing a diagnosis's clothes.
 * 2. **An unreadable failure says so.** `unknown` is a real verdict with its own
 *    honest advice, not a bucket that gets the nearest-sounding explanation. A
 *    confident wrong reading sends someone to fix a page that was never broken,
 *    and costs them the one thing they had — the command's actual output.
 * 3. **The patterns live in one place.** The network, permission and
 *    missing-binary verdicts come from `classifyFailure`, the same function the
 *    runner's retry ladder gates on, so an explanation and an automatic retry
 *    can't disagree about what kind of failure this was. Only the two causes it
 *    has no opinion about are matched here.
 * 4. **One reading per cause, not per step.** Five steps that all died on the
 *    same blocked download are one problem with one fix; printing the same
 *    paragraph five times is how the fix stops being read.
 */

import type { Messages } from "@/lib/i18n/types"
import type { StepReport } from "./types"
import { classifyFailure, failureEvidence } from "./network/recovery"
import type { SectionKey } from "./workspaces"

export type FailureCause =
  "nodeTooOld" | "diskFull" | "network" | "permission" | "notFound" | "unknown"

/**
 * npm's own code for "this package's `engines.node` is above your Node".
 *
 * `buildSteps` already refuses this up front for every floor the registry knows
 * about (`minNodeMajor`), so reaching here means a package published a floor we
 * don't carry yet — which is exactly when the user needs telling, because
 * nothing warned them.
 */
const NODE_TOO_OLD: readonly RegExp[] = [/\bEBADENGINE\b/i, /unsupported engine/i]

/** Out of space. The download had nowhere to land. */
const DISK_FULL: readonly RegExp[] = [
  /\bENOSPC\b/i,
  /no space left on device/i,
  /not enough space/i,
  /there is not enough space on the disk/i,
]

export interface FailureDiagnosis {
  cause: FailureCause
  /** What happened, in one sentence. */
  title: string
  /** What to do about it. */
  advice: string
  /** Where the fix lives in this app, when it lives somewhere. */
  destination?: SectionKey
  /** Label for the control that goes there. Present exactly when `destination` is. */
  actionLabel?: string
  /**
   * The line the tool itself printed that led to this reading. Quoted so the
   * user can see the diagnosis is drawn from their machine rather than guessed
   * — and so a wrong reading is visibly wrong instead of merely wrong.
   */
  evidence?: string
}

/**
 * The sections a failure can send someone to. Narrower than `SectionKey` on
 * purpose: every one of them needs a label below, and a union that admitted all
 * twenty-four would let a destination be added without one.
 */
type FailureDestination = Extract<SectionKey, "environment" | "cleanup" | "network" | "clis">

/** Where each cause is fixed. Absent means there is no page that helps. */
const DESTINATION: Partial<Record<FailureCause, FailureDestination>> = {
  nodeTooOld: "environment",
  diskFull: "cleanup",
  network: "network",
  // Some tools publish a user-scope install method that needs no elevation, and
  // the CLIs section is where that choice is made.
  permission: "clis",
  notFound: "environment",
}

/** Each destination's own name, so the button says where it goes. */
const DESTINATION_LABEL: Record<FailureDestination, (t: Messages) => string> = {
  environment: (t) => t.menu.environment,
  cleanup: (t) => t.menu.cleanup,
  network: (t) => t.menu.network,
  clis: (t) => t.menu.clis,
}

const matchesAny = (text: string, patterns: readonly RegExp[]) => patterns.some((p) => p.test(text))

/** Every line a step produced, including the error the runner recorded. */
function linesOf(report: StepReport): string[] {
  return [...report.output, ...(report.error ? [report.error] : [])]
}

/** The first line matching one of these patterns, for the two local causes. */
function localEvidence(lines: readonly string[], patterns: readonly RegExp[]): string | undefined {
  return lines.find((line) => matchesAny(line, patterns))?.trim() || undefined
}

/**
 * Read one failed step.
 *
 * Null for anything that didn't fail — a warning is not a failure, and a
 * skipped step failed only because something before it did, so explaining it
 * would put the blame two rows below where it belongs.
 */
export function diagnoseFailure(t: Messages, report: StepReport): FailureDiagnosis | null {
  if (report.status !== "error") return null
  const f = t.failure
  const lines = linesOf(report)

  // Most specific first. Both of these are precise codes with exactly one
  // meaning, so they outrank the broader transport and rights verdicts below.
  if (matchesAny(lines.join("\n"), NODE_TOO_OLD)) {
    return build(t, "nodeTooOld", f.nodeTooOldTitle, f.nodeTooOldAdvice, localEvidence(lines, NODE_TOO_OLD)) // prettier-ignore
  }
  if (matchesAny(lines.join("\n"), DISK_FULL)) {
    return build(t, "diskFull", f.diskFullTitle, f.diskFullAdvice, localEvidence(lines, DISK_FULL))
  }

  // The three the retry ladder already reasons about, read from the same
  // function it gates on.
  const cls = classifyFailure(lines)
  const evidence = failureEvidence(lines, cls)
  if (cls === "network") return build(t, "network", f.networkTitle, f.networkAdvice, evidence)
  if (cls === "permission")
    return build(t, "permission", f.permissionTitle, f.permissionAdvice, evidence)
  if (cls === "notFound") return build(t, "notFound", f.notFoundTitle, f.notFoundAdvice, evidence)

  // Nothing recognisable. Say that, and hand back the one thing that is
  // definitely true — what the command printed.
  return {
    cause: "unknown",
    title: f.unknownTitle,
    advice: f.unknownAdvice,
    evidence: lastMeaningfulLine(lines),
  }
}

function build(
  t: Messages,
  cause: FailureCause,
  title: string,
  advice: string,
  evidence: string | undefined
): FailureDiagnosis {
  const destination = DESTINATION[cause]
  return {
    cause,
    title,
    advice,
    destination,
    actionLabel: destination ? t.failure.openSection(DESTINATION_LABEL[destination](t)) : undefined,
    evidence,
  }
}

/**
 * The last line that carries anything, for a failure nothing matched.
 *
 * The last line rather than the first: tools print their banner and their
 * progress before they print what went wrong, so the top of the output is
 * almost never the interesting part.
 */
function lastMeaningfulLine(lines: readonly string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (line) return line
  }
  return undefined
}

export interface FailureGroup {
  diagnosis: FailureDiagnosis
  /** The failed steps this one reading covers, in the order they ran. */
  steps: readonly { id: string; label: string }[]
}

/**
 * Every distinct reason a run failed, each with the steps it accounts for.
 *
 * Grouped by cause because that is the unit the user acts on: five steps that
 * all died on the same blocked download are one problem with one fix, and the
 * fix stops being read somewhere around the third copy of it.
 */
export function groupFailures(t: Messages, reports: readonly StepReport[]): FailureGroup[] {
  const groups = new Map<FailureCause, FailureGroup>()
  for (const report of reports) {
    const diagnosis = diagnoseFailure(t, report)
    if (!diagnosis) continue
    const existing = groups.get(diagnosis.cause)
    const step = { id: report.id, label: report.label }
    if (existing) {
      // The first step's evidence is kept: it is the one whose quote the
      // heading was written from, and a group with a quote from its third
      // member reads as though the others said something else.
      groups.set(diagnosis.cause, { ...existing, steps: [...existing.steps, step] })
    } else {
      groups.set(diagnosis.cause, { diagnosis, steps: [step] })
    }
  }
  return [...groups.values()]
}
