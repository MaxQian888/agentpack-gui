/**
 * Types for the installed-skills browser. `InstalledSkill`/`SkillsScanResult`
 * mirror the serde output of `src-tauri/src/skills.rs` (camelCase); the rest are
 * frontend-only shapes derived from them.
 */

/** Where a scanned skill lives — one of the four global skills roots. */
export type SkillSource = "claude" | "codex" | "opencode" | "agents"

/** Roots a skill can be copy-installed into (same set as the scan sources). */
export type SkillInstallTarget = SkillSource

/** One skill directory found on disk (mirrors Rust `InstalledSkill`). */
export interface InstalledSkill {
  source: SkillSource
  dirName: string
  /** Absolute path of the skill directory. */
  path: string
  isSymlink: boolean
  /** Symlink/junction target when `isSymlink` (as stored, not canonicalized). */
  linkTarget: string | null
  /** SKILL.md content (capped by the backend). */
  skillMd: string
  /** Epoch ms of SKILL.md's mtime; 0 when unknown. */
  modifiedAt: number
}

export interface SkillScanError {
  source: string
  message: string
}

/** Result of `skills_scan` (mirrors Rust `SkillsScanResult`). */
export interface SkillsScanResult {
  skills: InstalledSkill[]
  errors: SkillScanError[]
}

/** One skill found inside a fetched repo tarball (mirrors Rust `RepoSkill`). */
export interface RepoSkill {
  dirName: string
  /** Path relative to the repo root (e.g. `skills/web-design`). */
  relPath: string
  skillMd: string
}

/** Result of `fetch_repo_skills` (mirrors Rust `RepoScan`). */
export interface RepoScan {
  scanId: string
  skills: RepoSkill[]
}

/**
 * One browser row: the same skill dir name grouped across every source it is
 * installed in (a skills.sh symlink in `~/.claude/skills` and its canonical copy
 * under `~/.agents/skills` are one logical skill).
 */
export interface SkillRow {
  dirName: string
  /** Frontmatter `name`, falling back to the dir name. */
  name: string
  description: string | undefined
  entries: Partial<Record<SkillSource, InstalledSkill>>
  /** Frontmatter name exists but differs from the dir name (config keys use it). */
  nameMismatch: boolean
  /** Latest SKILL.md mtime across entries (for sorting). */
  modifiedAt: number
}
