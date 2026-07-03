import { findMcp } from "./registry"
import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import type { Plan, StepReport } from "./types"

/** Env vars for selected MCP servers that were left without a key. */
export function pendingKeyEnvs(plan: Plan): string[] {
  return plan.mcps
    .map((m) => findMcp(m.id))
    .filter((s) => s?.keyEnv && !plan.mcpKeys[s.id])
    .map((s) => s!.keyEnv!)
}

/**
 * Build a plain-text post-run report shared by the interactive Summary screen
 * and the headless path, so the two never drift.
 */
export function summarize(
  reports: StepReport[],
  plan: Plan,
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

  const pending = pendingKeyEnvs(plan)
  if (pending.length) {
    lines.push(s.pendingKeys)
    for (const k of pending) lines.push(`  • ${k}`)
  }

  const next: string[] = []
  if (plan.clis.includes("claude-code")) {
    next.push(`${s.nextRunPrefix}claude${s.nextRunClaudeSuffix}`)
  }
  if (plan.clis.includes("codex")) {
    next.push(`${s.nextRunPrefix}codex${s.nextRunCodexSuffix}`)
  }
  if (next.length) {
    lines.push(s.nextSteps)
    lines.push(...next)
  }

  return lines
}
