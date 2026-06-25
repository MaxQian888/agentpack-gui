"use client"

import { createContext, useContext } from "react"
import { useRunner, type RunnerState } from "./use-runner"

const Ctx = createContext<RunnerState | null>(null)

export function RunnerProvider({ children }: { children: React.ReactNode }) {
  const runner = useRunner()
  return <Ctx.Provider value={runner}>{children}</Ctx.Provider>
}

export function useRunnerCtx(): RunnerState {
  const c = useContext(Ctx)
  if (!c) throw new Error("useRunnerCtx must be used within a RunnerProvider")
  return c
}
