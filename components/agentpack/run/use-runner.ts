"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { runSteps } from "@/lib/agentpack/runner"
import { buildVerifySteps, planHasSelections, proxyApplySteps } from "@/lib/agentpack/plan"
import { npmRegistryCommand } from "@/lib/agentpack/merge/network"
import type { Plan, StepDescriptor, StepReport } from "@/lib/agentpack/types"
import { recordRun, type ActivitySource } from "@/lib/agentpack/activity"
import { appendActivity } from "@/lib/tauri/activity"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"

export interface RunOpts {
  /** Append verify steps for this plan. */
  plan?: Plan
  /**
   * How this run should be named in the activity log. Optional: with nothing
   * given, the log falls back to the first step's own label, which is already
   * written for a human.
   */
  activity?: { title?: string; source?: ActivitySource }
}

export interface RunnerState {
  reports: StepReport[]
  /** A real, writing execution is in flight. */
  running: boolean
  /** A preview is in flight. Separate from `running` because nothing is at stake. */
  previewing: boolean
  /** The steps are staged and waiting for the user to preview or apply. */
  awaitingConfirm: boolean
  /** How many steps are staged. Drives the palette's "review N changes". */
  pendingCount: number
  /**
   * The staged descriptors, while `awaitingConfirm` is true. The panel reads
   * them to brief the user in plain language — a `StepReport` carries only a
   * label, and the facts that brief needs (a prerequisite, an elevation prompt,
   * an item that can't be done here) live on the descriptor.
   */
  pendingSteps: readonly StepDescriptor[]
  /**
   * The last execution was a preview, so the completion screen must not claim
   * anything was installed. Cleared the moment a real apply starts.
   */
  lastWasPreview: boolean
  /**
   * Whether the user stopped the last run. `skipped` alone can't say so — it also
   * covers steps dropped because a prerequisite failed — and the two need
   * different verdicts on the completion screen.
   */
  cancelled: boolean
  /**
   * Stage a set of descriptors for review and open the panel.
   *
   * Resolves with the reports of the run the user actually applied, or an empty
   * array if they walked away without applying. Callers therefore read exactly
   * as they did when `run` executed immediately — `const reports = await
   * run(steps)` still means "the steps ran and here's what happened" — they just
   * wait for a human in between. That is the point: there is now no code path
   * that writes to the machine without the step list having been on screen.
   */
  run: (steps: StepDescriptor[], opts?: RunOpts) => Promise<StepReport[]>
  /** Render the staged steps as "would …" lines. Touches nothing, clears nothing. */
  previewPending: () => Promise<void>
  /** Execute the staged steps for real. */
  applyPending: () => Promise<void>
  /** Drop the staged steps and release any caller awaiting them. */
  abandonPending: () => void
  /** Re-run only the steps that failed. */
  retry: () => Promise<void>
  cancel: () => void
  /**
   * Register a callback fired once after each real (non-preview) run completes,
   * so the UI can re-detect installed tools and re-scan. Returns an unsubscribe.
   */
  onAfterRun: (fn: () => void) => () => void
}

export function useRunner(): RunnerState {
  const t = useT()
  const paths = useAppStore((s) => s.paths)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const [reports, setReports] = useState<StepReport[]>([])
  const [running, setRunning] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  // One source of truth for "what is staged": the count is derived rather than
  // tracked beside it, so a code path can't update one and forget the other.
  const [pendingSteps, setPendingSteps] = useState<readonly StepDescriptor[]>([])
  const pendingCount = pendingSteps.length
  const [lastWasPreview, setLastWasPreview] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const pending = useRef<StepDescriptor[]>([])
  // The run's full step list, which a retry must NOT narrow: `pending` used to be
  // overwritten with the retried subset, so the first pass's successes vanished
  // from the panel and a second retry had nothing left to draw from.
  const all = useRef<StepDescriptor[]>([])
  const afterRun = useRef<Set<() => void>>(new Set())
  // How this run should be named in the activity log, captured when it was
  // staged. Read at write time rather than closed over, so a retry logs nothing
  // stale if the caller has moved on.
  const activityMeta = useRef<{ title?: string; source?: ActivitySource }>({})
  // `cancelled` as a ref as well as state: the record is written inside the
  // async continuation of `execute`, which closed over the old state value.
  const cancelledRef = useRef(false)
  // Whoever is awaiting the staged run. Exactly one at a time: staging a new set
  // of steps releases the previous awaiter with [] rather than stranding it.
  const settle = useRef<((reports: StepReport[]) => void) | null>(null)
  // `execute` calls the persist prompt, and the persist prompt stages steps —
  // a cycle React's hook ordering can't express directly, so it goes through
  // refs kept in sync below.
  const executeRef = useRef<
    | ((
        steps: StepDescriptor[],
        opts?: { merge?: boolean; preview?: boolean }
      ) => Promise<StepReport[]>)
    | null
  >(null)
  const runRef = useRef<RunnerState["run"] | null>(null)

  const release = useCallback((value: StepReport[]) => {
    const fn = settle.current
    settle.current = null
    fn?.(value)
  }, [])

  /**
   * A retry through a mirror or proxy changed nothing on the machine — that's
   * the design. So when one rescues an install, ask whether to make it stick,
   * rather than either silently rewriting the user's config or leaving them to
   * hit the same failure on every future run.
   *
   * Persisting reuses the writers that already exist (`npmRegistryCommand`,
   * `proxyApplySteps`), so there is exactly one place that knows how to write
   * each of these — and it goes back through `run`, so the one-line config
   * change gets reviewed like everything else.
   */
  const offerToPersistRecovery = useCallback(
    (reports: StepReport[]) => {
      const hint = reports.find((r) => r.recovery?.persist)?.recovery
      if (!hint?.persist) return
      const persist = hint.persist
      toast.success(t.shell.recoveredTitle(hint.label), {
        description: t.shell.recoveredBody,
        duration: 12_000,
        action: {
          label: t.shell.recoveredPersist,
          onClick: () => {
            const store = useAppStore.getState()
            if (persist.kind === "npmRegistry") {
              store.setNetwork({ npmRegistry: persist.url })
              void runRef.current?.(
                [
                  {
                    kind: "command",
                    id: "persist-npm-registry",
                    label: t.steps.npmRegistry(persist.url),
                    command: npmRegistryCommand(persist.url),
                  },
                ],
                { activity: { title: t.steps.npmRegistry(persist.url), source: "recovery" } }
              )
              return
            }
            // Adopt the proxy into the plan, then write it to every surface the
            // user already has selected as a target.
            store.setProxy({ mode: "manual", httpUrl: persist.url, httpsUrl: persist.url })
            const next = useAppStore.getState()
            if (!next.paths) return
            void runRef.current?.(
              proxyApplySteps(next.plan.network.proxy, next.paths, next.plan.os, t),
              { activity: { title: t.network.proxy.apply, source: "recovery" } }
            )
          },
        },
      })
    },
    [t]
  )

  /**
   * Persist what just happened. Fire-and-forget on purpose: the run already
   * succeeded or failed on its own terms, and a failed log write must not
   * change what the user is told about their machine.
   */
  const logActivity = useCallback(async (reports: StepReport[]) => {
    const home = useAppStore.getState().paths?.home
    if (!home || reports.length === 0) return
    const at = Date.now()
    const record = recordRun({
      id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at,
      reports,
      cancelled: cancelledRef.current,
      title: activityMeta.current.title,
      source: activityMeta.current.source,
    })
    useAppStore.getState().setActivity(await appendActivity(home, record))
  }, [])

  const execute = useCallback(
    async (
      steps: StepDescriptor[],
      { merge = false, preview = false }: { merge?: boolean; preview?: boolean } = {}
    ): Promise<StepReport[]> => {
      if (!paths) return []
      if (!merge) {
        all.current = steps
        setReports(steps.map((s) => ({ id: s.id, label: s.label, status: "pending", output: [] })))
      } else {
        // Retry: put the steps being re-run back to pending in place, leaving
        // every other row of the original run exactly as it was.
        const retrying = new Set(steps.map((s) => s.id))
        setReports((prev) =>
          prev.map((r) => (retrying.has(r.id) ? { ...r, status: "pending", output: [] } : r))
        )
      }
      setCancelled(false)
      cancelledRef.current = false
      if (preview) setPreviewing(true)
      else setRunning(true)
      ctrl.current = new AbortController()
      const result = await runSteps(steps, {
        dryRun: preview,
        paths,
        messages: t,
        signal: ctrl.current.signal,
        // Read at call time, not captured: the startup probe may have landed
        // after this hook rendered. Undefined until something measured works,
        // which is what keeps recovery from "retrying" with nothing to change.
        recovery: useAppStore.getState().recoveryContext(),
        // Matched by id rather than by the batch index `i`: on a retry the batch
        // is a subset, so its indices don't line up with the full report list.
        onUpdate: (r) =>
          setReports((prev) =>
            prev.map((prior) => (prior.id === r.id ? { ...r, output: [...r.output] } : prior))
          ),
      })
      if (preview) setPreviewing(false)
      else setRunning(false)
      // A real run may have installed/removed a tool — let subscribers re-detect
      // and re-scan so badges reflect reality without an app restart. Previews
      // change nothing, so they don't fire.
      if (!preview) {
        afterRun.current.forEach((fn) => fn())
        offerToPersistRecovery(result)
        // Only whole runs are logged, not retry batches: a retry's reports are
        // the failed subset, and a record built from those would describe the
        // run as if the steps that already succeeded had never been part of it.
        // The retry's effect shows up in the next full run's starting state.
        if (!merge) void logActivity(result)
      }
      return result
    },
    [paths, t, offerToPersistRecovery, logActivity]
  )

  useEffect(() => {
    executeRef.current = execute
  }, [execute])

  const run = useCallback<RunnerState["run"]>(
    async (steps, opts = {}) => {
      if (!paths) {
        toast.error(t.shell.notInTauri)
        return []
      }
      // Verify steps ride along with real work only. On their own they would
      // turn "everything you picked is already installed" into a staged run of
      // two `--version` checks, which reads as though something is about to be
      // installed when nothing is.
      const withVerify =
        opts.plan && steps.length > 0 ? [...steps, ...buildVerifySteps(opts.plan, t)] : steps
      if (withVerify.length === 0) {
        // Distinguish "nothing was selected" from "everything selected is already
        // installed" — the latter produced zero steps only because the one-click
        // dedup dropped them all, so "select CLIs first" would be wrong and
        // confusing right after the user picked a preset.
        toast.message(planHasSelections(opts.plan) ? t.shell.nothingToDo : t.shell.emptyPlan)
        return []
      }
      // Staging replaces whatever was staged before; whoever was waiting on that
      // gets [] rather than a promise that never settles.
      release([])
      pending.current = withVerify
      all.current = withVerify
      activityMeta.current = opts.activity ?? {}
      setReports(
        withVerify.map((s) => ({ id: s.id, label: s.label, status: "pending", output: [] }))
      )
      setRunning(false)
      setPreviewing(false)
      setCancelled(false)
      setLastWasPreview(false)
      setPendingSteps(withVerify)
      setAwaitingConfirm(true)
      setPanelOpen(true)
      return new Promise<StepReport[]>((resolve) => {
        settle.current = resolve
      })
    },
    [paths, release, setPanelOpen, t]
  )

  useEffect(() => {
    runRef.current = run
  }, [run])

  /**
   * Preview deliberately leaves everything staged. Someone who previews and
   * likes what they read should be one click from applying it — making them
   * rebuild the plan is how a preview button stops being used.
   */
  const previewPending = useCallback(async () => {
    if (pending.current.length === 0) return
    setLastWasPreview(true)
    await execute(pending.current, { preview: true })
  }, [execute])

  const applyPending = useCallback(async () => {
    if (pending.current.length === 0) return
    setAwaitingConfirm(false)
    setLastWasPreview(false)
    const result = await execute(pending.current)
    setPendingSteps([])
    release(result)
  }, [execute, release])

  const abandonPending = useCallback(() => {
    pending.current = []
    setPendingSteps([])
    setAwaitingConfirm(false)
    release([])
  }, [release])

  const retry = useCallback(async () => {
    // Re-run failed steps AND steps skipped because a prerequisite failed: once
    // the prerequisite is fixed, its dependents must run too. runSteps
    // re-evaluates dependsOn within the retry batch, so a still-failing
    // prerequisite simply re-skips them.
    const retryable = new Set(
      reports.filter((r) => r.status === "error" || r.status === "skipped").map((r) => r.id)
    )
    // Drawn from the full run, not from whatever the last batch was, and merged
    // back in place so the panel keeps showing the whole run.
    const steps = all.current.filter((s) => retryable.has(s.id))
    if (steps.length === 0) return
    setLastWasPreview(false)
    await execute(steps, { merge: true })
  }, [reports, execute])

  const cancel = useCallback(() => {
    setCancelled(true)
    cancelledRef.current = true
    ctrl.current?.abort()
  }, [])

  const onAfterRun = useCallback((fn: () => void) => {
    afterRun.current.add(fn)
    return () => {
      afterRun.current.delete(fn)
    }
  }, [])

  return {
    reports,
    running,
    previewing,
    awaitingConfirm,
    pendingCount,
    pendingSteps,
    lastWasPreview,
    cancelled,
    run,
    previewPending,
    applyPending,
    abandonPending,
    retry,
    cancel,
    onAfterRun,
  }
}
