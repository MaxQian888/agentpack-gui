import { render, renderHook } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider, useRunnerCtx } from "./runner-context"

it("throws when useRunnerCtx is used outside a RunnerProvider", () => {
  const Bad = () => {
    useRunnerCtx()
    return null
  }
  const spy = jest.spyOn(console, "error").mockImplementation(() => {})
  expect(() => render(<Bad />)).toThrow(/RunnerProvider/)
  spy.mockRestore()
})

it("exposes the runner state through the provider", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider>
      <RunnerProvider>{children}</RunnerProvider>
    </I18nProvider>
  )
  const { result } = renderHook(() => useRunnerCtx(), { wrapper })
  expect(result.current).toHaveProperty("run")
  expect(result.current.running).toBe(false)
})
