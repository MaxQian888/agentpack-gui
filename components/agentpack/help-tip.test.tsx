import { render, screen } from "@testing-library/react"
import { HelpTip } from "./help-tip"

function renderTip(props: React.ComponentProps<typeof HelpTip>) {
  // HelpTip bundles its own TooltipProvider, so it renders standalone.
  return render(<HelpTip {...props} />)
}

it("names the trigger by its help text for assistive tech", () => {
  renderTip({ text: "MCP servers are plugins." })
  expect(screen.getByRole("button", { name: "MCP servers are plugins." })).toBeInTheDocument()
})

it("prefers an explicit label over the text for the accessible name", () => {
  renderTip({ text: "A long explanation.", label: "What is MCP?", className: "ml-1" })
  const trigger = screen.getByRole("button", { name: "What is MCP?" })
  expect(trigger).toHaveClass("ml-1")
})
