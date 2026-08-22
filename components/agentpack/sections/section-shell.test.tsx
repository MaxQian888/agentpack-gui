import { render, screen } from "@testing-library/react"
import { SectionShell } from "./section-shell"

const shellOf = (container: HTMLElement) => container.firstElementChild!

it("keeps a text-led section at the reading measure, and off the wide step", () => {
  // A paragraph 1600px wide is harder to read, not easier — which is why the
  // third step is deliberately not applied here.
  const { container } = render(
    <SectionShell title="Preferences">
      <p>body</p>
    </SectionShell>
  )
  const cls = shellOf(container).className
  expect(cls).toContain("max-w-[var(--hm-content-width)]")
  expect(cls).not.toContain("--hm-content-width-max")
})

it("gives a workbench the wide column and the large-window step", () => {
  // Above 1600px the extra width was becoming margin: at a 2000px window the
  // content sat at 1152 with ~290px of dead space on each side.
  const { container } = render(
    <SectionShell title="Dashboard" wide>
      <p>body</p>
    </SectionShell>
  )
  const cls = shellOf(container).className
  expect(cls).toContain("max-w-[var(--hm-content-width-wide)]")
  expect(cls).toContain("min-[1600px]:max-w-[var(--hm-content-width-max)]")
})

it("still renders its heading, subtitle and slots", () => {
  render(
    <SectionShell
      title="Recovery points"
      subtitle="Every way back"
      actions={<button>Refresh</button>}
    >
      <p>body</p>
    </SectionShell>
  )
  expect(screen.getByRole("heading", { name: "Recovery points" })).toBeInTheDocument()
  expect(screen.getByText("Every way back")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument()
  expect(screen.getByText("body")).toBeInTheDocument()
})
