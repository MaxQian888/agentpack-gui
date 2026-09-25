import { render as rtlRender, screen } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { StepLog } from "./step-log"
import type { StepReport } from "@/lib/agentpack/types"

const render = (ui: React.ReactElement) => rtlRender(<I18nProvider>{ui}</I18nProvider>)

const report = (over: Partial<StepReport>): StepReport => ({
  id: "x",
  label: "x",
  status: "pending",
  output: [],
  ...over,
})

it("renders one row per report with its label", () => {
  render(
    <StepLog
      reports={[
        report({ id: "a", label: "Step A", status: "done" }),
        report({ id: "b", label: "Step B", status: "running" }),
      ]}
    />
  )
  expect(screen.getByText("Step A")).toBeInTheDocument()
  expect(screen.getByText("Step B")).toBeInTheDocument()
  expect(screen.getAllByRole("listitem")).toHaveLength(2)
})

it("renders every status icon variant without throwing", () => {
  const statuses: StepReport["status"][] = [
    "pending",
    "running",
    "done",
    "error",
    "skipped",
    "warning",
  ]
  render(<StepLog reports={statuses.map((s, i) => report({ id: `s${i}`, label: s, status: s }))} />)
  for (const s of statuses) expect(screen.getByText(s)).toBeInTheDocument()
})

it("shows an output/error pre block only when there is content", () => {
  const { container } = render(
    <StepLog
      reports={[
        report({ id: "with", label: "with", status: "error", output: ["log line"], error: "boom" }),
        report({ id: "without", label: "without", status: "done" }),
      ]}
    />
  )
  const pres = container.querySelectorAll("pre")
  expect(pres).toHaveLength(1)
  expect(pres[0].textContent).toContain("log line")
  expect(pres[0].textContent).toContain("boom")
})

it("says each step's state in words, not only with a coloured icon", () => {
  render(<StepLog reports={[report({ id: "a", label: "Install X", status: "error" })]} />)
  // The icon is aria-hidden; the word is what a screen reader hears.
  expect(screen.getByRole("listitem")).toHaveTextContent(`${en.review.status.error}: Install X`)
})
