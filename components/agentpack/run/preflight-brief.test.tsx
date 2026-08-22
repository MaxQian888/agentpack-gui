import { render, screen, within } from "@testing-library/react"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { PreflightBrief } from "./preflight-brief"
import type { PreflightReport } from "@/lib/agentpack/preflight"

const p = en.preflight

const report = (notes: PreflightReport["notes"]): PreflightReport => ({
  verdict: notes[0]?.tone ?? "ready",
  changeCount: notes.length,
  alreadyCount: null,
  notes,
})

const renderBrief = (r: PreflightReport) =>
  render(
    <I18nProvider>
      <PreflightBrief report={r} />
    </I18nProvider>
  )

it("renders nothing when there is nothing to say", () => {
  // A brief that always appears teaches people to scroll past it, and then it
  // isn't there when it matters.
  const { container } = renderBrief(report([]))
  expect(container).toBeEmptyDOMElement()
})

it("shows each note's sentence, and its reason underneath", () => {
  renderBrief(
    report([
      { id: "elevation", tone: "warn", title: p.elevationTitle, detail: p.elevationDetail(2) },
    ])
  )
  expect(screen.getByText(p.elevationTitle)).toBeInTheDocument()
  expect(screen.getByText(p.elevationDetail(2))).toBeInTheDocument()
})

it("states each tone in words, because the mark that carries it is aria-hidden", () => {
  renderBrief(
    report([
      { id: "a", tone: "blocked", title: "Cannot do this" },
      { id: "b", tone: "warn", title: "Watch out" },
      { id: "c", tone: "info", title: "By the way" },
    ])
  )
  const rows = screen.getAllByRole("listitem")
  expect(within(rows[0]).getByText(`${p.tone.blocked}:`)).toBeInTheDocument()
  expect(within(rows[1]).getByText(`${p.tone.warn}:`)).toBeInTheDocument()
  expect(within(rows[2]).getByText(`${p.tone.info}:`)).toBeInTheDocument()
})

it("keeps the notes in the order it was given", () => {
  renderBrief(
    report([
      { id: "a", tone: "blocked", title: "First" },
      { id: "b", tone: "info", title: "Second" },
    ])
  )
  const rows = screen.getAllByRole("listitem")
  expect(rows[0]).toHaveTextContent("First")
  expect(rows[1]).toHaveTextContent("Second")
})

it("names its region, so the panel isn't one undifferentiated column", () => {
  renderBrief(report([{ id: "a", tone: "info", title: "Something" }]))
  expect(screen.getByRole("region", { name: p.title })).toBeInTheDocument()
})

it("omits the second line for a note that has no reason to give", () => {
  renderBrief(report([{ id: "a", tone: "info", title: "Just this" }]))
  expect(screen.getByRole("listitem").querySelectorAll("p")).toHaveLength(1)
})
