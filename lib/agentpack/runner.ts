import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { previewLines, commandToString } from "./preview"
import { BACKUP_SUFFIX } from "./plan"
import type { Paths, StepDescriptor, StepReport } from "./types"
import * as api from "@/lib/tauri/commands"

export interface RunOptions {
  dryRun: boolean
  paths: Paths
  messages?: Messages
  signal?: AbortSignal
  onUpdate?: (report: StepReport, index: number) => void
}

/**
 * Run descriptors sequentially. A failing step is recorded but does NOT abort
 * the rest (verifyOnly steps swallow errors into output) — except steps whose
 * `dependsOn` names a failed step, which are skipped instead of failing with a
 * confusing follow-on error. Cancellation is checked between steps only — a
 * running step always finishes.
 *
 * Dry-run is structural: it renders preview lines locally and NEVER calls a
 * mutating Rust command.
 */
export async function runSteps(steps: StepDescriptor[], opts: RunOptions): Promise<StepReport[]> {
  const m = opts.messages ?? en
  const reports: StepReport[] = steps.map((s) => ({
    id: s.id,
    label: s.label,
    status: "pending",
    output: [],
  }))
  // Ids of steps that failed or were skipped — dependents of these are skipped.
  const unmet = new Set<string>()

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const report = reports[i]

    if (opts.signal?.aborted) {
      report.status = "skipped"
      report.output.push(m.coreOutput.skippedCancelled)
      opts.onUpdate?.(report, i)
      continue
    }

    // Dry-run never fails, so dependencies only gate real runs.
    const failedDep = !opts.dryRun && step.dependsOn?.find((d) => unmet.has(d))
    if (failedDep) {
      const depLabel = reports.find((r) => r.id === failedDep)?.label ?? failedDep
      report.status = "skipped"
      report.output.push(m.coreOutput.skippedDependency(depLabel))
      unmet.add(step.id)
      opts.onUpdate?.(report, i)
      continue
    }

    report.status = "running"
    opts.onUpdate?.(report, i)
    const log = (line: string) => {
      report.output.push(line)
      opts.onUpdate?.(report, i)
    }

    const startedAt = Date.now()
    try {
      if (opts.dryRun) {
        for (const line of previewLines(step, opts.paths, m)) log(line)
      } else {
        await execute(step, m, log)
      }
      report.status = "done"
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (step.kind === "command" && step.verifyOnly) {
        // A failed verification doesn't abort the run, but it must not read as a
        // green success either — surface it as a warning with an actionable hint.
        report.output.push(msg)
        if (/command not found/i.test(msg)) {
          report.output.push(m.coreOutput.notOnPathHint(step.command.file))
        }
        report.status = "warning"
      } else {
        report.status = "error"
        report.error = msg
        unmet.add(step.id)
        // A spawn failure means the binary is missing — tell the user what to
        // do instead of leaving them with a raw OS error.
        if (step.kind === "command" && /command not found/i.test(msg)) {
          const file = step.command.file
          report.output.push(
            file === "npm" || file === "npx"
              ? m.coreOutput.npmMissingHint
              : m.coreOutput.notOnPathHint(file)
          )
        }
      }
    }
    report.durationMs = Date.now() - startedAt
    opts.onUpdate?.(report, i)
  }

  return reports
}

async function execute(
  step: StepDescriptor,
  m: Messages,
  log: (line: string) => void
): Promise<void> {
  switch (step.kind) {
    case "command": {
      const printable = commandToString(step.command)
      log(`$ ${printable}`)
      const code = await api.runCommand(step.command, log)
      if (code !== 0) throw new Error(`${printable} — ${m.coreOutput.exitedWithCode(code)}`)
      return
    }
    case "info": {
      for (const line of step.lines) log(line)
      return
    }
    case "mergeFile":
    case "ccVisibleApps": {
      const existing = await api.readTextFile(step.path)
      // Lightweight rollback: snapshot the file before overwriting it, so a bad
      // merge can be reverted from the dashboard. Skip when there's nothing yet.
      if (existing.trim()) {
        const backup = `${step.path}${BACKUP_SUFFIX}`
        await api.writeTextFile(backup, existing)
        log(m.coreOutput.backup(backup))
      }
      log(m.coreOutput.write(step.path))
      await api.writeTextFile(step.path, step.merge(existing))
      return
    }
    case "fileRestore": {
      const backup = await api.readTextFile(step.backupPath)
      log(m.coreOutput.restore(step.backupPath, step.path))
      await api.writeTextFile(step.path, backup)
      return
    }
    case "skillInstall": {
      const dests = await api.installSkill(step.skillId, step.targets)
      for (const d of dests) log(m.coreOutput.copy(step.skillId, d))
      return
    }
    case "skillRemove": {
      for (const d of step.dests) {
        log(m.coreOutput.delete(d))
        await api.removeDir(d)
      }
      return
    }
    case "snapshot": {
      const entry = await api.backupSnapshot(step.reason)
      log(m.coreOutput.snapshot(entry.id))
      return
    }
    case "ccProvider": {
      const p = step.payload as {
        app: "claude" | "codex"
        id?: string
        settingsConfig?: string
        form?: { name: string; websiteUrl?: string; notes?: string }
      }
      const lines = await api.ccWriteProvider({
        op: step.op,
        dryRun: false,
        app: p.app,
        id: p.id,
        settingsConfig: p.settingsConfig,
        form: p.form,
      })
      for (const line of lines) log(line)
      return
    }
  }
}
