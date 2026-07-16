/**
 * Pure SKILL.md scaffolding for the "create a skill" flow. Generates spec-shaped
 * frontmatter + a starter body from a template choice. Unit-tested; the Rust
 * side only writes the returned string.
 */

export type SkillTemplate = "blank" | "reference" | "task"

export interface ScaffoldInput {
  name: string
  description: string
  template: SkillTemplate
}

/** Build the SKILL.md text for a new skill. */
export function scaffoldSkillMd({ name, description, template }: ScaffoldInput): string {
  const desc = description.trim() || "Describe what this skill does and when to use it."
  const fm = ["---", `name: ${name}`, `description: ${desc}`]
  // Task skills are usually invoked explicitly, not auto-loaded.
  if (template === "task") fm.push("disable-model-invocation: true")
  fm.push("---", "")

  let body: string[]
  if (template === "reference") {
    body = [
      `# ${name}`,
      "",
      "Reference content Claude applies to the current work:",
      "",
      "- ...",
      "",
    ]
  } else if (template === "task") {
    body = [`Steps for ${name}:`, "", "1. ...", "2. ...", "3. ...", ""]
  } else {
    body = [`# ${name}`, "", desc, ""]
  }
  return fm.concat(body).join("\n")
}
