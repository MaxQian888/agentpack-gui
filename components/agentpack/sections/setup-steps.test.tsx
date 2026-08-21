import { render, screen, within } from "@testing-library/react"
import { SetupSteps, type SetupStep } from "./setup-steps"

const LABELS = {
  done: "done",
  current: "do this next",
  waiting: "waiting on the step above",
  blocked: "needs attention",
} as const

const STEPS: SetupStep[] = [
  { id: "a", title: "Install it", note: "v1.2.3", status: "done" },
  { id: "b", title: "Configure it", description: "Name a folder.", status: "current" },
  { id: "c", title: "Start it", status: "waiting" },
]

function renderSteps(steps: SetupStep[] = STEPS) {
  return render(
    <SetupSteps
      title="Get it running"
      hint="Three steps, in order."
      steps={steps}
      progressLabel={(done, total) => `${done} of ${total} done`}
      statusLabels={LABELS}
    />
  )
}

it("numbers the steps in order and ticks the ones that are done", () => {
  renderSteps()
  const rows = screen.getAllByRole("listitem")
  expect(rows.map((row) => row.dataset.status)).toEqual(["done", "current", "waiting"])
  // The done row drops its number for a check; the rest keep their position, so
  // "step 3" means the third row whether or not the ones above it are finished.
  expect(within(rows[1]).getByText("2")).toBeInTheDocument()
  expect(within(rows[2]).getByText("3")).toBeInTheDocument()
})

it("counts only completed steps in the progress tally", () => {
  renderSteps()
  expect(screen.getByText("1 of 3 done")).toBeInTheDocument()
})

it("states each status in words, because the marker itself is aria-hidden", () => {
  renderSteps()
  const rows = screen.getAllByRole("listitem")
  expect(within(rows[0]).getByText(LABELS.done)).toBeInTheDocument()
  expect(within(rows[1]).getByText(LABELS.current)).toBeInTheDocument()
  expect(within(rows[2]).getByText(LABELS.waiting)).toBeInTheDocument()
  // The title must stay exactly matchable — the status word is its sibling, not
  // part of it, so a caller can still assert on the title alone.
  expect(screen.getByText("Install it")).toBeInTheDocument()
})

it("renders a step's own controls, and nothing where a step has none", () => {
  renderSteps([
    {
      ...STEPS[1],
      action: <button>Create config</button>,
      secondaryAction: <button>Reveal</button>,
    },
    STEPS[2],
  ])
  const rows = screen.getAllByRole("listitem")
  expect(within(rows[0]).getByRole("button", { name: "Create config" })).toBeInTheDocument()
  expect(within(rows[0]).getByRole("button", { name: "Reveal" })).toBeInTheDocument()
  expect(within(rows[1]).queryByRole("button")).not.toBeInTheDocument()
})

it("omits the tally when no progress label is given", () => {
  render(<SetupSteps title="Untallied" steps={STEPS} statusLabels={LABELS} />)
  expect(screen.queryByText(/of 3 done/)).not.toBeInTheDocument()
  expect(screen.getByRole("region", { name: "Untallied" })).toBeInTheDocument()
})
