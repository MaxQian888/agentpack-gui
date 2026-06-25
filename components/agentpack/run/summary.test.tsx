import { render, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { Summary } from "./summary"
import type { StepReport } from "@/lib/agentpack/types"

beforeEach(() => useAppStore.getState().resetPlan())

function renderSummary(reports: StepReport[], dryRun = false) {
  return render(
    <I18nProvider>
      <Summary reports={reports} dryRun={dryRun} />
    </I18nProvider>
  )
}

it("renders the setup-complete headline with the success count", () => {
  renderSummary([{ id: "a", label: "A", status: "done", output: [] }])
  expect(screen.getByText(/Setup complete/i)).toBeInTheDocument()
})

it("uses the dry-run headline in preview mode", () => {
  renderSummary([{ id: "a", label: "A", status: "done", output: [] }], true)
  expect(screen.getByText(/Dry-run complete/i)).toBeInTheDocument()
})

it("surfaces failed steps from the store-aware report", () => {
  renderSummary([{ id: "a", label: "Broken", status: "error", output: [], error: "nope" }])
  expect(screen.getByText(/Broken/)).toBeInTheDocument()
})
