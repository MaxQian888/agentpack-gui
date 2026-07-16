import { scaffoldSkillMd } from "./scaffold"

describe("scaffoldSkillMd", () => {
  it("blank template embeds name + description and a heading", () => {
    const md = scaffoldSkillMd({ name: "my-skill", description: "does x", template: "blank" })
    expect(md).toContain("name: my-skill")
    expect(md).toContain("description: does x")
    expect(md).toContain("# my-skill")
    expect(md).not.toContain("disable-model-invocation")
  })

  it("task template disables model invocation and writes numbered steps", () => {
    const md = scaffoldSkillMd({ name: "deploy", description: "", template: "task" })
    expect(md).toContain("disable-model-invocation: true")
    expect(md).toContain("Steps for deploy")
    // A blank description falls back to a helpful placeholder.
    expect(md).toContain("Describe what this skill does")
  })

  it("reference template writes a knowledge stub", () => {
    const md = scaffoldSkillMd({ name: "api", description: "d", template: "reference" })
    expect(md).toContain("Reference content")
    expect(md).toContain("# api")
  })

  it("produces valid frontmatter fences", () => {
    const md = scaffoldSkillMd({ name: "x", description: "y", template: "blank" })
    expect(md.startsWith("---\n")).toBe(true)
    expect(md.split("---").length).toBeGreaterThanOrEqual(3)
  })
})
