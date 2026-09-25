"use client"

import { memo, useState } from "react"
import {
  Bot,
  Brain,
  ChevronRight,
  FileDiff,
  Globe,
  ImageIcon,
  Terminal,
  Users,
  Wrench,
  Zap,
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/provider"
import type { HistorySource, Message, Part, SessionDetail } from "@/lib/history/types"
import { formatTokens } from "@/lib/history/format"
import { modelColor } from "@/lib/history/display"
import { useIncremental } from "@/hooks/use-incremental"
import { historyGetPartText } from "@/lib/tauri/commands"
import { CodeHighlight } from "@/components/agentpack/code-highlight"
import { MarkdownView } from "./markdown-view"

/**
 * A collapsible section that mounts its body only once opened.
 *
 * This is deliberately *not* a native `<details>`: React renders children
 * regardless of the `open` attribute, so a collapsed tool result still put its
 * whole payload in the DOM (and ran the highlighter over it). Tool payloads are
 * ~88% of a large transcript's bytes, so gating the mount is what keeps big
 * sessions responsive.
 */
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
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className={cn("rounded-md border bg-card", tone)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "ml-auto size-3 shrink-0 transition-transform duration-(--hm-dur-fast) ease-(--hm-ease-out)",
            open && "rotate-90"
          )}
        />
      </button>
      {open ? <div className="border-t px-3 py-2">{children}</div> : null}
    </div>
  )
}

/** Human-readable size for a truncated payload's "load full output" affordance. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Body of a possibly-truncated payload: shows the prefix the scan shipped, plus
 * a button that fetches the rest on demand. Covers both payloads capped for
 * transport and output the CLI externalized to its own file.
 */
function PartBody({
  part,
  source,
  path,
  lang,
  markdown,
}: {
  part: Part
  source: HistorySource
  path: string
  lang?: string
  /** Render prose (an agent's report) instead of a monospace payload. */
  markdown?: boolean
}) {
  const t = useT().history
  const [full, setFull] = useState<string | null>(null)
  const [state, setState] = useState<"idle" | "loading" | "error">("idle")
  const text = full ?? part.text

  async function load() {
    if (!part.ref) return
    setState("loading")
    try {
      setFull(await historyGetPartText(source, path, part.ref))
      setState("idle")
    } catch {
      setState("error")
    }
  }

  return (
    <>
      {markdown ? <MarkdownView text={text} /> : <CodeBlock text={text} lang={lang} />}
      {part.truncated && full === null ? (
        <button
          type="button"
          onClick={() => void load()}
          disabled={state === "loading"}
          className="mt-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:no-underline"
        >
          {state === "loading"
            ? t.loadingFullText
            : t.loadFullText(formatBytes(part.fullBytes ?? part.text.length))}
        </button>
      ) : null}
      {state === "error" ? (
        <p className="mt-1.5 text-xs text-destructive">{t.fullTextFailed}</p>
      ) : null}
    </>
  )
}

/**
 * One-line note for a multi-agent event with nothing to expand: a sub-agent's
 * lifecycle, or a hand-off whose payload Codex only stored encrypted.
 */
function AgentLine({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-card px-3 py-1.5 text-xs text-muted-foreground">
      {icon}
      <span className="truncate">{label}</span>
    </div>
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

function PartView({ part, source, path }: { part: Part; source: HistorySource; path: string }) {
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
          {part.text.trim() || part.truncated ? (
            <PartBody part={part} source={source} path={path} />
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
          <PartBody part={part} source={source} path={path} />
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
          <PartBody part={part} source={source} path={path} lang="diff" />
        </Foldable>
      )
    // Codex writes an inter-agent message into the *recipient's* transcript, so
    // in the session that delegated the work these are the sub-agents' own
    // reports — prose, hence markdown rather than a monospace payload. A task
    // hand-off travels encrypted and arrives bodyless: an envelope with nothing
    // to expand, so it stays a line rather than a dead-end disclosure.
    case "agentMessage": {
      const label = t.agentMessage(part.name ?? "", part.agent ?? "")
      if (!part.text.trim() && !part.truncated) {
        return <AgentLine icon={<Users className="size-3.5" />} label={label} />
      }
      return (
        <Foldable
          label={label}
          icon={<Users className="size-3.5" />}
          tone="border-primary/40"
          defaultOpen
        >
          <PartBody part={part} source={source} path={path} markdown />
        </Foldable>
      )
    }
    // The spawned agent runs in its own transcript; this line is all the parent
    // session records of it.
    case "subagentActivity":
      return (
        <AgentLine
          icon={<Bot className="size-3.5" />}
          label={t.subagentActivity(part.name ?? "", part.agent ?? "")}
        />
      )
    case "image":
      return (
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" />
          {t.image}
        </div>
      )
    // Hook outcomes, plan-mode transitions, queued commands — the CLI-side
    // events that shaped the session but aren't messages.
    case "event":
      return (
        <Foldable
          label={t.event(part.name ?? "event")}
          icon={<Zap className="size-3.5" />}
          tone="border-dashed"
        >
          <PartBody part={part} source={source} path={path} />
        </Foldable>
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
  source,
  path,
}: {
  message: Message
  fallbackModel: string
  source: HistorySource
  path: string
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
          <PartView key={i} part={p} source={source} path={path} />
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
        <MessageView
          key={m.id}
          message={m}
          fallbackModel={detail.summary.model}
          source={detail.summary.source}
          path={detail.summary.path}
        />
      ))}
      {hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-2 text-xs text-muted-foreground">
          {t.loading}
        </div>
      ) : null}
    </div>
  )
}
