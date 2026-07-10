/**
 * Tolerant SKILL.md frontmatter splitter. Real-world skills drift from the spec
 * (name-only frontmatter, missing frontmatter, folded multi-line descriptions),
 * so this parses a forgiving YAML subset instead of demanding validity: top-level
 * `key: value` scalars, quoted values, and `>`/`|` block scalars plus indented
 * continuation lines folded into one space-joined string. Anything unparseable
 * degrades to "no frontmatter" — the body is still rendered.
 */

export interface SkillDoc {
  attrs: Record<string, string>
  body: string
}

const FENCE = /^---\s*$/

/**
 * Split a SKILL.md into frontmatter attrs + markdown body. Only a `---` fence on
 * the very first line opens frontmatter (a `---` later in the body is a thematic
 * break, not a fence). No fence or an unterminated fence yields empty attrs and
 * the whole input as body.
 */
export function splitFrontmatter(src: string): SkillDoc {
  const lines = src.split(/\r?\n/)
  if (lines.length === 0 || !FENCE.test(lines[0])) {
    return { attrs: {}, body: src }
  }
  const end = lines.findIndex((line, i) => i > 0 && FENCE.test(line))
  if (end === -1) {
    return { attrs: {}, body: src }
  }
  return {
    attrs: parseAttrs(lines.slice(1, end)),
    body: lines.slice(end + 1).join("\n"),
  }
}

function parseAttrs(lines: string[]): Record<string, string> {
  const attrs: Record<string, string> = {}
  let key: string | null = null
  let parts: string[] = []
  const flush = () => {
    if (key) attrs[key] = parts.join(" ").trim()
    key = null
    parts = []
  }
  for (const line of lines) {
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line)
    if (m) {
      flush()
      key = m[1]
      const value = m[2].trim()
      // `>` / `|` (with optional chomping) start a block scalar; its text lives
      // on the indented lines that follow.
      if (!/^[>|][+-]?$/.test(value)) parts.push(unquote(value))
    } else if (key && /^\s+\S/.test(line)) {
      // Indented continuation of the current value (block scalar or wrapped line).
      parts.push(line.trim())
    } else if (!/^\s*(#.*)?$/.test(line)) {
      // A non-indented, non-key line (nested map, list item): the value ended.
      flush()
    }
  }
  flush()
  return attrs
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1)
    }
  }
  return value
}

/** Display/config name for a skill: frontmatter `name`, else the dir name. */
export function skillName(doc: SkillDoc, dirName: string): string {
  return doc.attrs["name"]?.trim() || dirName
}

export function skillDescription(doc: SkillDoc): string | undefined {
  const d = doc.attrs["description"]?.trim()
  return d ? d : undefined
}
