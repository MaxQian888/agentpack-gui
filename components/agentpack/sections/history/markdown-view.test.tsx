import { render, screen } from "@testing-library/react"
import { MarkdownView } from "./markdown-view"

describe("MarkdownView", () => {
  it("renders a heading, bold, italic, inline code and a link", () => {
    render(
      <MarkdownView text={"# Title\nsome **bold** and *soft* and `code` and [x](https://a.dev)"} />
    )
    expect(screen.getByText("Title")).toBeInTheDocument()
    expect(screen.getByText("bold").tagName).toBe("STRONG")
    expect(screen.getByText("soft").tagName).toBe("EM")
    expect(screen.getByText("code").tagName).toBe("CODE")
    const link = screen.getByText("x") as HTMLAnchorElement
    expect(link.tagName).toBe("A")
    expect(link.href).toBe("https://a.dev/")
  })

  it("renders a fenced code block", () => {
    render(<MarkdownView text={"```ts\nconst x = 1\n```"} />)
    expect(screen.getByText("const x = 1")).toBeInTheDocument()
  })

  it("renders ordered and unordered lists and a blockquote", () => {
    const { rerender } = render(<MarkdownView text={"- a\n- b"} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(2)

    rerender(<MarkdownView text={"1. one\n2. two\n3. three"} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(3)

    rerender(<MarkdownView text={"> quoted line"} />)
    expect(screen.getByText("quoted line").tagName).toBe("BLOCKQUOTE")
  })
})
