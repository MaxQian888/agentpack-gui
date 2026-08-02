import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
import { formatBytes } from "./cleanup"
import { releaseSourceLabel } from "./release"
import type { Command, Paths, StepDescriptor } from "./types"

/** Render a command as a copy-pasteable shell string (best-effort quoting). */
export function commandToString(cmd: Command): string {
  const quote = (a: string) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)
  return [cmd.file, ...cmd.args.map(quote)].join(" ")
}

/**
 * The dry-run output for a descriptor — the "would …" lines shown in preview
 * mode. Pure (no IPC), so preview never touches the system.
 */
export function previewLines(
  step: StepDescriptor,
  paths: Paths,
  messages: Messages = en
): string[] {
  const out = messages.coreOutput
  switch (step.kind) {
    case "command":
      return [`$ ${commandToString(step.command)}`, out.wouldRun(commandToString(step.command))]
    case "releaseInstall": {
      // Named rather than resolved: looking the release up would be a network
      // call, and dry-run's promise is that it never leaves the machine.
      const from = releaseSourceLabel(step.source, step.os)
      // A mirror only rewrites github.com, so naming one for a vendor's own
      // manifest would describe a download that isn't going to happen.
      return [
        step.mirrorPrefix && step.source.kind === "github"
          ? out.wouldReleaseInstallVia(step.title, from, step.mirrorPrefix)
          : out.wouldReleaseInstall(step.title, from),
      ]
    }
    case "info":
      return step.lines
    case "mergeFile":
    case "ccVisibleApps":
      return [out.wouldWrite(step.path)]
    case "skillInstall":
      return step.targets.map((target) =>
        out.wouldCopy(
          `${paths.home}/assets/skills/${step.skillId}`,
          `${target === "claude" ? paths.claudeSkillsDir : paths.codexSkillsDir}/${step.skillId}`
        )
      )
    case "skillRemove":
      return step.dests.map((d) => out.wouldDelete(d))
    case "skillCopy":
      return step.dests.map((d) => out.wouldCopy(step.srcPath, d))
    case "skillRepoInstall":
      // dests are precomputed (skill × target) — dry-run never touches the scan.
      return step.dests.map((d) => out.wouldCopy(step.scanId, d))
    case "skillUpdate":
      return step.dests.map((d) => out.wouldCopy(step.path, d))
    case "skillBackup":
      return [out.wouldBackupSkill(step.path)]
    case "skillCreate":
      return step.dests.map((d) => out.wouldWrite(d))
    case "ccProvider": {
      // The only branch here that used to build its line by hand: it was
      // hardcoded English and leaked the internal op verb ("setCurrent") into
      // what a zh-CN user reads.
      const app = (step.payload as { app?: string }).app ?? ""
      return [out.wouldCcProvider[step.op](app)]
    }
    case "fileRestore":
      return [out.wouldRestore(step.backupPath, step.path)]
    case "snapshot":
      return [out.wouldSnapshot]
    case "snapshotRestore":
      return [out.wouldRestoreSnapshot(step.snapshotId)]
    case "cleanup": {
      // Every path and its measured size, so the review panel shows what will
      // go rather than a count. The sizes came from the section's scan — the
      // preview itself still reaches nothing.
      const lines = step.entries.map((e) =>
        step.mode === "quarantine"
          ? out.wouldQuarantine(e.path, formatBytes(e.bytes), e.files)
          : out.wouldDeleteSized(e.path, formatBytes(e.bytes), e.files)
      )
      const bytes = step.entries.reduce((sum, e) => sum + e.bytes, 0)
      // The closing line is the one that says what "cleaned" means here: under
      // quarantine the space is not free yet, and a preview that let someone
      // believe otherwise would be the whole feature's first broken promise.
      lines.push(
        step.mode === "quarantine"
          ? out.wouldQuarantineTotal(formatBytes(bytes))
          : out.wouldDeleteTotal(formatBytes(bytes))
      )
      return lines
    }
  }
}
