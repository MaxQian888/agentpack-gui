jest.mock("@/lib/agentpack/runner", () => ({
  runSteps: jest.fn(
    async (
      steps: { id: string; label: string }[],
      o: { onUpdate: (r: unknown, i: number) => void; dryRun?: boolean }
    ) => {
      const reports = steps.map((s) => ({
        id: s.id,
        label: s.label,
        status: o.dryRun
          ? "done"
          : s.label === "FAIL"
            ? "error"
            : s.label === "SKIP"
              ? "skipped"
              : "done",
        output: o.dryRun ? ["would run: x"] : ["ok"],
      }))
      reports.forEach((r, i) => o.onUpdate(r, i))
      return reports
    }
  ),
}))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))

import { renderHook, act, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import { runSteps } from "@/lib/agentpack/runner"
import { useRunner } from "./use-runner"
import type { Plan, StepDescriptor, StepReport } from "@/lib/agentpack/types"

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
)

const cmd = (id: string, label = id): StepDescriptor => ({
  kind: "command",
  id,
  label,
  command: { file: "x", args: [] },
})

beforeEach(() => useAppStore.setState({ paths: { os: "mac" } as never, panelOpen: false }))

/**
 * Stage steps without awaiting. `run` no longer resolves when the steps have
 * run — it resolves when the *user* has applied them — so awaiting it here
 * would deadlock the test.
 */
function stage(
  result: { current: ReturnType<typeof useRunner> },
  steps: StepDescriptor[],
  opts?: Parameters<ReturnType<typeof useRunner>["run"]>[1]
): Promise<StepReport[]> {
  let promise!: Promise<StepReport[]>
  act(() => {
    promise = result.current.run(steps, opts)
  })
  return promise
}

describe("the review gate", () => {
  it("stages steps and runs nothing until they are applied", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    const settled = stage(result, [cmd("a", "A")])

    await waitFor(() => expect(result.current.awaitingConfirm).toBe(true))
    expect(runSteps).not.toHaveBeenCalled()
    expect(result.current.pendingCount).toBe(1)
    // The panel is opened for the user rather than left to the caller.
    expect(useAppStore.getState().panelOpen).toBe(true)

    await act(async () => {
      await result.current.applyPending()
    })
    expect(result.current.awaitingConfirm).toBe(false)
    expect(result.current.reports[0].status).toBe("done")
    await expect(settled).resolves.toHaveLength(1)
  })

  it("previews without writing, and leaves the steps staged for a later apply", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    void stage(result, [cmd("a", "A")])
    await waitFor(() => expect(result.current.awaitingConfirm).toBe(true))

    await act(async () => {
      await result.current.previewPending()
    })
    expect((runSteps as jest.Mock).mock.calls[0][1].dryRun).toBe(true)
    expect(result.current.lastWasPreview).toBe(true)
    // Still staged — this is the whole point: read the preview, then apply.
    expect(result.current.awaitingConfirm).toBe(true)
    expect(result.current.pendingCount).toBe(1)

    await act(async () => {
      await result.current.applyPending()
    })
    expect((runSteps as jest.Mock).mock.calls[1][1].dryRun).toBe(false)
    expect(result.current.lastWasPreview).toBe(false)
  })

  it("a preview never fires the after-run subscribers", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    const after = jest.fn()
    act(() => {
      result.current.onAfterRun(after)
    })
    void stage(result, [cmd("a", "A")])
    await waitFor(() => expect(result.current.awaitingConfirm).toBe(true))

    await act(async () => {
      await result.current.previewPending()
    })
    expect(after).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.applyPending()
    })
    expect(after).toHaveBeenCalledTimes(1)
  })

  it("abandoning releases the caller with nothing rather than hanging it", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    const settled = stage(result, [cmd("a", "A")])
    await waitFor(() => expect(result.current.awaitingConfirm).toBe(true))

    act(() => result.current.abandonPending())
    await expect(settled).resolves.toEqual([])
    expect(result.current.pendingCount).toBe(0)
    expect(runSteps).not.toHaveBeenCalled()
  })

  it("staging a second batch releases whoever was waiting on the first", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    const first = stage(result, [cmd("a", "A")])
    await waitFor(() => expect(result.current.awaitingConfirm).toBe(true))
    void stage(result, [cmd("b", "B")])
    await expect(first).resolves.toEqual([])
  })
})

describe("refusals", () => {
  it("toasts and bails out when no paths are resolved", async () => {
    useAppStore.setState({ paths: null })
    const { result } = renderHook(() => useRunner(), { wrapper })
    await expect(stage(result, [cmd("a")])).resolves.toEqual([])
    expect(toast.error).toHaveBeenCalled()
    expect(runSteps).not.toHaveBeenCalled()
  })

  it("toasts 'select first' when nothing was selected", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    await expect(stage(result, [])).resolves.toEqual([])
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
    await expect(stage(result, [], { plan })).resolves.toEqual([])
    expect(toast.message).toHaveBeenCalledWith(en.shell.nothingToDo)
    expect(runSteps).not.toHaveBeenCalled()
  })
})

describe("retry", () => {
  async function runAndApply(
    result: { current: ReturnType<typeof useRunner> },
    steps: StepDescriptor[]
  ) {
    void stage(result, steps)
    await waitFor(() => expect(result.current.awaitingConfirm).toBe(true))
    await act(async () => {
      await result.current.applyPending()
    })
  }

  it("re-runs only the failed steps", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    await runAndApply(result, [cmd("ok", "OK"), cmd("bad", "FAIL")])
    expect(result.current.reports.find((r) => r.id === "bad")?.status).toBe("error")
    ;(runSteps as jest.Mock).mockClear()

    await act(async () => {
      await result.current.retry()
    })
    const reRun = (runSteps as jest.Mock).mock.calls[0][0] as StepDescriptor[]
    expect(reRun.map((s) => s.id)).toEqual(["bad"])
    // Merged in place: the first pass's success is still on screen.
    expect(result.current.reports.map((r) => r.id)).toEqual(["ok", "bad"])
  })

  it("also re-runs steps skipped due to a failed dependency", async () => {
    const { result } = renderHook(() => useRunner(), { wrapper })
    await runAndApply(result, [cmd("dep", "FAIL"), cmd("child", "SKIP")])
    expect(result.current.reports.find((r) => r.id === "child")?.status).toBe("skipped")
    ;(runSteps as jest.Mock).mockClear()

    await act(async () => {
      await result.current.retry()
    })
    const reRun = (runSteps as jest.Mock).mock.calls[0][0] as StepDescriptor[]
    expect(reRun.map((s) => s.id)).toEqual(["dep", "child"])
  })
})
