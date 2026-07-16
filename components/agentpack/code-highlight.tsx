"use client"

import { Fragment, useMemo } from "react"
import { highlight, HL_TOKEN_CLASS } from "@/lib/highlight/highlight"

/**
 * Render `code` as syntax-highlighted `<span>`s for a given `lang`. It emits only
 * the token spans (no `<pre>`/`<code>` wrapper) so each caller keeps its own
 * container styling. Highlighting is a pure, safe React tree — never HTML string
 * injection.
 */
export function CodeHighlight({ code, lang }: { code: string; lang?: string }) {
  const tokens = useMemo(() => highlight(code, lang), [code, lang])
  return (
    <>
      {tokens.map((tok, i) =>
        tok.kind === "plain" ? (
          <Fragment key={i}>{tok.value}</Fragment>
        ) : (
          <span key={i} className={HL_TOKEN_CLASS[tok.kind]}>
            {tok.value}
          </span>
        )
      )}
    </>
  )
}
