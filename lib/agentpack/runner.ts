import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { previewLines, commandToString } from "./preview"
import { BACKUP_SUFFIX } from "./plan"
import type { Command, Paths, StepDescriptor, StepReport } from "./types"
import * as api from "@/lib/tauri/commands"

export interface RunOptions {
  dryRun: boolean
  paths: Paths
  messages?: Messages
  signal?: AbortSignal
  onUpdate?: (report: StepReport, index: number) => void
}

/**
 * Hard cap for a single install command. Installs are network-bound but should
 * never hang forever (a stalled registry, a tool that ignores CI=1 and waits on
 * a prompt); past this the backend kills the process tree and the step fails
 * with a "timed out" message instead of spinning as "running" indefinitely.
 */
const COMMAND_TIMEOUT_SECS = 600

/** Monotonic id so each command run can be cancelled independently. */
let opSeq = 0

const isNotFound = (msg: string) => /command not found/i.test(msg)

/**
 * winget mutating verbs. These hit machine scope on Windows and need admin, so
 * they're routed through UAC elevation — otherwise a non-elevated, non-interactive
 * winget either fails on permissions or reports "No applicable installer found".
 */
const WINGET_ELEVATED_VERBS = new Set(["install", "uninstall", "upgrade"])
const isWingetMutation = (cmd: Command) =>
  cmd.file === "winget" && WINGET_ELEVATED_VERBS.has(cmd.args[0] ?? "")

/** A command step that needs administrator rights (explicit flag or any winget install). */
function stepNeedsElevation(step: StepDescriptor): boolean {
  return step.kind === "command" && (!!step.requiresElevation || isWingetMutation(step.command))
}

/**
 * winget exit codes that mean "nothing to do", not a real failure:
 * `0x8A15002B` (-1978335189) — the package is already installed and current
 * ("No applicable upgrade"). Treated as success so a redundant install doesn't
 * surface as a scary red error.
 */
const WINGET_NO_OP_CODES = new Set([-1978335189])

/**
 * winget `0x8A150014` (-1978335212) — "No installed package found matching input
 * criteria". On an UPGRADE this means the runtime IS installed but not via winget
 * (e.g. Node from nodejs.org / nvm on Windows 10), so winget can't update it in
 * place. Surfaced as a warning with guidance rather than a red failure.
 */
const WINGET_NOT_INSTALLED_CODE = -1978335212

/** A non-fatal step outcome: it didn't fully succeed, but must not read as a red error. */
class StepWarning extends Error {}

/** Windows `ERROR_CANCELLED` — the backend returns this when the user dismisses the UAC prompt. */
const ELEVATION_DECLINED_CODE = 1223

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
        await execute(step, m, log, opts.signal)
      }
      // A manual-action note isn't a real success — nothing was installed — so
      // it reports as a warning, not a green "done".
      report.status = step.kind === "info" && step.manual ? "warning" : "done"
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (opts.signal?.aborted) {
        // The user cancelled: the in-flight command was killed. Show it as
        // cancelled, not a scary error. (Remaining steps are skipped by the
        // aborted check at the top of the loop.)
        report.status = "skipped"
        report.output.push(m.coreOutput.skippedCancelled)
      } else if (err instanceof StepWarning) {
        // A non-fatal outcome (e.g. winget can't update a non-winget install):
        // surface the guidance as a warning, and don't block any dependents.
        report.output.push(msg)
        report.status = "warning"
      } else if (step.kind === "command" && step.verifyOnly) {
        // A failed verification doesn't abort the run, but it must not read as a
        // green success either — surface it as a warning with an actionable hint.
        report.output.push(msg)
        if (isNotFound(msg)) {
          report.output.push(m.coreOutput.notOnPathHint(step.command.file))
        }
        report.status = "warning"
      } else {
        report.status = "error"
        // A killed-on-timeout command rejects with the timeout sentinel — show a
        // friendly localized message rather than the raw sentinel.
        const timedOut = msg === api.TIMEOUT_ERR
        report.error = timedOut ? m.coreOutput.timedOut(Math.round(COMMAND_TIMEOUT_SECS / 60)) : msg
        unmet.add(step.id)
        if (step.kind === "command") {
          // A spawn failure means the binary is missing — tell the user what to
          // do instead of leaving them with a raw OS error.
          if (isNotFound(msg)) {
            const file = step.command.file
            report.output.push(
              file === "npm" || file === "npx"
                ? m.coreOutput.npmMissingHint
                : file === "winget"
                  ? m.coreOutput.wingetMissingHint
                  : m.coreOutput.notOnPathHint(file)
            )
          }
          // An elevated install that still failed (for a reason other than a
          // declined UAC prompt, which already carries its own clear message) —
          // offer the manual "run it as administrator yourself" fallback.
          if (stepNeedsElevation(step) && !timedOut && msg !== m.coreOutput.elevationDeclined) {
            report.output.push(m.coreOutput.elevationHint(commandToString(step.command)))
          }
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
  log: (line: string) => void,
  signal?: AbortSignal
): Promise<void> {
  switch (step.kind) {
    case "command": {
      const printable = commandToString(step.command)
      log(`$ ${printable}`)
      const elevated = stepNeedsElevation(step)
      // Warn before the UAC dialog steals focus, so the prompt isn't a surprise.
      if (elevated) log(m.coreOutput.requestingElevation)
      const code = await api.runCommand(step.command, log, {
        opId: `op-${++opSeq}`,
        timeoutSecs: COMMAND_TIMEOUT_SECS,
        signal,
        elevated,
      })
      if (code === 0) return
      // "Already installed / up to date" from winget isn't a failure.
      if (step.command.file === "winget" && WINGET_NO_OP_CODES.has(code)) {
        log(m.coreOutput.alreadyCurrent)
        return
      }
      // A winget UPGRADE that finds no winget-managed package: the runtime is
      // installed but came from another source, so winget can't update it in
      // place. Warn with guidance instead of failing red (common on Windows 10
      // where Node/Python came from an installer or a version manager).
      if (
        step.command.file === "winget" &&
        step.command.args[0] === "upgrade" &&
        code === WINGET_NOT_INSTALLED_CODE
      ) {
        throw new StepWarning(m.coreOutput.wingetUpdateNotManaged)
      }
      // The user dismissed the UAC prompt — a clean cancellation, not a crash.
      if (elevated && code === ELEVATION_DECLINED_CODE) {
        throw new Error(m.coreOutput.elevationDeclined)
      }
      throw new Error(`${printable} — ${m.coreOutput.exitedWithCode(code)}`)
    }
    case "info": {
      for (const line of step.lines) log(line)
      return
    }
    case "mergeFile":
    case "ccVisibleApps": {
      const existing = await api.readTextFile(step.path)
      // Lightweight rollback: back up the ORIGINAL file the first time agentpack
      // touches it, so a bad merge can be reverted from the dashboard. Only write
      // the backup when one doesn't exist yet — otherwise a later step (or a
      // re-run) writing the same file would overwrite the snapshot with
      // already-merged content and the true original would be lost. Skip when
      // there's nothing to back up yet.
      if (existing.trim()) {
        const backup = `${step.path}${BACKUP_SUFFIX}`
        if (!(await api.pathExists(backup))) {
          await api.writeTextFile(backup, existing)
          log(m.coreOutput.backup(backup))
        }
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
    case "skillCopy": {
      const dests = await api.installSkillFromDir(step.srcPath, step.dirName, step.targets)
      for (const d of dests) log(m.coreOutput.copy(step.srcPath, d))
      return
    }
    case "skillRepoInstall": {
      const dests = await api.installRepoSkills(
        step.scanId,
        step.skills.map((s) => s.relPath),
        step.targets,
        step.repo,
        step.ref
      )
      for (const d of dests) log(m.coreOutput.copy(step.scanId, d))
      return
    }
    case "skillUpdate": {
      const dests = await api.updateSkill(step.path, step.targets, step.mirrorPrefix)
      for (const d of dests) log(m.coreOutput.copy(step.path, d))
      return
    }
    case "skillBackup": {
      const entry = await api.backupSkill(step.path)
      log(m.coreOutput.backup(entry.id))
      return
    }
    case "skillCreate": {
      const dests = await api.createSkill(
        step.name,
        step.targets,
        step.content,
        step.overwrite ?? false
      )
      for (const d of dests) log(m.coreOutput.write(d))
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
