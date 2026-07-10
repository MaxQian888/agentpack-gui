/**
 * A deliberately small Markdown tokenizer for rendering chat transcripts and
 * SKILL.md documents. It produces a block/inline AST that a React component maps
 * to elements — no HTML string, so nothing is injected via
 * `dangerouslySetInnerHTML`.
 *
 * Scope is readability, not spec compliance: fenced code, ATX headings, nested
 * (+ task) lists, GFM tables, blockquotes and paragraphs at the block level;
 * inline code, links and `**bold**` / `*italic*` (asterisks only — underscores
 * are left alone so file names and identifiers don't become italic). Keeping it
 * pure makes it testable.
 */

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "link"; value: string; href: string }

export interface ListItem {
  inline: InlineToken[]
  /** Task-list state (`- [ ]` / `- [x]`); undefined for plain items. */
  checked?: boolean
  children?: ListItem[]
  /** Whether the nested `children` list is ordered (from its first marker). */
  childrenOrdered?: boolean
}

export type TableAlign = "left" | "center" | "right" | null

export type MdBlock =
  | { type: "code"; lang: string; value: string }
  | { type: "heading"; level: number; inline: InlineToken[] }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "table"; header: InlineToken[][]; align: TableAlign[]; rows: InlineToken[][][] }
  | { type: "quote"; inline: InlineToken[] }
  | { type: "paragraph"; inline: InlineToken[] }

/** Split a single line of text into styled inline tokens. */
export function parseInline(src: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let rest = src
  // Order matters only for ties; the earliest match in the string always wins.
  const patterns: { type: "code" | "link" | "bold" | "italic"; re: RegExp }[] = [
    { type: "code", re: /`([^`]+)`/ },
    { type: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
    { type: "bold", re: /\*\*([^*]+)\*\*/ },
    { type: "italic", re: /\*([^*\n]+)\*/ },
  ]
  while (rest.length) {
    let best: { idx: number; len: number; token: InlineToken } | null = null
    for (const p of patterns) {
      const m = p.re.exec(rest)
      if (m && (best === null || m.index < best.idx)) {
        const token: InlineToken =
          p.type === "link"
            ? { type: "link", value: m[1], href: m[2] }
            : { type: p.type, value: m[1] }
        best = { idx: m.index, len: m[0].length, token }
      }
    }
    if (!best) {
      tokens.push({ type: "text", value: rest })
      break
    }
    if (best.idx > 0) tokens.push({ type: "text", value: rest.slice(0, best.idx) })
    tokens.push(best.token)
    rest = rest.slice(best.idx + best.len)
  }
  return tokens
}

const HEADING = /^(#{1,6})\s+(.*)$/
const ULIST = /^(\s*)[-*+]\s+(.*)$/
const OLIST = /^(\s*)\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/
/** GFM table separator row: `|---|:--:|` etc. — dashes with optional colons. */
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** Whether a table starts at `lines[i]` (a `|` row followed by a separator row). */
function isTableStart(lines: string[], i: number): boolean {
  return (
    lines[i].includes("|") &&
    i + 1 < lines.length &&
    lines[i + 1].includes("-") &&
    TABLE_SEP.test(lines[i + 1])
  )
}

/** Split a `| a | b |` row into trimmed cell strings. */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|")) s = s.slice(0, -1)
  return s.split("|").map((c) => c.trim())
}

function parseAlign(cell: string): TableAlign {
  const left = cell.startsWith(":")
  const right = cell.endsWith(":")
  if (left && right) return "center"
  if (right) return "right"
  if (left) return "left"
  return null
}

interface ListLine {
  indent: number
  ordered: boolean
  text: string
}

/** Build the (possibly nested) item tree from consecutive list lines. */
function buildListItems(entries: ListLine[]): ListItem[] {
  const root: ListItem[] = []
  const stack: { indent: number; items: ListItem[] }[] = [
    { indent: entries[0]?.indent ?? 0, items: root },
  ]
  for (const entry of entries) {
    while (stack.length > 1 && entry.indent < stack[stack.length - 1].indent) {
      stack.pop()
    }
    let top = stack[stack.length - 1]
    const parent = top.items[top.items.length - 1]
    if (entry.indent > top.indent && parent) {
      const children: ListItem[] = (parent.children ??= [])
      parent.childrenOrdered ??= entry.ordered
      stack.push({ indent: entry.indent, items: children })
      top = stack[stack.length - 1]
    }
    const task = TASK.exec(entry.text)
    top.items.push(
      task
        ? { inline: parseInline(task[2]), checked: task[1] !== " " }
        : { inline: parseInline(entry.text) }
    )
  }
  return root
}

/** Parse Markdown source into a block AST. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n")
  const blocks: MdBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block.
    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      const lang = fence[1].trim()
      const body: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // consume the closing fence (if present)
      blocks.push({ type: "code", lang, value: body.join("\n") })
      continue
    }

    if (line.trim() === "") {
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, inline: parseInline(heading[2]) })
      i++
      continue
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]).map(parseInline)
      const align = splitRow(lines[i + 1]).map(parseAlign)
      i += 2
      const rows: InlineToken[][][] = []
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]).map(parseInline))
        i++
      }
      blocks.push({ type: "table", header, align, rows })
      continue
    }

    if (ULIST.test(line) || OLIST.test(line)) {
      const ordered = OLIST.test(line) && !ULIST.test(line)
      const entries: ListLine[] = []
      while (i < lines.length && (ULIST.test(lines[i]) || OLIST.test(lines[i]))) {
        const u = ULIST.exec(lines[i])
        const m = u ?? OLIST.exec(lines[i])!
        entries.push({ indent: m[1].length, ordered: !u, text: m[2] })
        i++
      }
      blocks.push({ type: "list", ordered, items: buildListItems(entries) })
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1])
        i++
      }
      blocks.push({ type: "quote", inline: parseInline(body.join("\n")) })
      continue
    }

    // Paragraph: consecutive plain lines up to a blank line or a block starter.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING.test(lines[i]) &&
      !ULIST.test(lines[i]) &&
      !OLIST.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !isTableStart(lines, i)
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push({ type: "paragraph", inline: parseInline(para.join("\n")) })
  }

  return blocks
}
