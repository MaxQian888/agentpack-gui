/**
 * Types for the installed-skills browser. `InstalledSkill`/`SkillsScanResult`
 * mirror the serde output of `src-tauri/src/skills.rs` (camelCase); the rest are
 * frontend-only shapes derived from them.
 */

/** Where a scanned skill lives — one of the four global skills roots. */
export type SkillSource = "claude" | "codex" | "opencode" | "pi" | "agents"

/** Roots a skill can be copy-installed into (same set as the scan sources). */
export type SkillInstallTarget = SkillSource

/**
 * Provenance for a skill installed from a GitHub repo (mirrors Rust
 * `SkillOrigin`, persisted as `<skill-dir>/.agentpack-origin.json`). Absent for
 * hand-authored / locally-imported skills, which are therefore not updatable.
 */
export interface SkillOrigin {
  /** `owner/name`. */
  repo: string
  /** Branch / tag / sha the skill was installed from. */
  ref: string
  /** Path of the skill within the repo (`""` when the repo root is the skill). */
  relPath: string
  /** sha256 of the skill subtree at install time (drives update detection). */
  contentHash: string
  installedAt: number
}

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
  /** GitHub provenance when installed from a repo; null otherwise. */
  origin: SkillOrigin | null
}

/** One file inside a skill directory (mirrors Rust `SkillFile`). */
export interface SkillFile {
  /** Path relative to the skill dir, forward slashes. */
  relPath: string
  bytes: number
  isDir: boolean
}

/** A backed-up skill kept before deletion (mirrors Rust `SkillBackup`). */
export interface SkillBackup {
  id: string
  name: string
  dirName: string
  /** Source root the skill was backed up from ("claude"/…/"unknown"). */
  source: string
  bytes: number
  createdAt: number
}

/** Per-skill update-check result (mirrors Rust `UpdateResult`). */
export interface SkillUpdateResult {
  /** The installed skill path this result refers to (echoed from the query). */
  path: string
  hasUpdate: boolean
  latestHash: string
  error: string | null
}

/** A saved GitHub skill repository the user can browse & install from. */
export interface RepoSource {
  /** `owner/name`, a github.com URL, or a `tree/<ref>` deep link. */
  url: string
  /** Optional friendly label; falls back to the url. */
  label?: string
  /** Optional ref override (branch/tag/sha). */
  ref?: string
  /** Optional subpath to narrow the browse to. */
  subpath?: string
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
