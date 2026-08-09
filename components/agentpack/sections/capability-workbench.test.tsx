import { render, screen } from "@testing-library/react"
import { CapabilityMetric, CapabilityTile, CapabilityWorkbench } from "./capability-workbench"

describe("CapabilityWorkbench", () => {
  it("organizes metrics, primary work, supporting actions, and details", () => {
    render(
      <CapabilityWorkbench
        title="Capabilities"
        subtitle="Manage local integrations"
        summaryLabel="Capability summary"
        actionsLabel="Capability actions"
        metrics={
          <>
            <CapabilityMetric label="Installed" value={12} />
            <CapabilityMetric label="Needs attention" value={2} detail="Scan errors" />
          </>
        }
        primary={<section aria-label="Installed capabilities">Primary</section>}
        aside={<CapabilityTile title="Add capability">Supporting action</CapabilityTile>}
        detail={<section aria-label="Capability details">Details</section>}
      />
    )

    expect(screen.getByRole("heading", { name: "Capabilities" })).toBeInTheDocument()
    expect(screen.getByText("Manage local integrations")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Capability summary" })).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Installed capabilities" })).toBeInTheDocument()
    expect(screen.getByRole("complementary", { name: "Capability actions" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Capability details" })).toBeInTheDocument()
  })

  it("marks the selected supporting tile without changing its action semantics", () => {
    render(
      <CapabilityTile title="Catalog" active action={<button type="button">Open</button>}>
        Built-in choices
      </CapabilityTile>
    )

    expect(screen.getByRole("region", { name: "Catalog" })).toHaveAttribute("data-selected", "true")
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled()
  })
})
