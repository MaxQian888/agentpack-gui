"use client"

import { Progress } from "@/components/ui/progress"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { preflight } from "@/lib/agentpack/preflight"
import { buildInventory } from "@/lib/agentpack/inventory"
import type { InventoryInput } from "@/lib/agentpack/inventory"
import type { NavigateIntent, SectionKey } from "@/lib/agentpack/workspaces"
import { useRunnerCtx } from "./runner-context"
import { StepLog } from "./step-log"
import { Completion } from "./completion"
import { PreflightBrief } from "./preflight-brief"

/**
 * The review, drawn wherever it is drawn.
 *
 * The side panel and the first-run wizard both show a staged run, and they
 * must show the *same* one — the same brief, the same step log, the same
 * completion screen — or the wizard becomes a second gate that describes a
 * run its neighbour disagrees with. So the derivation lives here and each
 * surface keeps only its own chrome: a sheet header and footer, or the
 * wizard's.
 */
export function useRunView(scan: InventoryInput["scan"]) {
  const t = useT()
  const runner = useRunnerCtx()
  // Read from the store here rather than passed down. `refreshDetections`
  // writes `latestVersions` and `cliManagers` once per installed CLI,
  // un-batched — subscribing the shell to those slices made every one of ~20
  // startup writes re-render the whole window.
  const detections = useAppStore((s) => s.detections)
  const latestVersions = useAppStore((s) => s.latestVersions)
  const cliManagers = useAppStore((s) => s.cliManagers)
  const networkProbe = useAppStore((s) => s.networkProbe)
  const paths = useAppStore((s) => s.paths)
  const { reports, pendingSteps, running, previewing, awaitingConfirm, lastWasPreview, runPlan } =
    runner
  const busy = running || previewing
  const finished = !busy && !awaitingConfirm && reports.length > 0
  // Also offered after a cancelled run: everything still to do is `skipped`, and
  // retry picks those up, so Retry is how you resume.
  const canRetry = reports.some((r) => r.status === "error" || r.status === "skipped")
  const doneCount = reports.filter((r) => r.status !== "pending" && r.status !== "running").length
  // A preview that has finished but is still staged: the log now holds "would …"
  // lines, and Apply is still the next step.
  const previewed = awaitingConfirm && !busy && lastWasPreview
  // Only while the decision is still the user's. During the run the log is the
  // thing to read, and a brief about what is "about to" happen would be stale
  // the moment the first step starts.
  const brief =
    awaitingConfirm && !busy
      ? preflight(t, pendingSteps, {
          // The run's own plan, or none: an MCP add must not be briefed about
          // the API keys of whatever preset is sitting in the tray.
          plan: runPlan ?? undefined,
          // Only folded while a surface is actually asking — the readings are
          // otherwise recomputed on every store write for a review nobody sees.
          inventory: buildInventory({
            scan,
            detections,
            latestVersions,
            cliManagers,
            networkProbe,
            paths,
          }),
        })
      : null
  return { ...runner, busy, finished, canRetry, doneCount, previewed, brief }
}

export type RunView = ReturnType<typeof useRunView>

/** The n/m bar, shown once a run has started. */
export function RunProgress({ view }: { view: RunView }) {
  const { reports, awaitingConfirm, doneCount } = view
  if (reports.length === 0 || awaitingConfirm) return null
  return (
    <div className="flex items-center gap-3">
      <Progress value={(doneCount / reports.length) * 100} className="h-1.5 flex-1" />
      <span aria-live="polite" className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {doneCount}/{reports.length}
      </span>
    </div>
  )
}

/** Brief, completion and step log — everything between a surface's header and footer. */
export function RunBody({
  view,
  onNavigate,
}: {
  view: RunView
  /** Follow a failure's reading (or a to-do) to the page that fixes it. */
  onNavigate?: (section: SectionKey, intent?: NavigateIntent) => void
}) {
  return (
    <>
      {view.brief ? <PreflightBrief report={view.brief} /> : null}
      {view.finished ? (
        <Completion
          reports={view.reports}
          plan={view.runPlan}
          dryRun={view.lastWasPreview}
          cancelled={view.cancelled}
          onNavigate={onNavigate}
        />
      ) : null}
      <StepLog reports={view.reports} />
    </>
  )
}
