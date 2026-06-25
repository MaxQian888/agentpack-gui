import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { ClisSection } from "./clis"

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ detections: {}, latestVersions: {} })
})

function renderClis() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <ClisSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("shows detected version from the store and toggles selection", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.2.3" } },
  })
  renderClis()
  expect(await screen.findAllByText(/1\.2\.3/)).not.toHaveLength(0)
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(useAppStore.getState().plan.clis.length).toBeGreaterThan(0)
})

it("offers an upgrade action when a newer version is available", () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  renderClis()
  expect(screen.getByRole("button", { name: /Upgrade/i })).toBeInTheDocument()
})

it("shows a latest badge and no upgrade when already current", () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "2.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  renderClis()
  expect(screen.queryByRole("button", { name: /Upgrade/i })).not.toBeInTheDocument()
  expect(screen.getByText("latest")).toBeInTheDocument()
})

it("hides the upgrade button when the latest version is unknown", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderClis()
  expect(screen.queryByRole("button", { name: /Upgrade/i })).not.toBeInTheDocument()
})

it("runs an upgrade step when the upgrade button is clicked", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
    paths: { os: "mac" } as never,
    dryRun: true,
    panelOpen: false,
  })
  renderClis()
  await userEvent.click(screen.getByRole("button", { name: /Upgrade/i }))
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("shows a not-found badge for a detected-but-missing tool", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: false } } })
  renderClis()
  expect(screen.getAllByText(/not found/i).length).toBeGreaterThan(0)
})
