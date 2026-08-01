import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { sectionsOf } from "@/lib/agentpack/workspaces"
import { sectionMeta } from "./sidebar-nav"
import { WorkspaceTabs } from "./workspace-tabs"

const SECTIONS = sectionsOf("install")
const label = (i: number) => sectionMeta(SECTIONS[i]).label(en)

function renderTabs(activeIndex = 0) {
  const onSelect = jest.fn()
  render(
    <I18nProvider>
      <WorkspaceTabs workspace="install" active={SECTIONS[activeIndex]} onSelect={onSelect} />
    </I18nProvider>
  )
  return { onSelect }
}

it("renders one tab per destination, in workspace order", () => {
  renderTabs()
  const tabs = screen.getAllByRole("tab")
  expect(tabs.map((t) => t.textContent)).toEqual(SECTIONS.map((s) => sectionMeta(s).label(en)))
})

it("marks exactly one tab selected and points it at its panel", () => {
  renderTabs(1)
  const tabs = screen.getAllByRole("tab")
  expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1)
  expect(screen.getByRole("tab", { name: label(1) })).toHaveAttribute(
    "aria-controls",
    `panel-${SECTIONS[1]}`
  )
})

it("selects on click", async () => {
  const { onSelect } = renderTabs()
  await userEvent.click(screen.getByRole("tab", { name: label(2) }))
  expect(onSelect).toHaveBeenCalledWith(SECTIONS[2])
})

describe("keyboard", () => {
  it("keeps only the selected tab in the Tab order", () => {
    renderTabs(1)
    const tabs = screen.getAllByRole("tab")
    // Roving tabindex: Tab leaves the strip, arrows move inside it. A strip
    // where every tab is a Tab stop is a strip you have to tab past.
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1)
    expect(tabs[1]).toHaveAttribute("tabindex", "0")
  })

  it("moves with the arrow keys and wraps at both ends", async () => {
    const { onSelect } = renderTabs(0)
    // The handler lives on the strip; keydown from the focused tab bubbles to it.
    screen.getByRole("tab", { name: label(0) }).focus()
    await userEvent.keyboard("{ArrowRight}")
    expect(onSelect).toHaveBeenLastCalledWith(SECTIONS[1])
    // `active` is controlled and unchanged here, so ArrowLeft from the first
    // tab is the wrap case.
    await userEvent.keyboard("{ArrowLeft}")
    expect(onSelect).toHaveBeenLastCalledWith(SECTIONS[SECTIONS.length - 1])
  })

  it("jumps to the ends with Home and End", async () => {
    const { onSelect } = renderTabs(1)
    screen.getByRole("tab", { name: label(1) }).focus()
    await userEvent.keyboard("{Home}")
    expect(onSelect).toHaveBeenLastCalledWith(SECTIONS[0])
    await userEvent.keyboard("{End}")
    expect(onSelect).toHaveBeenLastCalledWith(SECTIONS[SECTIONS.length - 1])
  })

  it("ignores keys that aren't its business", async () => {
    const { onSelect } = renderTabs()
    screen.getByRole("tab", { name: label(0) }).focus()
    await userEvent.keyboard("{ArrowUp}")
    expect(onSelect).not.toHaveBeenCalled()
  })
})

it("never wraps a label onto a second line", () => {
  renderTabs()
  for (const tab of screen.getAllByRole("tab")) {
    // Two-line clickable text is the first thing that breaks at the 900px floor
    // and again when the labels switch language.
    expect(tab.className).toContain("whitespace-nowrap")
  }
})
