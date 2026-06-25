import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { previewLines, commandToString } from "./preview"
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
 * the rest (verifyOnly steps swallow errors into output). Cancellation is
 * checked between steps only — a running step always finishes.
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

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const report = reports[i]

    if (opts.signal?.aborted) {
      report.status = "skipped"
      opts.onUpdate?.(report, i)
      continue
    }

    report.status = "running"
    opts.onUpdate?.(report, i)
    const log = (line: string) => {
      report.output.push(line)
      opts.onUpdate?.(report, i)
    }

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
        report.output.push(msg)
        report.status = "done"
      } else {
        report.status = "error"
        report.error = msg
      }
    }
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
      log(m.coreOutput.write(step.path))
      await api.writeTextFile(step.path, step.merge(existing))
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
