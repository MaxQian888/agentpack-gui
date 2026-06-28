jest.mock("@/lib/tauri", () => ({ isTauri: () => false }))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { EnvironmentSection } from "./environment"

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ detections: {}, paths: null, panelOpen: false, dryRun: true })
})

function renderEnv() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <EnvironmentSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("shows the detected runtime version from the store", () => {
  useAppStore.setState({ detections: { node: { installed: true, version: "v20.11.0" } } })
  renderEnv()
  expect(screen.getByText(/v20\.11\.0/)).toBeInTheDocument()
})

it("offers an install action for a missing runtime and opens the run panel", async () => {
  useAppStore.setState({
    detections: { node: { installed: false } },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  const installBtn = screen.getAllByRole("button", { name: /install now/i })[0]
  await userEvent.click(installBtn)
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("shows a not-found badge when a runtime is absent", () => {
  useAppStore.setState({ detections: { bun: { installed: false }, node: { installed: false } } })
  renderEnv()
  expect(screen.getAllByText(/not found/i).length).toBeGreaterThan(0)
})
