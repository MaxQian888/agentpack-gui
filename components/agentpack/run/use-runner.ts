"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { runSteps } from "@/lib/agentpack/runner"
import { buildVerifySteps } from "@/lib/agentpack/plan"
import type { Plan, StepDescriptor, StepReport } from "@/lib/agentpack/types"
import { useAppStore } from "@/store/app-store"
import { useT } from "@/lib/i18n/provider"

export interface RunnerState {
  reports: StepReport[]
  running: boolean
  dryRun: boolean
  /** Run a set of descriptors. Pass `plan` to also append verify steps (real runs). */
  run: (steps: StepDescriptor[], plan?: Plan) => Promise<void>
  cancel: () => void
}

export function useRunner(): RunnerState {
  const t = useT()
  const dryRun = useAppStore((s) => s.dryRun)
  const paths = useAppStore((s) => s.paths)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const [reports, setReports] = useState<StepReport[]>([])
  const [running, setRunning] = useState(false)
  const ctrl = useRef<AbortController | null>(null)

  const run = useCallback(
    async (steps: StepDescriptor[], plan?: Plan) => {
      if (!paths) {
        toast.error(t.shell.notInTauri)
        return
      }
      const all = plan && !dryRun ? [...steps, ...buildVerifySteps(plan, t)] : steps
      if (all.length === 0) {
        toast.message(t.shell.emptyPlan)
        return
      }
      setPanelOpen(true)
      setRunning(true)
      ctrl.current = new AbortController()
      setReports(all.map((s) => ({ id: s.id, label: s.label, status: "pending", output: [] })))
      await runSteps(all, {
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
    },
    [dryRun, paths, setPanelOpen, t]
  )

  const cancel = useCallback(() => ctrl.current?.abort(), [])

  return { reports, running, dryRun, run, cancel }
}
