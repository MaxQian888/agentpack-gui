import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { zhCN } from "@/lib/i18n/zh-CN"
import { GuidedTour } from "./guided-tour"
import { SECTIONS } from "./sidebar-nav"

const s = en.tour.steps
/** The rail + every section + the palette and the change tray. */
const TOTAL = SECTIONS.length + 3

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
  await clickNext() // → the second section in rail order
  const second = SECTIONS[1].key
  expect(screen.getByText(s[second].title)).toBeInTheDocument()
  expect(onNavigate).toHaveBeenCalledWith(second)
  expect(screen.getByText(en.tour.progress(3, TOTAL))).toBeInTheDocument()
})

describe("coverage", () => {
  // A tour that skips a section leaves the user believing that feature doesn't
  // exist. These assertions are what keep "the guide covers everything" true
  // after the next section is added, rather than something we remember to check.
  it("visits every section in the sidebar", async () => {
    const { onNavigate } = renderTour()
    for (let i = 0; i < TOTAL - 1; i++) await clickNext()
    const visited = new Set(onNavigate.mock.calls.map(([key]) => key))
    for (const section of SECTIONS) {
      expect(visited).toContain(section.key)
    }
  })

  it("has copy for every stop in both languages", () => {
    const ids = ["nav", ...SECTIONS.map((x) => x.key), "command", "review"]
    for (const id of ids) {
      expect(en.tour.steps[id]?.title).toBeTruthy()
      expect(en.tour.steps[id]?.body).toBeTruthy()
      expect(zhCN.tour.steps[id]?.title).toBeTruthy()
      expect(zhCN.tour.steps[id]?.body).toBeTruthy()
    }
  })
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
  expect(screen.getByText(s.review.title)).toBeInTheDocument()
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
