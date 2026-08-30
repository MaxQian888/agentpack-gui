import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { previewLines, commandToString } from "./preview"
import { formatBytes } from "./cleanup"
import { BACKUP_SUFFIX } from "./plan"
import { classifyFailure, remediesFor, type RecoveryContext } from "./network/recovery"
import { pickReleaseAsset } from "./release"
import type { Command, CommandStep, Paths, StepDescriptor, StepRecovery, StepReport } from "./types"
import * as api from "@/lib/tauri/commands"

export interface RunOptions {
  dryRun: boolean
  paths: Paths
  messages?: Messages
  signal?: AbortSignal
  onUpdate?: (report: StepReport, index: number) => void
  /**
   * Enables automatic recovery from network failures: when a command exits
   * non-zero with output that reads like a transport problem, the runner retries
   * it through the mirrors and proxy this context names, then through the step's
   * own `fallbacks`.
   *
   * Omit it and the runner behaves exactly as it always has — no reclassifying,
   * no retries. Every retry is a command-line flag or a per-spawn environment
   * variable, so even a successful one leaves the machine untouched; making it
   * permanent is a separate, user-initiated action.
   */
  recovery?: RecoveryContext
}

/**
 * How many rewritten retries a single command gets before we move on to its
 * fallbacks. Small on purpose: each rung costs a real network round trip, and a
 * ladder that grinds for minutes is worse than a clear failure.
 */
const MAX_RECOVERY_ATTEMPTS = 3

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
 * winget mutating verbs normally hit machine scope on Windows and need admin.
 * An explicit `--scope user` must stay in the current account: elevating as a
 * different administrator would install a Store/MSIX package for that account.
 */
const WINGET_ELEVATED_VERBS = new Set(["install", "uninstall", "upgrade"])
const isUserScopeWinget = (cmd: Command) => {
  const scope = cmd.args.indexOf("--scope")
  return cmd.file === "winget" && scope >= 0 && cmd.args[scope + 1]?.toLowerCase() === "user"
}
const isWingetMutation = (cmd: Command) =>
  cmd.file === "winget" && WINGET_ELEVATED_VERBS.has(cmd.args[0] ?? "") && !isUserScopeWinget(cmd)

/** A command step that needs administrator rights (explicit flag or machine-scope winget). */
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
        const recovered = await execute(step, {
          m,
          log,
          signal: opts.signal,
          recovery: opts.recovery,
          allowFallbacks: true,
          setArtifact: (id) => {
            report.artifact = id
          },
        })
        if (recovered) report.recovery = recovered
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

/** Everything a step needs to run, threaded through so fallbacks can recurse. */
interface ExecContext {
  m: Messages
  log: (line: string) => void
  signal?: AbortSignal
  recovery?: RecoveryContext
  /** False inside a fallback, so a fallback can never spawn fallbacks of its own. */
  allowFallbacks: boolean
  /**
   * Record the restore point this step created. Only the two steps that
   * genuinely make one call it — an installed CLI has no snapshot, and the
   * activity log says "no automatic undo" for those rather than offering a
   * button that would fail.
   */
  setArtifact: (id: string) => void
}

/**
 * Run one command step, recovering from a network failure when the run was given
 * a `RecoveryContext`. Resolves with the route that worked (when it wasn't the
 * original command), or undefined for a plain first-try success.
 *
 * Only a non-zero exit with network-looking output is retried. A rejection —
 * a missing binary, or our own 10-minute timeout kill — propagates untouched:
 * those aren't transport hiccups a different mirror fixes, and re-running a
 * command that already hung for ten minutes three more times would be worse
 * than the failure.
 */
async function runCommandStep(
  step: CommandStep,
  ctx: ExecContext
): Promise<StepRecovery | undefined> {
  const { m, log } = ctx
  const elevated = stepNeedsElevation(step)
  // Kept alongside the report's own output so the classifier reads exactly what
  // this command printed, not whatever earlier steps left behind.
  const lines: string[] = []
  const collect = (line: string) => {
    lines.push(line)
    log(line)
  }

  const attempt = (command: Command, env?: Record<string, string>) => {
    log(`$ ${commandToString(command)}`)
    // Warn before the UAC dialog steals focus, so the prompt isn't a surprise.
    if (elevated) log(m.coreOutput.requestingElevation)
    return api.runCommand(command, collect, {
      opId: `op-${++opSeq}`,
      timeoutSecs: COMMAND_TIMEOUT_SECS,
      signal: ctx.signal,
      elevated,
      env,
    })
  }

  const code = await attempt(step.command)
  if (code === 0) return undefined

  // "Already installed / up to date" from winget isn't a failure.
  if (step.command.file === "winget" && WINGET_NO_OP_CODES.has(code)) {
    log(m.coreOutput.alreadyCurrent)
    return undefined
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
  const failure = new Error(
    `${commandToString(step.command)} — ${m.coreOutput.exitedWithCode(code)}`
  )

  // A verify step is a `--version` probe; there is nothing to route around.
  if (!ctx.recovery || step.verifyOnly) throw failure
  if (classifyFailure(lines, code) !== "network") throw failure

  log(m.coreOutput.networkFailure)
  const recovered = await recoverCommand(step, ctx, attempt)
  if (recovered) return recovered

  log(m.coreOutput.recoveryExhausted)
  throw failure
}

/**
 * Walk the recovery ladder: first rewrites of the same command (a mirror, a
 * proxy, both), then the step's wholly different routes. Returns the one that
 * worked, or undefined when every option is spent.
 */
async function recoverCommand(
  step: CommandStep,
  ctx: ExecContext,
  attempt: (command: Command, env?: Record<string, string>) => Promise<number>
): Promise<StepRecovery | undefined> {
  const { m, log } = ctx
  const ladder = remediesFor(step.command, ctx.recovery!).slice(0, MAX_RECOVERY_ATTEMPTS)
  for (const remedy of ladder) {
    if (ctx.signal?.aborted) return undefined
    log(m.coreOutput.retryingVia(remedy.label))
    // A remedy that can't even spawn is just a dead rung, not a run-ending error.
    const code = await attempt(remedy.command, remedy.env).catch(() => -1)
    if (code === 0) {
      log(m.coreOutput.recoveredVia(remedy.label))
      return { remedyId: remedy.id, label: remedy.label, persist: remedy.persist }
    }
  }

  if (!ctx.allowFallbacks) return undefined
  for (const fallback of step.fallbacks ?? []) {
    if (ctx.signal?.aborted) return undefined
    log(m.coreOutput.retryingFallback(fallback.label))
    try {
      await execute(fallback, { ...ctx, allowFallbacks: false })
      log(m.coreOutput.recoveredVia(fallback.label))
      return { remedyId: `fallback:${fallback.id}`, label: fallback.label }
    } catch {
      // Try the next route; the original error is what gets reported if none work.
    }
  }
  return undefined
}

async function execute(step: StepDescriptor, ctx: ExecContext): Promise<StepRecovery | undefined> {
  const { m, log } = ctx
  switch (step.kind) {
    case "command":
      return runCommandStep(step, ctx)
    case "releaseInstall": {
      const r = m.coreOutput
      // Only the resolution differs between the two source kinds; download and
      // install below are shared.
      let asset: { name: string; url: string }
      // A mirror prefix rewrites github.com URLs. Prepending it to a vendor's
      // own host would point the download at somewhere that never had the file.
      let mirrorPrefix = step.mirrorPrefix
      if (step.source.kind === "manifest") {
        const url = step.source.manifest[step.os]
        if (!url) throw new Error(r.releaseNoAsset(step.title, "", step.arch))
        const release = await api.manifestLatestRelease(url)
        const only = release.assets[0]
        if (!only) throw new Error(r.releaseNoAsset(step.title, release.tag, step.arch))
        asset = only
        mirrorPrefix = null
        log(r.releaseFound(step.title, release.tag, only.name))
      } else {
        const release = await api.githubLatestRelease(step.source.repo, step.mirrorPrefix)
        const picked = pickReleaseAsset(step.source, release.assets, step.os, step.arch)
        if (!picked) throw new Error(r.releaseNoAsset(step.title, release.tag, step.arch))
        asset = picked
        log(r.releaseFound(step.title, release.tag, picked.name))
      }

      // Progress is throttled by the backend; render it as a single line the
      // step log overwrites rather than a scrolling wall of percentages.
      let lastPct = -1
      const path = await api.downloadReleaseAsset(
        asset.url,
        asset.name,
        mirrorPrefix,
        ({ received, total }) => {
          const pct = total > 0 ? Math.floor((received / total) * 100) : -1
          if (pct >= 0 && pct >= lastPct + 10) {
            lastPct = pct
            log(r.releaseDownloading(pct))
          }
        }
      )
      log(r.releaseDownloaded(path))
      const code = await api.installPackage(path, log)
      if (code !== 0) throw new Error(`${step.title} — ${r.exitedWithCode(code)}`)
      return undefined
    }
    case "info": {
      for (const line of step.lines) log(line)
      return
    }
    case "mergeFile":
    case "ccVisibleApps": {
      let existing: string
      try {
        existing = await api.readTextFile(step.path)
      } catch (error) {
        if (await api.pathExists(step.path)) throw error
        existing = ""
      }
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
      // `writtenNote` says what the write *means* ("added the MCP server to
      // Claude") rather than just naming a file, so prefer it. `ccVisibleApps`
      // has no note of its own and falls back to the path.
      log("writtenNote" in step ? step.writtenNote : m.coreOutput.write(step.path))
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
      const entry = step.backend
        ? await api.backupSnapshot(step.reason, step.backend)
        : await api.backupSnapshot(step.reason)
      log(m.coreOutput.snapshot(entry.id))
      ctx.setArtifact(entry.id)
      return
    }
    case "cleanup": {
      const result = await api.cleanupApply(step.specs, step.mode)
      // Report what could not be done before what could: a run that skipped a
      // file because a CLI held it open has to say so, or the user reads the
      // freed-bytes line as "all of it went".
      for (const err of result.errors) log(m.coreOutput.cleanupSkipped(err))
      if (result.quarantineId) {
        log(m.coreOutput.cleanupQuarantined(formatBytes(result.bytes), result.removed))
        log(m.coreOutput.restorePoint(result.quarantineId))
        // The quarantine batch IS the restore point, so the activity log and the
        // completion screen surface it exactly like a config snapshot.
        ctx.setArtifact(result.quarantineId)
      } else {
        log(m.coreOutput.cleanupDeleted(formatBytes(result.bytes), result.removed))
      }
      // Errors are per-path and non-fatal, but a run where nothing moved and
      // everything failed must not report as a clean success.
      if (result.errors.length > 0 && result.removed === 0) {
        throw new StepWarning(m.coreOutput.cleanupNothingRemoved)
      }
      return
    }
    case "snapshotRestore": {
      const result = await api.backupRestore(step.snapshotId)
      for (const path of result.restoredPaths) log(m.coreOutput.restored(path))
      // The restore took its own snapshot on the way through, so this step is
      // itself reversible — which is the whole reason a restore is allowed to
      // overwrite live config at all.
      log(m.coreOutput.restorePoint(result.safetySnapshotId))
      ctx.setArtifact(result.safetySnapshotId)
      return
    }
    case "ccProvider": {
      const p = step.payload as {
        backend?: "native" | "ccswitch"
        app: "claude" | "codex" | "opencode"
        id?: string
        settingsConfig?: string
        form?: { name: string; websiteUrl?: string; notes?: string }
      }
      const base = {
        op: step.op,
        dryRun: false,
        app: p.app,
        id: p.id,
        settingsConfig: p.settingsConfig,
        form: p.form,
      }
      const lines =
        p.backend === "native"
          ? await api.providerWrite({ ...base, backend: "native" })
          : await api.ccWriteProvider(base)
      for (const line of lines) log(line)
      return
    }
  }
}
