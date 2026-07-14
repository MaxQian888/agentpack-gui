"use client"

import { useMemo, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * A dependency-free TOML editor with syntax highlighting. A highlighted (but
 * inert) `<pre>` sits directly behind a transparent `<textarea>`, so the caret,
 * selection and editing come from the real textarea while the colors come from
 * the mirror. Both share identical font/padding/wrapping so glyphs line up, and
 * the textarea's scroll is mirrored onto the pre. The tokenizer is a tiny,
 * linear (ReDoS-safe) scanner — good enough to read a config, never a parser.
 */

/** Token kind → Tailwind color classes (theme-aware via `dark:`). */
const TOKEN_CLASS: Record<string, string> = {
  comment: "text-muted-foreground italic",
  table: "font-medium text-violet-600 dark:text-violet-400",
  key: "text-sky-700 dark:text-sky-400",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  boolean: "text-rose-600 dark:text-rose-400",
  date: "text-fuchsia-600 dark:text-fuchsia-400",
}

interface Tok {
  /** Key into TOKEN_CLASS, or "" for unstyled punctuation/whitespace. */
  cls: string
  text: string
}

/** Value literals, tried in order; each anchored at `^` and linear-time. */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/^(true|false)(?![A-Za-z0-9_])/, "boolean"],
  [/^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?/, "date"],
  [
    /^[+-]?(0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|(\d[\d_]*)(\.\d[\d_]*)?([eE][+-]?\d[\d_]*)?|inf|nan)(?![A-Za-z0-9_])/,
    "number",
  ],
]

/** Consume a quoted string starting at `i`; returns the index just past it. */
function scanString(src: string, i: number): number {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    if (quote === '"' && src[j] === "\\") {
      j += 2
      continue
    }
    if (src[j] === quote) return j + 1
    j++
  }
  return j
}

/** Split a physical line into its code part and a trailing `#` comment (if any). */
function splitComment(line: string): [string, string | null] {
  let inStr: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inStr) {
      if (ch === "\\" && inStr === '"') i++
      else if (ch === inStr) inStr = null
    } else if (ch === '"' || ch === "'") {
      inStr = ch
    } else if (ch === "#") {
      return [line.slice(0, i), line.slice(i)]
    }
  }
  return [line, null]
}

/** Index of the first top-level `=` (outside any string), or -1. */
function eqIndex(code: string): number {
  let inStr: string | null = null
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (inStr) {
      if (ch === "\\" && inStr === '"') i++
      else if (ch === inStr) inStr = null
    } else if (ch === '"' || ch === "'") {
      inStr = ch
    } else if (ch === "=") {
      return i
    }
  }
  return -1
}

/** Tokenize the value side of a `key = value` line. */
function tokenizeValue(v: string): Tok[] {
  const out: Tok[] = []
  let buf = ""
  const flush = () => {
    if (buf) out.push({ cls: "", text: buf })
    buf = ""
  }
  let i = 0
  while (i < v.length) {
    const ch = v[i]
    if (ch === '"' || ch === "'") {
      flush()
      const end = scanString(v, i)
      out.push({ cls: "string", text: v.slice(i, end) })
      i = end
      continue
    }
    // Only match literals at a token boundary so we don't paint inside a bareword.
    const boundary = i === 0 || !/[A-Za-z0-9_]/.test(v[i - 1])
    const rest = boundary ? v.slice(i) : ""
    let matched = false
    for (const [re, cls] of VALUE_PATTERNS) {
      const m = re.exec(rest)
      if (m) {
        flush()
        out.push({ cls, text: m[0] })
        i += m[0].length
        matched = true
        break
      }
    }
    if (matched) continue
    buf += ch
    i++
  }
  flush()
  return out
}

/** Tokenize a line's code part: table header, or `key = value`, or plain text. */
function tokenizeCode(code: string): Tok[] {
  if (code.trimStart().startsWith("[")) return [{ cls: "table", text: code }]
  const eq = eqIndex(code)
  if (eq === -1) return code ? [{ cls: "", text: code }] : []
  return [
    { cls: "key", text: code.slice(0, eq) },
    { cls: "", text: "=" },
    ...tokenizeValue(code.slice(eq + 1)),
  ]
}

/** Render TOML source into an array of colored spans (newlines preserved). */
function highlight(src: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const lines = src.split("\n")
  lines.forEach((line, li) => {
    const [code, comment] = splitComment(line)
    const toks = tokenizeCode(code)
    if (comment !== null) toks.push({ cls: "comment", text: comment })
    toks.forEach((tk, ti) => {
      nodes.push(
        <span key={`${li}-${ti}`} className={tk.cls ? TOKEN_CLASS[tk.cls] : undefined}>
          {tk.text}
        </span>
      )
    })
    if (li < lines.length - 1) nodes.push(`\n`)
  })
  return nodes
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Accessible name for the textarea (used by tests and screen readers). */
  ariaLabel?: string
  className?: string
}

export function TomlEditor({ value, onChange, ariaLabel, className }: Props) {
  const preRef = useRef<HTMLPreElement>(null)
  const nodes = useMemo(() => highlight(value), [value])

  // Both layers share this exact box (font, padding, wrapping) so the colored
  // mirror lines up glyph-for-glyph with the editable text.
  const box =
    "m-0 min-h-72 w-full whitespace-pre-wrap break-words rounded-md border px-3 py-2 font-mono text-xs leading-normal"

  return (
    <div className={cn("relative", className)}>
      <pre
        ref={preRef}
        aria-hidden
        className={cn(
          box,
          "pointer-events-none absolute inset-0 overflow-hidden border-transparent"
        )}
      >
        {nodes}
        {/* Trailing space keeps a final empty line's height so the caret aligns. */}
        {value.endsWith("\n") ? " " : null}
      </pre>
      <textarea
        aria-label={ariaLabel}
        className={cn(
          box,
          "relative resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        )}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          const pre = preRef.current
          if (!pre) return
          pre.scrollTop = e.currentTarget.scrollTop
          pre.scrollLeft = e.currentTarget.scrollLeft
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </div>
  )
}
