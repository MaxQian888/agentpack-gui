"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { runSteps } from "@/lib/agentpack/runner"
import { buildVerifySteps } from "@/lib/agentpack/plan"
import type { Plan, StepDescriptor, StepReport } from "@/lib/agentpack/types"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"

export interface RunOpts {
  /** Append verify steps for this plan (real runs only). */
  plan?: Plan
  /** Show the pending step list and wait for confirm() before executing (real runs). */
  review?: boolean
}

export interface RunnerState {
  reports: StepReport[]
  running: boolean
  dryRun: boolean
  awaitingConfirm: boolean
  /**
   * Prepare/run a set of descriptors. Resolves with the final reports so callers
   * can react to success/failure (empty when the run was gated or bailed out).
   */
  run: (steps: StepDescriptor[], opts?: RunOpts) => Promise<StepReport[]>
  /** Execute the reviewed steps (after a review gate). */
  confirm: () => Promise<void>
  /** Re-run only the steps that failed. */
  retry: () => Promise<void>
  cancel: () => void
  /**
   * Register a callback fired once after each real (non-dry) run completes, so
   * the UI can re-detect installed tools and re-scan. Returns an unsubscribe.
   */
  onAfterRun: (fn: () => void) => () => void
}

export function useRunner(): RunnerState {
  const t = useT()
  const dryRun = useAppStore((s) => s.dryRun)
  const paths = useAppStore((s) => s.paths)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const [reports, setReports] = useState<StepReport[]>([])
  const [running, setRunning] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const pending = useRef<StepDescriptor[]>([])
  const afterRun = useRef<Set<() => void>>(new Set())

  const execute = useCallback(
    async (steps: StepDescriptor[]): Promise<StepReport[]> => {
      if (!paths) return []
      pending.current = steps
      setReports(steps.map((s) => ({ id: s.id, label: s.label, status: "pending", output: [] })))
      setRunning(true)
      ctrl.current = new AbortController()
      const reports = await runSteps(steps, {
        dryRun,
        paths,
        messages: t,
        signal: ctrl.current.signal,
        onUpdate: (r, i) =>
          setReports((prev) => {
            const next = [...prev]
            next[i] = { ...r, output: [...r.output] }
            return next
          }),
      })
      setRunning(false)
      // A real run may have installed/removed a tool — let subscribers re-detect
      // and re-scan so badges reflect reality without an app restart. Dry runs
      // change nothing, so they don't fire.
      if (!dryRun) afterRun.current.forEach((fn) => fn())
      return reports
    },
    [dryRun, paths, t]
  )

  const run = useCallback(
    async (steps: StepDescriptor[], opts: RunOpts = {}): Promise<StepReport[]> => {
      if (!paths) {
        toast.error(t.shell.notInTauri)
        return []
      }
      const all = opts.plan && !dryRun ? [...steps, ...buildVerifySteps(opts.plan, t)] : steps
      if (all.length === 0) {
        toast.message(t.shell.emptyPlan)
        return []
      }
      setPanelOpen(true)
      if (opts.review && !dryRun) {
        pending.current = all
        setReports(all.map((s) => ({ id: s.id, label: s.label, status: "pending", output: [] })))
        setRunning(false)
        setAwaitingConfirm(true)
        return []
      }
      setAwaitingConfirm(false)
      return execute(all)
    },
    [dryRun, paths, setPanelOpen, t, execute]
  )

  const confirm = useCallback(async () => {
    setAwaitingConfirm(false)
    await execute(pending.current)
  }, [execute])

  const retry = useCallback(async () => {
    // Re-run failed steps AND steps skipped because a prerequisite failed: once
    // the prerequisite is fixed, its dependents must run too. runSteps
    // re-evaluates dependsOn within the retry batch, so a still-failing
    // prerequisite simply re-skips them.
    const retryable = new Set(
      reports.filter((r) => r.status === "error" || r.status === "skipped").map((r) => r.id)
    )
    const steps = pending.current.filter((s) => retryable.has(s.id))
    if (steps.length === 0) return
    await execute(steps)
  }, [reports, execute])

  const cancel = useCallback(() => ctrl.current?.abort(), [])

  const onAfterRun = useCallback((fn: () => void) => {
    afterRun.current.add(fn)
    return () => {
      afterRun.current.delete(fn)
    }
  }, [])

  return { reports, running, dryRun, awaitingConfirm, run, confirm, retry, cancel, onAfterRun }
}
