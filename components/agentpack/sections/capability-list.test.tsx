import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  CapabilityEmpty,
  CapabilityGroupHeading,
  CapabilityList,
  CapabilityRow,
  RowChip,
} from "./capability-list"

it("keeps a long capability inventory inside its own named scroll region", () => {
  render(
    <CapabilityList label="Installed skills" className="custom-list">
      <CapabilityGroupHeading title="Development" count={2} />
      <CapabilityRow title="Rust" description="Rust tooling" />
    </CapabilityList>
  )

  const list = screen.getByRole("list", { name: "Installed skills" })
  expect(list).toHaveClass(
    "max-h-(--hm-list-max-h)",
    "overflow-x-hidden",
    "overflow-y-auto",
    "custom-list"
  )
  const heading = screen.getByRole("heading", { name: "Development 2" })
  expect(heading).toBeInTheDocument()
  expect(heading.closest("li")).toHaveClass("sticky", "top-0", "z-10")
})

it("opens row details through an explicitly named title control", async () => {
  const onOpen = jest.fn()
  render(
    <CapabilityList label="Servers">
      <CapabilityRow
        title="Memory"
        openLabel="Open Memory details"
        onOpen={onOpen}
        tags="Bundled"
        status={<RowChip tone="warn">Update</RowChip>}
        actions={<button type="button">Remove</button>}
      >
        <button type="button">Configure</button>
      </CapabilityRow>
    </CapabilityList>
  )

  await userEvent.click(screen.getByRole("button", { name: "Open Memory details" }))

  expect(onOpen).toHaveBeenCalledTimes(1)
  expect(screen.getByText("Bundled")).toBeInTheDocument()
  expect(screen.getByText("Update")).toHaveClass("text-[var(--hm-warn)]")
  expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument()
})

it("renders a non-interactive row title when no detail action exists", () => {
  render(
    <CapabilityList label="Servers">
      <CapabilityRow title="Memory" titleId="memory-title" />
    </CapabilityList>
  )

  expect(screen.getByText("Memory")).toHaveAttribute("id", "memory-title")
  expect(screen.queryByRole("button", { name: "Memory" })).not.toBeInTheDocument()
})

it("pairs an empty-state explanation with its recovery action", () => {
  render(<CapabilityEmpty message="No matching skills" action={<button>Clear filters</button>} />)

  expect(screen.getByText("No matching skills")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument()
})
