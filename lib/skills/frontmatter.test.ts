import { skillDescription, skillName, splitFrontmatter } from "./frontmatter"

describe("splitFrontmatter", () => {
  it("parses simple name/description frontmatter", () => {
    const doc = splitFrontmatter("---\nname: rust\ndescription: Rust engineering\n---\n# Body\n")
    expect(doc.attrs).toEqual({ name: "rust", description: "Rust engineering" })
    expect(doc.body).toBe("# Body\n")
  })

  it("returns whole input as body when there is no frontmatter", () => {
    const doc = splitFrontmatter("# Just markdown\n\n---\n\nmore")
    expect(doc.attrs).toEqual({})
    expect(doc.body).toBe("# Just markdown\n\n---\n\nmore")
  })

  it("treats an unterminated fence as no frontmatter", () => {
    const src = "---\nname: broken\nno closing fence"
    expect(splitFrontmatter(src)).toEqual({ attrs: {}, body: src })
  })

  it("handles name-only frontmatter (the Claude Code name-only case)", () => {
    const doc = splitFrontmatter("---\nname: caveman\n---\nbody")
    expect(doc.attrs).toEqual({ name: "caveman" })
    expect(skillDescription(doc)).toBeUndefined()
  })

  it("folds > block scalars and indented continuations into one value", () => {
    const src = [
      "---",
      "name: find-docs",
      "description: >-",
      "  Retrieves up-to-date documentation",
      "  for any developer technology.",
      "---",
      "body",
    ].join("\n")
    const doc = splitFrontmatter(src)
    expect(doc.attrs["description"]).toBe(
      "Retrieves up-to-date documentation for any developer technology."
    )
  })

  it("supports | block scalars and CRLF line endings", () => {
    const src = "---\r\nname: x\r\ndescription: |\r\n  line one\r\n  line two\r\n---\r\nbody\r\n"
    const doc = splitFrontmatter(src)
    expect(doc.attrs["description"]).toBe("line one line two")
    // The line-based split normalizes CRLF bodies to LF — fine for rendering.
    expect(doc.body).toBe("body\n")
  })

  it("strips paired quotes from values", () => {
    const doc = splitFrontmatter("---\nname: \"quoted\"\ndescription: 'single'\n---\n")
    expect(doc.attrs).toEqual({ name: "quoted", description: "single" })
  })

  it("ends a value at a nested/list line instead of swallowing it", () => {
    const src = [
      "---",
      "name: meta",
      "metadata:",
      "- not a scalar",
      "description: after",
      "---",
      "",
    ].join("\n")
    const doc = splitFrontmatter(src)
    expect(doc.attrs["name"]).toBe("meta")
    expect(doc.attrs["description"]).toBe("after")
  })

  it("ignores comment and blank lines inside frontmatter", () => {
    const doc = splitFrontmatter("---\n# comment\n\nname: x\n---\nbody")
    expect(doc.attrs).toEqual({ name: "x" })
  })

  it("does not treat a --- inside the body as a fence", () => {
    const doc = splitFrontmatter("---\nname: x\n---\nintro\n---\noutro")
    expect(doc.body).toBe("intro\n---\noutro")
  })
})

describe("skillName", () => {
  it("prefers frontmatter name and falls back to dir name", () => {
    expect(skillName({ attrs: { name: "real-name" }, body: "" }, "dir")).toBe("real-name")
    expect(skillName({ attrs: {}, body: "" }, "dir")).toBe("dir")
    expect(skillName({ attrs: { name: "  " }, body: "" }, "dir")).toBe("dir")
  })
})
