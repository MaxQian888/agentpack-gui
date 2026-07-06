"use client"

import { Fragment, useMemo } from "react"
import { parseMarkdown, type InlineToken, type MdBlock } from "@/lib/history/markdown"
import { cn } from "@/lib/utils"

/** Render styled inline tokens (code / bold / italic / link / text). */
function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((tok, i) => {
        switch (tok.type) {
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words"
              >
                {tok.value}
              </code>
            )
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                {tok.value}
              </strong>
            )
          case "italic":
            return (
              <em key={i} className="italic">
                {tok.value}
              </em>
            )
          case "link":
            return (
              <a
                key={i}
                href={tok.href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 break-words"
              >
                {tok.value}
              </a>
            )
          default:
            return <Fragment key={i}>{tok.value}</Fragment>
        }
      })}
    </>
  )
}

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border bg-muted/60 p-3 text-xs">
          <code className="font-mono">{block.value}</code>
        </pre>
      )
    case "heading":
      return (
        <p className={cn("font-semibold", block.level <= 2 ? "text-base" : "text-sm")}>
          <Inline tokens={block.inline} />
        </p>
      )
    case "list":
      return block.ordered ? (
        <ol className="ml-5 list-decimal space-y-1">
          {block.items.map((it, i) => (
            <li key={i}>
              <Inline tokens={it} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="ml-5 list-disc space-y-1">
          {block.items.map((it, i) => (
            <li key={i}>
              <Inline tokens={it} />
            </li>
          ))}
        </ul>
      )
    case "quote":
      return (
        <blockquote className="border-l-2 pl-3 text-muted-foreground">
          <Inline tokens={block.inline} />
        </blockquote>
      )
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap break-words">
          <Inline tokens={block.inline} />
        </p>
      )
  }
}

/** Render Markdown text as a safe React tree (no HTML injection). */
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div className={cn("min-w-0 space-y-2 text-sm leading-relaxed", className)}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  )
}
