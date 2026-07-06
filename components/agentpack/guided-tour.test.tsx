import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { GuidedTour } from "./guided-tour"

const s = en.tour.steps
const TOTAL = 10

afterEach(() => jest.restoreAllMocks())

function renderTour() {
  const onClose = jest.fn()
  const onNavigate = jest.fn()
  const view = render(
    <I18nProvider>
      <GuidedTour onClose={onClose} onNavigate={onNavigate} />
    </I18nProvider>
  )
  return { onClose, onNavigate, view }
}

const clickNext = () => userEvent.click(screen.getByRole("button", { name: en.tour.next }))

it("opens on the first step and navigates to its section", () => {
  const { onNavigate } = renderTour()
  expect(screen.getByText(s.nav.title)).toBeInTheDocument()
  expect(screen.getByText(en.tour.progress(1, TOTAL))).toBeInTheDocument()
  // Step 1 has no Back button.
  expect(screen.queryByRole("button", { name: en.tour.back })).not.toBeInTheDocument()
  expect(onNavigate).toHaveBeenCalledWith("dashboard")
})

it("steps forward through the sections, auto-navigating each", async () => {
  const { onNavigate } = renderTour()
  await clickNext() // → dashboard
  expect(screen.getByText(s.dashboard.title)).toBeInTheDocument()
  await clickNext() // → presets
  expect(screen.getByText(s.presets.title)).toBeInTheDocument()
  expect(onNavigate).toHaveBeenCalledWith("presets")
  expect(screen.getByText(en.tour.progress(3, TOTAL))).toBeInTheDocument()
})

it("goes back to the previous step", async () => {
  renderTour()
  await clickNext()
  expect(screen.getByText(s.dashboard.title)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.tour.back }))
  expect(screen.getByText(s.nav.title)).toBeInTheDocument()
})

it("finishes on the last step via Done", async () => {
  const { onClose } = renderTour()
  for (let i = 0; i < TOTAL - 1; i++) await clickNext()
  expect(screen.getByText(s.run.title)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.tour.next })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.tour.done }))
  expect(onClose).toHaveBeenCalled()
})

it("closes when Skip is pressed", async () => {
  const { onClose } = renderTour()
  await userEvent.click(screen.getByRole("button", { name: en.tour.skip }))
  expect(onClose).toHaveBeenCalled()
})

it("closes on Escape", async () => {
  const { onClose } = renderTour()
  await userEvent.keyboard("{Escape}")
  expect(onClose).toHaveBeenCalled()
})

it("spotlights the measured target and positions the popover", async () => {
  // jsdom returns zero rects; feed a sidebar-like box so measurement + placement run.
  const box = { top: 100, left: 0, width: 240, height: 600, right: 240, bottom: 700, x: 0, y: 100 }
  jest
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockReturnValue({ ...box, toJSON: () => box } as DOMRect)
  render(
    <I18nProvider>
      <div data-tour="nav">sidebar</div>
      <GuidedTour onClose={jest.fn()} onNavigate={jest.fn()} />
    </I18nProvider>
  )
  await waitFor(() => expect(screen.getByTestId("tour-spotlight")).toBeInTheDocument())
})
