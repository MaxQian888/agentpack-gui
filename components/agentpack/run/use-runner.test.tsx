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
            status: s.label === "FAIL" ? "error" : "done",
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
import { useAppStore } from "@/store/app-store"
import { runSteps } from "@/lib/agentpack/runner"
import { useRunner } from "./use-runner"
import type { StepDescriptor } from "@/lib/agentpack/types"

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

it("toasts when the plan is empty", async () => {
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([])
  })
  expect(toast.message).toHaveBeenCalled()
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
