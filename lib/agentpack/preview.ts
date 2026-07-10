import { en } from "@/lib/i18n/en"
import type { Messages } from "@/lib/i18n/types"
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
    case "ccProvider": {
      const app = (step.payload as { app?: string }).app ?? ""
      return [`would run: ${step.op} provider (${app})`]
    }
    case "fileRestore":
      return [out.wouldRestore(step.backupPath, step.path)]
    case "snapshot":
      return [out.wouldSnapshot]
  }
}
