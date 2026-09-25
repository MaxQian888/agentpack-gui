import { findMcp } from "./registry"
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import type { Plan, StepReport } from "./types"

/**
 * Whether a run the user was asked to review actually happened, all of it.
 *
 * `run()` resolves `[]` when the user walks away from the review panel, and a
 * cancelled run comes back with its remaining steps `skipped`. Callers that
 * reacted to "the promise resolved" toasted success, cleared a form or dropped an
 * "update available" flag for a write that never landed. This is the one test
 * for "treat it as done": at least one step, and every step `done` or `warning`.
 */
export function runApplied(reports: readonly StepReport[]): boolean {
  return reports.length > 0 && reports.every((r) => r.status === "done" || r.status === "warning")
}

/**
 * Selected MCP servers left without a key, as `{ id, env }`.
 *
 * The server id comes along because the completion screen has to decide whether
 * the server it belongs to actually installed — an env var alone can't be traced
 * back to a step.
 */
export function pendingKeyEnvs(plan: Plan): { id: string; env: string }[] {
  return plan.mcps
    .map((m) => findMcp(m.id))
    .filter((s) => s?.keyEnv && !plan.mcpKeys[s.id])
    .map((s) => ({ id: s!.id, env: s!.keyEnv! }))
}

/**
 * Build the plain-text post-run report. Rendered verbatim behind the completion
 * screen's "show the full log" disclosure — the one place every failed step and
 * pending key is listed in full. (It is not shared with a headless path; an
 * earlier comment here claimed one, and none exists in this repo.)
 */
export function summarize(
  reports: StepReport[],
  /** Null for a run that wasn't built from a plan — it has no keys or next steps. */
  plan: Plan | null,
  messages: Messages = en,
  dryRun = false
): string[] {
  const ok = reports.filter((r) => r.status === "done").length
  const failed = reports.filter((r) => r.status === "error")
  const warnings = reports.filter((r) => r.status === "warning")
  const s = messages.summary
  const lines: string[] = []

  lines.push(`${dryRun ? s.dryRunComplete : s.setupComplete}${s.counts(ok, failed.length)}`)

  if (failed.length) {
    lines.push(s.failedSteps)
    for (const r of failed) lines.push(`  ✖ ${r.label} — ${r.error ?? ""}`)
  }

  if (warnings.length) {
    lines.push(s.warnings)
    for (const r of warnings) lines.push(`  ⚠ ${r.label}`)
  }

  const pending = plan ? pendingKeyEnvs(plan) : []
  if (pending.length) {
    lines.push(s.pendingKeys)
    for (const k of pending) lines.push(`  • ${k.env}`)
  }

  const next: string[] = []
  if (plan?.clis.includes("claude-code")) {
    next.push(`${s.nextRunPrefix}claude${s.nextRunClaudeSuffix}`)
  }
  if (plan?.clis.includes("codex")) {
    next.push(`${s.nextRunPrefix}codex${s.nextRunCodexSuffix}`)
  }
  if (next.length) {
    lines.push(s.nextSteps)
    lines.push(...next)
  }

  return lines
}
