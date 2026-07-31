jest.mock("@/lib/agentpack/runner", () => ({
  runSteps: jest.fn(
    async (
      steps: { id: string; label: string }[],
      o: { onUpdate: (r: unknown, i: number) => void }
    ) => {
      steps.forEach((s, i) =>
        o.onUpdate(
          {
            id: s.id,
            label: s.label,
            status: s.label === "FAIL" ? "error" : s.label === "SKIP" ? "skipped" : "done",
            output: ["ok"],
          },
          i
        )
      )
      return []
    }
  ),
}))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))

import { renderHook, act } from "@testing-library/react"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { runSteps } from "@/lib/agentpack/runner"
import { useRunner } from "./use-runner"
import type { Plan, StepDescriptor } from "@/lib/agentpack/types"

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
)

const cmd = (id: string, label = id): StepDescriptor => ({
  kind: "command",
  id,
  label,
  command: { file: "x", args: [] },
})

beforeEach(() => useAppStore.setState({ paths: { os: "mac" } as never, dryRun: true }))

it("run populates reports when paths are present", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("a", "A")])
  })
  expect(result.current.reports[0].status).toBe("done")
})

it("toasts and bails out when no paths are resolved", async () => {
  useAppStore.setState({ paths: null })
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("a")])
  })
  expect(toast.error).toHaveBeenCalled()
  expect(runSteps).not.toHaveBeenCalled()
})

it("toasts 'select first' when nothing was selected", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([])
  })
  expect(toast.message).toHaveBeenCalledWith(en.shell.emptyPlan)
  expect(runSteps).not.toHaveBeenCalled()
})

it("toasts 'already up to date' when a selected plan deduped to nothing", async () => {
  // A preset WAS chosen (plan has selections) but every step was dropped because
  // it's already installed — the message must reflect that, not "select first".
  const plan: Plan = {
    os: "mac",
    clis: ["claude-code"],
    skills: [],
    mcps: [],
    mcpKeys: {},
    network: {},
  }
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([], { plan })
  })
  expect(toast.message).toHaveBeenCalledWith(en.shell.nothingToDo)
  expect(runSteps).not.toHaveBeenCalled()
})

it("review gate waits for confirm before executing", async () => {
  useAppStore.setState({ dryRun: false })
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("a", "A")], { review: true })
  })
  expect(result.current.awaitingConfirm).toBe(true)
  expect(runSteps).not.toHaveBeenCalled()

  await act(async () => {
    await result.current.confirm()
  })
  expect(result.current.awaitingConfirm).toBe(false)
  expect(result.current.reports[0].status).toBe("done")
})

it("retry re-runs only the failed steps", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("ok", "OK"), cmd("bad", "FAIL")])
  })
  expect(result.current.reports.find((r) => r.id === "bad")?.status).toBe("error")
  ;(runSteps as jest.Mock).mockClear()

  await act(async () => {
    await result.current.retry()
  })
  // Only the failed step is re-submitted.
  const reRun = (runSteps as jest.Mock).mock.calls[0][0] as StepDescriptor[]
  expect(reRun.map((s) => s.id)).toEqual(["bad"])
})

it("retry also re-runs steps skipped due to a failed dependency", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("dep", "FAIL"), cmd("child", "SKIP")])
  })
  expect(result.current.reports.find((r) => r.id === "child")?.status).toBe("skipped")
  ;(runSteps as jest.Mock).mockClear()

  await act(async () => {
    await result.current.retry()
  })
  // Both the failed prerequisite and its skipped dependent are re-submitted.
  const reRun = (runSteps as jest.Mock).mock.calls[0][0] as StepDescriptor[]
  expect(reRun.map((s) => s.id)).toEqual(["dep", "child"])
})

/**
 * A retry used to replace `reports` and the pending step list wholesale with the
 * retried subset: the first pass's successes vanished from the panel, the
 * completion counts were recomputed over the subset, and a second retry had a
 * narrowed list to draw from.
 */
it("retry updates the failed step in place, keeping the rest of the run", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("ok", "OK"), cmd("bad", "FAIL"), cmd("ok2", "OK2")])
  })
  expect(result.current.reports).toHaveLength(3)

  await act(async () => {
    await result.current.retry()
  })

  // All three rows are still there, in order, with the untouched ones untouched.
  expect(result.current.reports.map((r) => r.id)).toEqual(["ok", "bad", "ok2"])
  expect(result.current.reports.find((r) => r.id === "ok")?.status).toBe("done")
  expect(result.current.reports.find((r) => r.id === "ok2")?.status).toBe("done")
})

it("a second retry still sees the whole run, not just the last batch", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("dep", "FAIL"), cmd("child", "SKIP"), cmd("ok", "OK")])
  })
  await act(async () => {
    await result.current.retry()
  })
  ;(runSteps as jest.Mock).mockClear()
  await act(async () => {
    await result.current.retry()
  })
  // Still both of them — the first retry didn't shrink what's retryable.
  const reRun = (runSteps as jest.Mock).mock.calls[0][0] as StepDescriptor[]
  expect(reRun.map((s) => s.id)).toEqual(["dep", "child"])
})

it("retry is a no-op when nothing failed", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("ok", "OK")])
  })
  ;(runSteps as jest.Mock).mockClear()
  await act(async () => {
    await result.current.retry()
  })
  expect(runSteps).not.toHaveBeenCalled()
})

it("cancel aborts an in-flight run", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("a", "A")])
  })
  // Just exercising the cancel path; no controller is active after completion.
  act(() => result.current.cancel())
  expect(result.current.running).toBe(false)
})

/**
 * `skipped` alone can't tell a stopped run from one whose prerequisite failed,
 * and the completion screen needs to say different things about the two.
 */
it("records that the user cancelled, and forgets it on the next run", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([cmd("a", "A")])
  })
  expect(result.current.cancelled).toBe(false)

  act(() => result.current.cancel())
  expect(result.current.cancelled).toBe(true)

  await act(async () => {
    await result.current.run([cmd("b", "B")])
  })
  expect(result.current.cancelled).toBe(false)
})
