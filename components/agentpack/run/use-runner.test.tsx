jest.mock("@/lib/agentpack/runner", () => ({
  runSteps: jest.fn(async (steps: { id: string; label: string }[], o) => {
    steps.forEach((s, i) =>
      o.onUpdate({ id: s.id, label: s.label, status: "done", output: ["ok"] }, i)
    )
    return []
  }),
}))

import { renderHook, act } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { useRunner } from "./use-runner"

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
)

it("run populates reports when paths are present", async () => {
  useAppStore.setState({ paths: { os: "mac" } as never, dryRun: true })
  const { result } = renderHook(() => useRunner(), { wrapper })
  await act(async () => {
    await result.current.run([
      { kind: "command", id: "a", label: "A", command: { file: "x", args: [] } },
    ])
  })
  expect(result.current.reports[0].status).toBe("done")
})
