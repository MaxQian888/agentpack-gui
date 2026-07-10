/**
 * Pure grouping/filter/sort logic behind the installed-skills browser. Kept out
 * of the component so it is unit-testable under the coverage gate.
 */
import { skillDescription, skillName, splitFrontmatter } from "./frontmatter"
import type { InstalledSkill, SkillRow, SkillSource } from "./types"

/** Every scan source, in display order (filter pills, target checkboxes). */
export const SKILL_SOURCES: readonly SkillSource[] = ["claude", "codex", "opencode", "agents"]

/**
 * Metadata source priority when the same dir name exists in several roots: the
 * canonical `agents` copy wins (symlinks elsewhere point at it), then claude,
 * codex, opencode.
 */
const SOURCE_PRIORITY: readonly SkillSource[] = ["agents", "claude", "codex", "opencode"]

/** The entry whose content/metadata represents the row (canonical copy first). */
export function primaryEntry(row: SkillRow): InstalledSkill | undefined {
  return SOURCE_PRIORITY.map((s) => row.entries[s]).find(Boolean)
}

/** Group scanned skills into one row per dir name across all sources. */
export function groupSkills(skills: InstalledSkill[]): SkillRow[] {
  const byDir = new Map<string, SkillRow>()
  for (const skill of skills) {
    let row = byDir.get(skill.dirName)
    if (!row) {
      row = {
        dirName: skill.dirName,
        name: skill.dirName,
        description: undefined,
        entries: {},
        nameMismatch: false,
        modifiedAt: 0,
      }
      byDir.set(skill.dirName, row)
    }
    row.entries[skill.source] = skill
    row.modifiedAt = Math.max(row.modifiedAt, skill.modifiedAt)
  }
  for (const row of byDir.values()) {
    const primary = primaryEntry(row)
    if (primary) {
      const doc = splitFrontmatter(primary.skillMd)
      row.name = skillName(doc, row.dirName)
      row.description = skillDescription(doc)
      row.nameMismatch = row.name !== row.dirName
    }
  }
  return [...byDir.values()].sort((a, b) => a.dirName.localeCompare(b.dirName))
}

export type SkillSort = "name" | "modified"

/** Case-insensitive match on name, dir name and description. */
export function filterRows(
  rows: SkillRow[],
  query: string,
  agent: SkillSource | "all"
): SkillRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (agent !== "all" && !row.entries[agent]) return false
    if (!q) return true
    return (
      row.name.toLowerCase().includes(q) ||
      row.dirName.toLowerCase().includes(q) ||
      (row.description?.toLowerCase().includes(q) ?? false)
    )
  })
}

export function sortRows(rows: SkillRow[], sort: SkillSort): SkillRow[] {
  const sorted = [...rows]
  if (sort === "modified") {
    sorted.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name))
  }
  return sorted
}

export function countsBySource(skills: InstalledSkill[]): Record<SkillSource, number> {
  const counts: Record<SkillSource, number> = { claude: 0, codex: 0, opencode: 0, agents: 0 }
  for (const skill of skills) counts[skill.source] += 1
  return counts
}
