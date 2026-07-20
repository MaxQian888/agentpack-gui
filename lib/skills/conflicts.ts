/**
 * Install-conflict detection: which requested (skill dir → source) installs
 * would overwrite a skill that already exists on disk. Pure so it is unit-tested
 * under the coverage gate; the dialog in
 * `components/agentpack/sections/skills/install-conflict-dialog.tsx` renders the
 * result and lets the user overwrite or skip each target.
 */
import type { InstalledSkill, SkillSource } from "./types"

/** One requested install: a skill dir going into one or more source roots. */
export interface InstallRequest {
  dirName: string
  targets: SkillSource[]
}

/** A (dirName, source) pair that already exists and would be overwritten. */
export interface SkillConflict {
  dirName: string
  source: SkillSource
}

// A space joiner is unambiguous: skill dir names are validated to letters,
// numbers, dots and dashes, so they can never contain one.
const key = (source: SkillSource, dirName: string) => `${source} ${dirName}`

/** Fast lookup of every (source, dirName) pair currently installed. */
export function existingSet(skills: InstalledSkill[]): Set<string> {
  return new Set(skills.map((s) => key(s.source, s.dirName)))
}

/** The subset of requested installs that would overwrite an existing skill. */
export function findConflicts(
  requests: InstallRequest[],
  skills: InstalledSkill[]
): SkillConflict[] {
  const existing = existingSet(skills)
  const out: SkillConflict[] = []
  for (const req of requests) {
    for (const source of req.targets) {
      if (existing.has(key(source, req.dirName))) out.push({ dirName: req.dirName, source })
    }
  }
  return out
}

/**
 * Drop the user-skipped (dirName, source) targets from the requests, removing
 * any request left with no targets. Returns the installs that should proceed.
 */
export function pruneSkipped(
  requests: InstallRequest[],
  skipped: SkillConflict[]
): InstallRequest[] {
  const skip = new Set(skipped.map((c) => key(c.source, c.dirName)))
  return requests
    .map((r) => ({
      dirName: r.dirName,
      targets: r.targets.filter((s) => !skip.has(key(s, r.dirName))),
    }))
    .filter((r) => r.targets.length > 0)
}
