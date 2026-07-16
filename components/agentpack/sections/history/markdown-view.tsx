"use client"

import { Fragment, useMemo, createElement } from "react"
import {
  parseMarkdown,
  type InlineToken,
  type ListItem,
  type MdBlock,
} from "@/lib/history/markdown"
import { CodeHighlight } from "@/components/agentpack/code-highlight"
import { cn } from "@/lib/utils"

/**
 * `chat` keeps the compact transcript styling (headings as bold paragraphs);
 * `doc` renders document-style SKILL.md pages with real h1–h6 tags and a size
 * scale.
 */
type Variant = "chat" | "doc"

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

const DOC_HEADING_SIZE: Record<number, string> = {
  1: "text-xl",
  2: "text-lg",
  3: "text-base",
}

function Heading({
  level,
  inline,
  variant,
}: {
  level: number
  inline: InlineToken[]
  variant: Variant
}) {
  if (variant === "chat") {
    return (
      <p className={cn("font-semibold", level <= 2 ? "text-base" : "text-sm")}>
        <Inline tokens={inline} />
      </p>
    )
  }
  return createElement(
    `h${level}`,
    { className: cn("font-semibold tracking-tight", DOC_HEADING_SIZE[level] ?? "text-sm") },
    <Inline tokens={inline} />
  )
}

function Items({ items, ordered }: { items: ListItem[]; ordered: boolean }) {
  const children = items.map((it, i) => (
    <li key={i}>
      {it.checked !== undefined ? (
        <input
          type="checkbox"
          checked={it.checked}
          readOnly
          disabled
          className="mr-1.5 size-3 accent-primary align-baseline"
        />
      ) : null}
      <Inline tokens={it.inline} />
      {it.children?.length ? (
        <Items items={it.children} ordered={it.childrenOrdered ?? false} />
      ) : null}
    </li>
  ))
  return ordered ? (
    <ol className="ml-5 list-decimal space-y-1">{children}</ol>
  ) : (
    <ul className="ml-5 list-disc space-y-1">{children}</ul>
  )
}

function Block({ block, variant }: { block: MdBlock; variant: Variant }) {
  switch (block.type) {
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border bg-muted/60 p-3 text-xs">
          <code className="font-mono">
            <CodeHighlight code={block.value} lang={block.lang} />
          </code>
        </pre>
      )
    case "heading":
      return <Heading level={block.level} inline={block.inline} variant={variant} />
    case "list":
      return <Items items={block.items} ordered={block.ordered} />
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className="border bg-muted/40 px-2 py-1 text-left font-semibold"
                    style={block.align[i] ? { textAlign: block.align[i] } : undefined}
                  >
                    <Inline tokens={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="border px-2 py-1 align-top"
                      style={block.align[c] ? { textAlign: block.align[c] } : undefined}
                    >
                      <Inline tokens={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
export function MarkdownView({
  text,
  className,
  variant = "chat",
}: {
  text: string
  className?: string
  variant?: Variant
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return (
    <div className={cn("min-w-0 space-y-2 text-sm leading-relaxed", className)}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} variant={variant} />
      ))}
    </div>
  )
}
