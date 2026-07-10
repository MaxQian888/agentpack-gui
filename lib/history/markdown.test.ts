import { parseInline, parseMarkdown, type MdBlock } from "./markdown"

describe("parseInline", () => {
  it("returns a single text token for plain text", () => {
    expect(parseInline("hello world")).toEqual([{ type: "text", value: "hello world" }])
  })

  it("tokenizes inline code", () => {
    expect(parseInline("run `pnpm dev` now")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "pnpm dev" },
      { type: "text", value: " now" },
    ])
  })

  it("tokenizes links with href", () => {
    expect(parseInline("see [docs](https://x.dev/a)")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "docs", href: "https://x.dev/a" },
    ])
  })

  it("prefers bold over italic on overlap", () => {
    expect(parseInline("**strong** and *soft*")).toEqual([
      { type: "bold", value: "strong" },
      { type: "text", value: " and " },
      { type: "italic", value: "soft" },
    ])
  })

  it("leaves underscores in identifiers alone", () => {
    expect(parseInline("foo_bar_baz")).toEqual([{ type: "text", value: "foo_bar_baz" }])
  })

  it("picks the earliest match when multiple are present", () => {
    const toks = parseInline("a `c` [l](u)")
    expect(toks[0]).toEqual({ type: "text", value: "a " })
    expect(toks[1]).toEqual({ type: "code", value: "c" })
    expect(toks[3]).toEqual({ type: "link", value: "l", href: "u" })
  })
})

describe("parseMarkdown", () => {
  it("parses a fenced code block with language", () => {
    const blocks = parseMarkdown("```ts\nconst x = 1\n```")
    expect(blocks).toEqual<MdBlock[]>([{ type: "code", lang: "ts", value: "const x = 1" }])
  })

  it("closes an unterminated fence at end of input", () => {
    const blocks = parseMarkdown("```\nno close")
    expect(blocks[0]).toEqual({ type: "code", lang: "", value: "no close" })
  })

  it("parses ATX headings by level", () => {
    const blocks = parseMarkdown("# Title\n### Sub")
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 })
    expect(blocks[1]).toMatchObject({ type: "heading", level: 3 })
  })

  it("groups consecutive bullets into one unordered list", () => {
    const blocks = parseMarkdown("- a\n- b\n- c")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false })
    if (blocks[0].type === "list") expect(blocks[0].items).toHaveLength(3)
  })

  it("detects ordered lists", () => {
    const blocks = parseMarkdown("1. first\n2. second")
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true })
  })

  it("collects blockquote lines", () => {
    const blocks = parseMarkdown("> quoted\n> line two")
    expect(blocks[0].type).toBe("quote")
  })

  it("separates paragraphs on blank lines", () => {
    const blocks = parseMarkdown("para one\n\npara two")
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe("paragraph")
    expect(blocks[1].type).toBe("paragraph")
  })

  it("mixes blocks in order", () => {
    const blocks = parseMarkdown("# H\ntext\n\n```\ncode\n```\n- item")
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "code", "list"])
  })
})

describe("parseMarkdown — GFM tables", () => {
  it("parses header, alignment and rows", () => {
    const blocks = parseMarkdown(
      ["| Name | Count | Note |", "| :--- | :---: | ---: |", "| a | 1 | x |", "| b | 2 | y |"].join(
        "\n"
      )
    )
    expect(blocks).toHaveLength(1)
    const table = blocks[0]
    if (table.type !== "table") throw new Error("expected table")
    expect(table.header.map((h) => h[0])).toEqual([
      { type: "text", value: "Name" },
      { type: "text", value: "Count" },
      { type: "text", value: "Note" },
    ])
    expect(table.align).toEqual(["left", "center", "right"])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[1][1][0]).toEqual({ type: "text", value: "2" })
  })

  it("parses inline styles inside cells and stops at a blank line", () => {
    const blocks = parseMarkdown("| a |\n| - |\n| **b** |\n\nafter")
    const table = blocks[0]
    if (table.type !== "table") throw new Error("expected table")
    expect(table.rows[0][0][0]).toEqual({ type: "bold", value: "b" })
    expect(blocks[1]).toMatchObject({ type: "paragraph" })
  })

  it("does not treat a pipe line without a separator as a table", () => {
    const blocks = parseMarkdown("a | b\nplain text")
    expect(blocks[0].type).toBe("paragraph")
  })

  it("breaks a paragraph when a table starts on the next line", () => {
    const blocks = parseMarkdown("intro\n| h |\n| - |\n| v |")
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "table"])
  })
})

describe("parseMarkdown — nested and task lists", () => {
  it("nests indented items under their parent", () => {
    const blocks = parseMarkdown("- parent\n  - child one\n  - child two\n- sibling")
    const list = blocks[0]
    if (list.type !== "list") throw new Error("expected list")
    expect(list.items).toHaveLength(2)
    expect(list.items[0].children).toHaveLength(2)
    expect(list.items[0].children![1].inline[0]).toEqual({ type: "text", value: "child two" })
    expect(list.items[1].inline[0]).toEqual({ type: "text", value: "sibling" })
  })

  it("records whether a nested list is ordered", () => {
    const blocks = parseMarkdown("- parent\n  1. first\n  2. second")
    const list = blocks[0]
    if (list.type !== "list") throw new Error("expected list")
    expect(list.items[0].childrenOrdered).toBe(true)
    expect(list.ordered).toBe(false)
  })

  it("dedents back to the parent level", () => {
    const blocks = parseMarkdown("- a\n  - a1\n- b")
    const list = blocks[0]
    if (list.type !== "list") throw new Error("expected list")
    expect(list.items.map((i) => i.inline[0])).toEqual([
      { type: "text", value: "a" },
      { type: "text", value: "b" },
    ])
  })

  it("parses task list checkboxes", () => {
    const blocks = parseMarkdown("- [ ] todo\n- [x] done\n- plain")
    const list = blocks[0]
    if (list.type !== "list") throw new Error("expected list")
    expect(list.items[0]).toMatchObject({ checked: false })
    expect(list.items[0].inline[0]).toEqual({ type: "text", value: "todo" })
    expect(list.items[1]).toMatchObject({ checked: true })
    expect(list.items[2].checked).toBeUndefined()
  })
})
