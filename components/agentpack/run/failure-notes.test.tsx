import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { groupFailures } from "@/lib/agentpack/failure"
import type { StepReport } from "@/lib/agentpack/types"
import { FailureNotes } from "./failure-notes"

const f = en.failure

const failed = (id: string, label: string, output: string[]): StepReport => ({
  id,
  label,
  status: "error",
  output,
})

function renderNotes(reports: StepReport[], withNav = true) {
  const onNavigate = jest.fn()
  render(
    <I18nProvider>
      <FailureNotes groups={groupFailures(en, reports)} {...(withNav ? { onNavigate } : {})} />
    </I18nProvider>
  )
  return { onNavigate, user: userEvent.setup() }
}

it("renders nothing when nothing failed", () => {
  const { container } = render(
    <I18nProvider>
      <FailureNotes groups={[]} />
    </I18nProvider>
  )
  expect(container).toBeEmptyDOMElement()
})

it("explains the failure in words and names the steps it accounts for", () => {
  renderNotes([failed("cli-x", "Install X", ["npm ERR! code EBADENGINE"])])
  expect(screen.getByText(f.nodeTooOldTitle)).toBeInTheDocument()
  expect(screen.getByText(f.nodeTooOldAdvice)).toBeInTheDocument()
  expect(screen.getByText("Install X")).toBeInTheDocument()
})

it("quotes the machine's own words, so a wrong reading is visibly wrong", () => {
  renderNotes([failed("cli-x", "Install X", ["npm ERR! code EBADENGINE"])])
  expect(screen.getByText("npm ERR! code EBADENGINE")).toBeInTheDocument()
  expect(screen.getByText(f.evidenceLabel)).toBeInTheDocument()
})

it("offers the page that fixes it, and reports which one was chosen", async () => {
  const { onNavigate, user } = renderNotes([failed("cli-x", "Install X", ["ENOSPC"])])
  await user.click(screen.getByRole("button", { name: f.openSection(en.menu.cleanup) }))
  expect(onNavigate).toHaveBeenCalledWith("cleanup")
})

it("draws no button when there is nowhere to send anyone", async () => {
  // An unreadable failure has no page that helps; a button labelled with a
  // guess would be worse than none.
  renderNotes([failed("cli-x", "Install X", ["internal assertion 42"])])
  expect(screen.getByText(f.unknownTitle)).toBeInTheDocument()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

it("draws no button when the caller has nowhere to navigate to", () => {
  renderNotes([failed("cli-x", "Install X", ["ENOSPC"])], false)
  expect(screen.getByText(f.diskFullTitle)).toBeInTheDocument()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

it("says one thing once, whatever the number of steps that hit it", () => {
  renderNotes([
    failed("a", "Install A", ["ETIMEDOUT"]),
    failed("b", "Install B", ["ETIMEDOUT"]),
    failed("c", "Install C", ["ETIMEDOUT"]),
  ])
  expect(screen.getAllByText(f.networkAdvice)).toHaveLength(1)
  const row = screen.getByText(f.networkTitle).closest("li")!
  for (const label of ["Install A", "Install B", "Install C"]) {
    expect(within(row).getByText(label)).toBeInTheDocument()
  }
})

it("keeps two different causes as two readings", () => {
  renderNotes([failed("a", "Install A", ["ETIMEDOUT"]), failed("b", "Install B", ["ENOSPC"])])
  expect(screen.getByText(f.networkTitle)).toBeInTheDocument()
  expect(screen.getByText(f.diskFullTitle)).toBeInTheDocument()
})

it("names its region, so the panel isn't one undifferentiated column", () => {
  renderNotes([failed("a", "Install A", ["ETIMEDOUT"])])
  expect(screen.getByRole("region", { name: f.heading })).toBeInTheDocument()
})
