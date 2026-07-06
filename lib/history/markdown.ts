/**
 * A deliberately small Markdown tokenizer for rendering chat transcripts. It
 * produces a block/inline AST that a React component maps to elements — no HTML
 * string, so nothing is injected via `dangerouslySetInnerHTML`.
 *
 * Scope is chat-readability, not spec compliance: fenced code, ATX headings,
 * lists, blockquotes and paragraphs at the block level; inline code, links and
 * `**bold**` / `*italic*` (asterisks only — underscores are left alone so file
 * names and identifiers don't become italic). Keeping it pure makes it testable.
 */

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "link"; value: string; href: string }

export type MdBlock =
  | { type: "code"; lang: string; value: string }
  | { type: "heading"; level: number; inline: InlineToken[] }
  | { type: "list"; ordered: boolean; items: InlineToken[][] }
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
const ULIST = /^\s*[-*+]\s+(.*)$/
const OLIST = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

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

    if (ULIST.test(line) || OLIST.test(line)) {
      const ordered = OLIST.test(line) && !ULIST.test(line)
      const items: InlineToken[][] = []
      while (i < lines.length && (ULIST.test(lines[i]) || OLIST.test(lines[i]))) {
        const m = ULIST.exec(lines[i]) ?? OLIST.exec(lines[i])
        items.push(parseInline(m![1]))
        i++
      }
      blocks.push({ type: "list", ordered, items })
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
      !/^```/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push({ type: "paragraph", inline: parseInline(para.join("\n")) })
  }

  return blocks
}
