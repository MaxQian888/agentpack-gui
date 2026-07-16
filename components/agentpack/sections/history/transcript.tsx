"use client"

import { memo } from "react"
import { Brain, ChevronRight, FileDiff, Globe, ImageIcon, Terminal, Wrench } from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { Message, Part, SessionDetail } from "@/lib/history/types"
import { formatTokens } from "@/lib/history/format"
import { modelColor } from "@/lib/history/display"
import { useIncremental } from "@/hooks/use-incremental"
import { CodeHighlight } from "@/components/agentpack/code-highlight"
import { MarkdownView } from "./markdown-view"

/** A collapsible section built on native <details> — no state, fully testable. */
function Foldable({
  label,
  icon,
  tone,
  defaultOpen,
  children,
}: {
  label: React.ReactNode
  icon: React.ReactNode
  tone?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details open={defaultOpen} className={cn("group rounded-md border bg-card", tone)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight className="ml-auto size-3 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="border-t px-3 py-2">{children}</div>
    </details>
  )
}

/** Monospace block for tool inputs / outputs / patches, scrollable when long. */
function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
      {lang ? <CodeHighlight code={text} lang={lang} /> : text}
    </pre>
  )
}

function PartView({ part }: { part: Part }) {
  const t = useT().history
  switch (part.kind) {
    case "text":
      return <MarkdownView text={part.text} />
    case "thinking":
      return (
        <Foldable label={t.thinking} icon={<Brain className="size-3.5" />} tone="border-dashed">
          <div className="text-sm text-muted-foreground">
            <MarkdownView text={part.text} />
          </div>
        </Foldable>
      )
    case "toolCall":
      return (
        <Foldable
          label={t.toolCall(part.name ?? "tool")}
          icon={<Wrench className="size-3.5" />}
          defaultOpen={part.text.length < 200}
        >
          {part.text.trim() ? (
            <CodeBlock text={part.text} />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </Foldable>
      )
    case "toolResult":
      return (
        <Foldable
          label={part.isError ? t.toolError : t.toolResult}
          icon={<Terminal className="size-3.5" />}
          tone={part.isError ? "border-destructive/40" : undefined}
        >
          <CodeBlock text={part.text} />
        </Foldable>
      )
    case "webSearch":
      return (
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <Globe className="size-3.5" />
          <span className="truncate">
            {t.webSearch}
            {part.text ? ` · ${part.text}` : ""}
          </span>
        </div>
      )
    case "patch":
      return (
        <Foldable label={t.patch} icon={<FileDiff className="size-3.5" />}>
          <CodeBlock text={part.text} lang="diff" />
        </Foldable>
      )
    case "image":
      return (
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" />
          {t.image}
        </div>
      )
  }
}

function roleLabel(role: Message["role"], t: ReturnType<typeof useT>["history"]): string {
  if (role === "assistant") return t.roleAssistant
  if (role === "system") return t.roleSystem
  if (role === "tool") return t.roleTool
  return t.roleUser
}

// Memoized so growing the transcript window (or any parent re-render) doesn't
// re-run markdown parsing for messages already on screen — `message` refs are
// stable across renders.
const MessageView = memo(function MessageView({
  message,
  fallbackModel,
}: {
  message: Message
  fallbackModel: string
}) {
  const t = useT().history
  const isUser = message.role === "user"
  const model = message.model ?? fallbackModel
  const dot = isUser ? "var(--muted-foreground)" : modelColor(model)
  return (
    <div className={cn("rounded-lg border p-3", isUser ? "bg-muted/40" : "bg-transparent")}>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
        <span className="shrink-0 font-medium">{roleLabel(message.role, t)}</span>
        {!isUser && model ? (
          <span className="min-w-0 truncate text-muted-foreground">· {model}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
          {message.usage && message.usage.total > 0 ? (
            <span>{formatTokens(message.usage.total)}</span>
          ) : null}
          {message.ts ? <span>{format(new Date(message.ts), "HH:mm")}</span> : null}
        </span>
      </div>
      <div className="min-w-0 space-y-2">
        {message.parts.map((p, i) => (
          <PartView key={i} part={p} />
        ))}
      </div>
    </div>
  )
})

/** Render a session transcript as an ordered list of turns, windowed so long
 *  sessions mount incrementally as the reader scrolls instead of all at once. */
export function Transcript({ detail }: { detail: SessionDetail }) {
  const t = useT().history
  const { visible, sentinelRef, hasMore } = useIncremental(
    detail.messages.length,
    detail.summary.id,
    30
  )
  if (detail.messages.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">{t.transcriptEmpty}</p>
  }
  return (
    <div className="min-w-0 space-y-3 p-4">
      {detail.messages.slice(0, visible).map((m) => (
        <MessageView key={m.id} message={m} fallbackModel={detail.summary.model} />
      ))}
      {hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-2 text-xs text-muted-foreground">
          {t.loading}
        </div>
      ) : null}
    </div>
  )
}
