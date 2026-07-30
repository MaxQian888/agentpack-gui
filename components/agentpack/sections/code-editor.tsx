"use client"

import { useRef } from "react"
import { CodeHighlight } from "@/components/agentpack/code-highlight"
import { cn } from "@/lib/utils"

/**
 * A dependency-free config editor with syntax highlighting. A highlighted (but
 * inert) `<pre>` sits directly behind a transparent `<textarea>`, so the caret,
 * selection and editing come from the real textarea while the colors come from
 * the mirror. Both share identical font/padding/wrapping so glyphs line up, and
 * the textarea's scroll is mirrored onto the pre.
 *
 * Tokenizing is delegated to `lib/highlight`, the same scanner the run panel and
 * transcript renderer use — one grammar per language, tested once. That is why
 * this replaced a hand-rolled TOML tokenizer: adding JSON to a bespoke scanner
 * would have been a second copy of a solved problem.
 *
 * Known cosmetic gap vs. the tokenizer it replaced: TOML dotted (`log.level =`)
 * and quoted (`"a.b" =`) keys lose their key color, because the shared TOML spec
 * only paints a bare line-leading identifier. Colors, not correctness — the text
 * itself is untouched.
 */
interface Props {
  value: string
  onChange: (value: string) => void
  lang: "json" | "toml"
  /** Accessible name for the textarea (used by tests and screen readers). */
  ariaLabel?: string
  className?: string
}

export function CodeEditor({ value, onChange, lang, ariaLabel, className }: Props) {
  const preRef = useRef<HTMLPreElement>(null)

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
        <CodeHighlight code={value} lang={lang} />
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
