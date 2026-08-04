"use client"

import { useState } from "react"
import { CheckCircle2, ChevronRight, Circle, ExternalLink, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { pendingKeyEnvs, summarize } from "@/lib/agentpack/report"
import { findCli } from "@/lib/agentpack/registry"
import { launchApp } from "@/lib/tauri/commands"
import { copyText } from "@/lib/tauri/clipboard"
import type { StepReport } from "@/lib/agentpack/types"
import { useT } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { cn } from "@/lib/utils"

/**
 * What the user sees when a run finishes.
 *
 * The old ending was a block of monospace log with "run claude" as its last
 * line, which answers neither question a first-time user actually has: did it
 * work, and what now. So this leads with a plain-language verdict, gives
 * exactly one obvious next action, and lists the things that still need a human
 * — an API key, a sign-in — rather than letting them be discovered later as
 * something mysteriously not working.
 *
 * The log isn't gone, it's demoted: `summarize` still renders it verbatim
 * behind a disclosure, so the detail is one click away and the headline isn't
 * competing with it. Warnings are the exception — they are the one thing the
 * verdict can't express on its own, so they stay above the fold.
 */
export function Completion({
  reports,
  dryRun,
  cancelled = false,
}: {
  reports: StepReport[]
  dryRun: boolean
  /** The user stopped the run, as opposed to steps being skipped by a failure. */
  cancelled?: boolean
}) {
  const t = useT()
  const s = t.summary
  const c = t.completion
  const plan = useAppStore((s) => s.plan)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const ok = reports.filter((r) => r.status === "done").length
  const failed = reports.filter((r) => r.status === "error").length
  const warnings = reports.filter((r) => r.status === "warning")

  /**
   * Did the plan's `kind` entry for `id` actually come out working?
   *
   * A step that errored means no. **No step at all means yes** — the one-click
   * dedup drops everything already installed, so a missing step is the normal
   * shape of "it's already there", not evidence of failure.
   *
   * Reading the plan alone (as this used to) meant offering to open an app whose
   * install had just gone red, and asking for the API key of a server that never
   * landed. `buildSteps` ids a CLI as `cli-<id>[-<method>]` and a server as
   * `mcp-<target>-<id>`, which is what the two prefixes below match.
   */
  const installed = (kind: "cli" | "mcp", id: string) =>
    !reports.some(
      (r) =>
        r.status === "error" &&
        r.id.startsWith(`${kind}-`) &&
        (r.id === `${kind}-${id}` || r.id.endsWith(`-${id}`) || r.id.startsWith(`${kind}-${id}-`))
    )

  // Which app the one big button opens. Claude first when both were installed:
  // it's the one the wizard leads with and the one most setups centre on.
  const app = (["claude-desktop", "codex-app"] as const).find(
    (id) => plan.clis.includes(id) && installed("cli", id)
  )
  const appTool = app ? findCli(app) : undefined
  // Only offered when there's no app to open — otherwise it competes with the
  // primary action instead of supporting it.
  const cliCommand =
    !app && plan.clis.includes("claude-code") && installed("cli", "claude-code")
      ? "claude"
      : undefined

  const todos: string[] = []
  if (!dryRun) {
    // An MCP server without its key installs cleanly and then never works, so
    // this is the difference between a green run and a working one.
    for (const { id, env } of pendingKeyEnvs(plan)) {
      if (installed("mcp", id)) todos.push(c.todoKey(env))
    }
    if (plan.clis.includes("claude-desktop") && installed("cli", "claude-desktop")) {
      todos.push(c.todoSignIn)
      // Local sessions shell out to git; on Windows it isn't there by default.
      if (plan.os === "win") todos.push(c.todoWindowsGit)
    }
    if (
      plan.clis.includes("cc-switch") &&
      plan.clis.includes("claude-desktop") &&
      installed("cli", "cc-switch")
    ) {
      todos.push(c.todoCcSwitchGateway)
    }
  }

  const openApp = async () => {
    if (!appTool?.appBundles?.length) return
    setOpening(true)
    setOpenError(null)
    try {
      await launchApp(appTool.appBundles)
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }

  /**
   * The verdict reads all four statuses, not just `done` and `error`.
   *
   * Counting two of them meant a run the user cancelled — every remaining step
   * turns to `skipped`, so `failed === 0` — got a green tick and "All set", and
   * so did a run that was nothing but warnings ("All set · 0 things set up").
   * Warnings and skips were only ever aggregated by `summarize()`, which lives
   * behind a collapsed disclosure.
   */
  const verdict = dryRun
    ? "dryRun"
    : cancelled
      ? "cancelled"
      : failed > 0
        ? "partial"
        : warnings.length > 0
          ? "warned"
          : "done"
  const headline = { dryRun: s.dryRunComplete, cancelled: c.cancelled, partial: c.partial, warned: c.withWarnings, done: c.done }[verdict] // prettier-ignore
  const tone = verdict === "partial" ? "bad" : verdict === "done" || verdict === "dryRun" ? "good" : "warn" // prettier-ignore

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
      <div className="flex items-start gap-2.5">
        {tone === "good" ? (
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        ) : (
          <TriangleAlert
            className={cn(
              "mt-0.5 size-5 shrink-0",
              tone === "bad" ? "text-destructive" : "text-amber-500"
            )}
            aria-hidden="true"
          />
        )}
        <div>
          <div className="text-sm font-medium">{headline}</div>
          <p className="text-xs text-muted-foreground">{c.counts(ok, warnings.length, failed)}</p>
        </div>
      </div>

      {/* Warnings are the one thing the headline can't carry, so they stay
          visible rather than living only inside the collapsed log. */}
      {warnings.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {warnings.map((r) => (
            <div key={r.id} className="flex items-start gap-2 text-sm">
              <TriangleAlert
                className="mt-0.5 size-3.5 shrink-0 text-amber-500"
                aria-hidden="true"
              />
              <span>{r.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {!dryRun && appTool ? (
        <div className="flex flex-col gap-1.5">
          <Button onClick={openApp} disabled={opening} className="self-start">
            <ExternalLink className="size-4" aria-hidden="true" />
            {c.openApp(t.catalog.cli[appTool.id]?.title ?? appTool.id)}
          </Button>
          {openError ? <p className="text-xs text-destructive">{openError}</p> : null}
        </div>
      ) : null}

      {!dryRun && cliCommand ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">{c.cliHint}</p>
          <Button
            variant="outline"
            className="self-start font-mono"
            onClick={async () => {
              setCopied(await copyText(cliCommand))
            }}
          >
            {copied ? c.copied : cliCommand}
          </Button>
        </div>
      ) : null}

      {todos.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {c.todoTitle}
          </div>
          {todos.map((todo) => (
            <div key={todo} className="flex items-start gap-2 text-sm">
              <Circle className="mt-1 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{todo}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* The old ending, kept verbatim but demoted. */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight
            className={cn("size-3 transition-transform group-open:rotate-90")}
            aria-hidden="true"
          />
          {c.details}
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">
          {summarize(reports, plan, t, dryRun).join("\n")}
        </pre>
      </details>
    </div>
  )
}
