/**
 * A tiny, dependency-free syntax highlighter for read-only code blocks (chat
 * transcripts, SKILL.md docs, raw MCP config, patches). Like the TOML editor's
 * mirror, it is a single linear character scanner driven by a small per-language
 * table — a "good enough to read" tokenizer, never a real parser. Every regex is
 * anchored/bounded so it stays linear (ReDoS-safe).
 *
 * Output is a flat token list a React component maps to `<span>`s — no HTML
 * string, so nothing is injected via `dangerouslySetInnerHTML`. Keeping it pure
 * makes it testable.
 */

export type TokenKind =
  | "plain"
  | "comment"
  | "keyword"
  | "string"
  | "number"
  | "literal" // true / false / null / None / undefined
  | "property" // object / config key
  | "function" // identifier immediately followed by `(`
  | "builtin" // known type or builtin identifier
  | "variable" // `$VAR` in shell
  | "inserted" // diff `+` line
  | "deleted" // diff `-` line
  | "meta" // diff hunk / file header

export interface HlToken {
  kind: TokenKind
  value: string
}

/** Non-plain token kind → theme-aware Tailwind classes (aligned with TOML editor). */
export const HL_TOKEN_CLASS: Record<Exclude<TokenKind, "plain">, string> = {
  comment: "text-muted-foreground italic",
  keyword: "text-violet-600 dark:text-violet-400",
  property: "text-sky-700 dark:text-sky-400",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  literal: "text-rose-600 dark:text-rose-400",
  function: "text-blue-600 dark:text-blue-400",
  builtin: "text-fuchsia-600 dark:text-fuchsia-400",
  variable: "text-orange-600 dark:text-orange-400",
  inserted: "text-emerald-600 dark:text-emerald-400",
  deleted: "text-rose-600 dark:text-rose-400",
  meta: "text-sky-600 dark:text-sky-400",
}

interface LangSpec {
  /** Line-comment starters (first match wins). */
  line: string[]
  /** Block-comment delimiters, if any. */
  block?: [string, string]
  /** String quote characters. */
  quotes: string[]
  /** Python-style triple-quoted, multi-line strings. */
  triple?: boolean
  keywords: Set<string>
  literals: Set<string>
  builtins: Set<string>
  /** Color an identifier/string as a key when followed by `:` (JSON/YAML/JS). */
  colonKeys?: boolean
  /** Color a line-leading identifier as a key when followed by `=` (TOML). */
  eqKeys?: boolean
  /** `$VAR` / `${...}` shell variables. */
  dollarVars?: boolean
  /** `[table]` / `[[array]]` headers at line start (TOML). */
  bracketTables?: boolean
  /** Color an identifier as a function when immediately followed by `(`. */
  funcCall?: boolean
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

/** JS + TS share one spec — TS keywords are a harmless superset for JS. */
const JS: LangSpec = {
  line: ["//"],
  block: ["/*", "*/"],
  quotes: ['"', "'", "`"],
  keywords: words(`const let var function return if else for while do switch case default break
    continue new delete typeof instanceof void this super class extends implements interface type
    enum import export from as async await yield try catch finally throw in of public private
    protected readonly static get set namespace declare abstract satisfies keyof infer is module`),
  literals: words("true false null undefined NaN Infinity"),
  builtins: words(`string number boolean object symbol bigint any unknown never Promise Array Record
    Map Set Partial Readonly console Math JSON Object Date RegExp Error`),
  colonKeys: true,
  funcCall: true,
}

const JSON_SPEC: LangSpec = {
  // Comments are jsonc/json5-friendly and harmless for strict JSON.
  line: ["//"],
  block: ["/*", "*/"],
  quotes: ['"'],
  keywords: new Set(),
  literals: words("true false null"),
  builtins: new Set(),
  colonKeys: true,
}

const BASH: LangSpec = {
  line: ["#"],
  quotes: ['"', "'"],
  keywords: words(`if then else elif fi for while until do done case esac in function select return
    export local readonly typeset declare set unset shift eval exec trap source continue break`),
  literals: words("true false"),
  builtins: new Set(),
  dollarVars: true,
}

const PYTHON: LangSpec = {
  line: ["#"],
  quotes: ['"', "'"],
  triple: true,
  keywords: words(`def class return if elif else for while break continue pass import from as with
    try except finally raise lambda yield global nonlocal assert del in is not and or async await`),
  literals: words("True False None"),
  builtins: words(`print len range int str float list dict set tuple bool type object open enumerate
    zip map filter sum min max sorted abs any all`),
  colonKeys: true,
  funcCall: true,
}

const YAML: LangSpec = {
  line: ["#"],
  quotes: ['"', "'"],
  keywords: new Set(),
  literals: words("true false null yes no on off True False Null ~"),
  builtins: new Set(),
  colonKeys: true,
}

const TOML: LangSpec = {
  line: ["#"],
  quotes: ['"', "'"],
  keywords: new Set(),
  literals: words("true false"),
  builtins: new Set(),
  eqKeys: true,
  bracketTables: true,
}

/** Fallback for a specified-but-unknown language: strings/numbers/comments only. */
const GENERIC: LangSpec = {
  line: ["//", "#"],
  block: ["/*", "*/"],
  quotes: ['"', "'", "`"],
  keywords: new Set(),
  literals: new Set(),
  builtins: new Set(),
}

const LANGS: Record<string, LangSpec> = {
  js: JS,
  json: JSON_SPEC,
  bash: BASH,
  python: PYTHON,
  yaml: YAML,
  toml: TOML,
  generic: GENERIC,
}

const ALIAS: Record<string, string> = {
  js: "js",
  jsx: "js",
  javascript: "js",
  mjs: "js",
  cjs: "js",
  node: "js",
  ts: "js",
  tsx: "js",
  typescript: "js",
  mts: "js",
  cts: "js",
  json: "json",
  jsonc: "json",
  json5: "json",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  python: "python",
  python3: "python",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  diff: "diff",
  patch: "diff",
}

/** Languages that should render as plain text (no highlighting). */
const PLAIN = new Set([
  "",
  "text",
  "txt",
  "plain",
  "plaintext",
  "log",
  "logs",
  "output",
  "raw",
  "none",
])

/** Canonical spec key, `"diff"`, or `null` for plain text. */
function normalizeLang(lang?: string): string | null {
  const key = (lang ?? "").trim().toLowerCase()
  if (PLAIN.has(key)) return null
  return ALIAS[key] ?? "generic"
}

const isDigit = (c: string) => c >= "0" && c <= "9"
const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c)
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c)

/** Consume a string starting at `i`; returns the index just past its close. */
function scanString(src: string, i: number, quote: string, triple: boolean): number {
  const n = src.length
  if (triple && src.startsWith(quote.repeat(3), i)) {
    const close = quote.repeat(3)
    let j = i + 3
    while (j < n && !src.startsWith(close, j)) {
      if (src[j] === "\\") j += 2
      else j++
    }
    return Math.min(n, j + 3)
  }
  const multiline = quote === "`"
  let j = i + 1
  while (j < n) {
    const c = src[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === quote) return j + 1
    if (c === "\n" && !multiline) return j // unterminated: stop at end of line
    j++
  }
  return n
}

/** Consume a numeric literal starting at `i` (digit- or `.digit`-led). */
function scanNumber(src: string, i: number): number {
  const n = src.length
  let j = i
  const radix = src[j] === "0" && "xXoObB".includes(src[j + 1] ?? "")
  if (radix) {
    j += 2
    while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++
    return j
  }
  while (j < n && (isDigit(src[j]) || src[j] === "_")) j++
  if (src[j] === "." && isDigit(src[j + 1] ?? "")) {
    j++
    while (j < n && (isDigit(src[j]) || src[j] === "_")) j++
  }
  if (src[j] === "e" || src[j] === "E") {
    let k = j + 1
    if (src[k] === "+" || src[k] === "-") k++
    if (isDigit(src[k] ?? "")) {
      j = k + 1
      while (j < n && isDigit(src[j])) j++
    }
  }
  return j
}

/** Tokenize `src` under `spec` into a flat, gap-free token list. */
function tokenize(src: string, spec: LangSpec): HlToken[] {
  const out: HlToken[] = []
  const n = src.length
  let plain = ""
  const flush = () => {
    if (plain) {
      out.push({ kind: "plain", value: plain })
      plain = ""
    }
  }
  const push = (kind: TokenKind, value: string) => {
    flush()
    out.push({ kind, value })
  }
  /** First non-space/tab char at/after `idx` on the same line (`""` past EOL). */
  const peek = (idx: number): string => {
    let j = idx
    while (j < n && (src[j] === " " || src[j] === "\t")) j++
    return j < n && src[j] !== "\n" ? src[j] : ""
  }

  let i = 0
  let lineStart = true // no visible content emitted yet on the current line

  while (i < n) {
    const ch = src[i]

    // Whitespace — buffer as plain; a newline restarts line-start tracking.
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      plain += ch
      if (ch === "\n") lineStart = true
      i++
      continue
    }

    // Block comment.
    if (spec.block && src.startsWith(spec.block[0], i)) {
      const at = src.indexOf(spec.block[1], i + spec.block[0].length)
      const stop = at === -1 ? n : at + spec.block[1].length
      push("comment", src.slice(i, stop))
      i = stop
      lineStart = false
      continue
    }

    // Line comment.
    const lc = spec.line.find((p) => src.startsWith(p, i))
    if (lc) {
      let end = src.indexOf("\n", i)
      if (end === -1) end = n
      push("comment", src.slice(i, end))
      i = end
      lineStart = false
      continue
    }

    // Shell variable: `$VAR`, `${...}`, `$1`, `$?`.
    if (spec.dollarVars && ch === "$") {
      let j = i + 1
      if (src[j] === "{") {
        const at = src.indexOf("}", j)
        j = at === -1 ? n : at + 1
      } else if (/[A-Za-z_]/.test(src[j] ?? "")) {
        j++
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++
      } else if (/[0-9@*#?$!-]/.test(src[j] ?? "")) {
        j++
      }
      push("variable", src.slice(i, j))
      i = j
      lineStart = false
      continue
    }

    // TOML section header at line start: `[table]` / `[[array]]`.
    if (spec.bracketTables && lineStart && ch === "[") {
      let end = src.indexOf("]", i)
      if (end !== -1 && src[end + 1] === "]") end++
      const stop = end === -1 ? n : end + 1
      push("keyword", src.slice(i, stop))
      i = stop
      lineStart = false
      continue
    }

    // String (optionally a quoted key when followed by `:`).
    if (spec.quotes.includes(ch)) {
      const end = scanString(src, i, ch, spec.triple ?? false)
      const isKey = spec.colonKeys && peek(end) === ":"
      push(isKey ? "property" : "string", src.slice(i, end))
      i = end
      lineStart = false
      continue
    }

    // Number.
    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1] ?? ""))) {
      const end = scanNumber(src, i)
      push("number", src.slice(i, end))
      i = end
      lineStart = false
      continue
    }

    // Identifier / bareword.
    if (isIdentStart(ch)) {
      let j = i + 1
      while (j < n && isIdentPart(src[j])) j++
      const word = src.slice(i, j)
      const next = peek(j)
      let kind: TokenKind = "plain"
      if (spec.keywords.has(word)) kind = "keyword"
      else if (spec.literals.has(word)) kind = "literal"
      else if (spec.builtins.has(word)) kind = "builtin"
      else if (lineStart && ((spec.colonKeys && next === ":") || (spec.eqKeys && next === "=")))
        kind = "property"
      else if (spec.funcCall && next === "(") kind = "function"
      if (kind === "plain") plain += word
      else push(kind, word)
      i = j
      lineStart = false
      continue
    }

    // Punctuation / operator / anything else.
    plain += ch
    i++
    lineStart = false
  }
  flush()
  return out
}

/** Classify a unified/apply-patch diff line by its leading marker. */
function diffLineKind(line: string): TokenKind {
  if (/^(@@|\*\*\* |--- |\+\+\+ |diff |index )/.test(line)) return "meta"
  if (line.startsWith("+")) return "inserted"
  if (line.startsWith("-")) return "deleted"
  return "plain"
}

/** Line-oriented diff highlighting (newlines preserved as plain tokens). */
function highlightDiff(code: string): HlToken[] {
  if (!code) return []
  const out: HlToken[] = []
  const lines = code.split("\n")
  lines.forEach((line, idx) => {
    if (line) out.push({ kind: diffLineKind(line), value: line })
    if (idx < lines.length - 1) out.push({ kind: "plain", value: "\n" })
  })
  return out
}

/**
 * Highlight `code` for `lang`. Unknown languages get best-effort generic
 * highlighting; plain/text/log (and no language) render untouched.
 */
export function highlight(code: string, lang?: string): HlToken[] {
  const key = normalizeLang(lang)
  if (key === null) return code ? [{ kind: "plain", value: code }] : []
  if (key === "diff") return highlightDiff(code)
  return tokenize(code, LANGS[key])
}
