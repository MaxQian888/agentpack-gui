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

it("renders GFM tables with th/td cells", () => {
  const { container } = render(<MarkdownView text={"| Col |\n| :-: |\n| **val** |"} />)
  const th = container.querySelector("th")
  expect(th).toHaveTextContent("Col")
  expect(th).toHaveStyle({ textAlign: "center" })
  expect(container.querySelector("td strong")).toHaveTextContent("val")
})

it("renders nested lists and task checkboxes", () => {
  const { container } = render(<MarkdownView text={"- [x] done\n- parent\n  - child"} />)
  const checkbox = container.querySelector("input[type=checkbox]")
  expect(checkbox).toBeChecked()
  expect(checkbox).toBeDisabled()
  expect(container.querySelector("ul ul li")).toHaveTextContent("child")
})

it("doc variant renders real heading tags; chat variant keeps paragraphs", () => {
  const { container: doc } = render(<MarkdownView variant="doc" text={"# Title\n## Sub"} />)
  expect(doc.querySelector("h1")).toHaveTextContent("Title")
  expect(doc.querySelector("h2")).toHaveTextContent("Sub")
  const { container: chat } = render(<MarkdownView text={"# Title"} />)
  expect(chat.querySelector("h1")).toBeNull()
  expect(chat.querySelector("p")).toHaveTextContent("Title")
})
