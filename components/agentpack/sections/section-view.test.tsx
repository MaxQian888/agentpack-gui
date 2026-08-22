import { render, screen } from "@testing-library/react"
import { SectionView } from "./section-view"

const spyOnScroll = () => jest.spyOn(Element.prototype, "scrollIntoView").mockImplementation()

afterEach(() => jest.restoreAllMocks())

it("names and heads the open view", () => {
  spyOnScroll()
  render(
    <SectionView label="Installed skills" title="Installed" choice="installed">
      <p>body</p>
    </SectionView>
  )
  expect(screen.getByRole("region", { name: "Installed skills" })).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Installed" })).toBeInTheDocument()
})

it("does not scroll on the first render", () => {
  // Arriving in a section must leave its heading and status band on screen.
  const scrollIntoView = spyOnScroll()
  render(
    <SectionView label="Installed skills" title="Installed" choice="installed">
      <p>body</p>
    </SectionView>
  )
  expect(scrollIntoView).not.toHaveBeenCalled()
})

it("scrolls when the choice changes, and not on an unrelated re-render", () => {
  const scrollIntoView = spyOnScroll()
  const { rerender } = render(
    <SectionView label="Installed skills" title="Installed" choice="installed">
      <p>body</p>
    </SectionView>
  )

  // Same view, fresh children (a refreshed scan) — the reader stays put.
  rerender(
    <SectionView label="Installed skills" title="Installed" choice="installed">
      <p>refreshed</p>
    </SectionView>
  )
  expect(scrollIntoView).not.toHaveBeenCalled()

  rerender(
    <SectionView label="Skill management details" title="Bundled" choice="catalog">
      <p>body</p>
    </SectionView>
  )
  // No `behavior`, so the reduce-motion rules in globals.css still decide.
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" })
  expect(scrollIntoView).toHaveBeenCalledTimes(1)
})
