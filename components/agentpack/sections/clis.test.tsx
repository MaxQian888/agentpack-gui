import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { ClisSection } from "./clis"

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ detections: {} })
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

it("offers an upgrade action for installed non-GUI tools", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderClis()
  expect(screen.getByRole("button", { name: /Upgrade/i })).toBeInTheDocument()
})
