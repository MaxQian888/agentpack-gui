import { render, screen } from "@testing-library/react"
import { CodeHighlight } from "./code-highlight"

describe("CodeHighlight", () => {
  it("wraps colored tokens in spans while preserving the full text", () => {
    const { container } = render(<CodeHighlight code={'const x = "hi"'} lang="ts" />)
    expect(container).toHaveTextContent('const x = "hi"')
    expect(screen.getByText("const")).toHaveClass("text-violet-600")
    expect(screen.getByText('"hi"')).toHaveClass("text-emerald-600")
  })

  it("renders plain text without any span for a plain language", () => {
    const { container } = render(<CodeHighlight code="just text" lang="text" />)
    expect(container).toHaveTextContent("just text")
    expect(container.querySelector("span")).toBeNull()
  })

  it("highlights diff insert/delete lines", () => {
    render(<CodeHighlight code={"-old\n+new"} lang="diff" />)
    expect(screen.getByText("-old")).toHaveClass("text-rose-600")
    expect(screen.getByText("+new")).toHaveClass("text-emerald-600")
  })
})
