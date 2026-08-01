"use client"

import { useEffect } from "react"
import { RunnerProvider, useRunnerCtx } from "../runner-context"
import { ExecutionPanel } from "../execution-panel"

/**
 * Test harness for anything that calls `run()`.
 *
 * Every write now stages steps and waits for a human, which means a section
 * test that clicks "Install" and then asserts a file was written would hang
 * forever without something to press Apply. Two modes:
 *
 * - `autoApply` — approve the moment steps are staged. For the many tests whose
 *   subject is *what a step does*, not *whether it was reviewed*. The gate is
 *   still real; this stands in for the user who says yes.
 * - `panel` — render the real review panel and drive it by hand. For the tests
 *   whose subject IS the gate: that nothing is written until Apply, that
 *   Preview writes nothing, that discarding releases the caller.
 *
 * Deliberately not a default-on auto-apply inside `RunnerProvider`: a harness
 * that silently approves everything would let a regression that skips the gate
 * pass the whole suite.
 */
function AutoApply() {
  const { awaitingConfirm, applyPending } = useRunnerCtx()
  useEffect(() => {
    if (awaitingConfirm) void applyPending()
  }, [awaitingConfirm, applyPending])
  return null
}

export function RunnerHarness({
  autoApply = false,
  panel = false,
  children,
}: {
  autoApply?: boolean
  panel?: boolean
  children: React.ReactNode
}) {
  return (
    <RunnerProvider>
      {children}
      {panel ? <ExecutionPanel /> : null}
      {autoApply ? <AutoApply /> : null}
    </RunnerProvider>
  )
}
