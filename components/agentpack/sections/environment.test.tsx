jest.mock("@/lib/tauri", () => ({ isTauri: () => false }))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
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

it("offers Update + Reinstall for an installed runtime and opens the run panel", async () => {
  // Node has both an install method and an upgrade command on macOS.
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  await userEvent.click(screen.getByRole("button", { name: en.shell.update }))
  expect(useAppStore.getState().panelOpen).toBe(true)
  expect(screen.getByRole("button", { name: en.shell.reinstall })).toBeInTheDocument()
})

it("reinstalls an installed runtime through the run panel", async () => {
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  await userEvent.click(screen.getByRole("button", { name: en.shell.reinstall }))
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("hides Update + Reinstall where a runtime has no automated path (Linux node)", () => {
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    paths: { os: "linux" } as never,
  })
  renderEnv()
  expect(screen.queryByRole("button", { name: en.shell.update })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.shell.reinstall })).not.toBeInTheDocument()
})
