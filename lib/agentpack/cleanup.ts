/**
 * The environment-cleanup catalog: what each agent leaves on this machine, and
 * what it costs to clear it.
 *
 * The agents write a lot and delete almost nothing. `~/.codex/sessions` reaches
 * gigabytes on a working machine, `~/.claude/projects` hundreds of megabytes,
 * and neither CLI ships a way to prune either. This file is the browser-safe
 * half of the answer — a table of candidates and the rules for reading it. The
 * filesystem half is `src-tauri/src/cleanup.rs`, which re-derives every root
 * itself and refuses anything outside them.
 *
 * Three properties the table is built around:
 *
 * - **The catalog is candidates; the scan is truth.** Every entry here is a
 *   place an agent *might* be writing. Nothing reaches the UI until a scan says
 *   it exists and how big it is, so a machine without OpenCode never sees an
 *   OpenCode row, and no row ever quotes a size nobody measured.
 * - **A target names what it costs, not just what it is.** `impact` is the
 *   sentence the user reads before deciding — "Claude Code re-creates these on
 *   the next run" vs "the transcripts are gone from the Chat history section
 *   too". A cleanup UI without that is a set of buttons labelled in bytes.
 * - **Nothing here can un-configure the machine.** No entry names a credential
 *   file, a live config, or an installed skill — and the Rust side enforces that
 *   independently, so a mistake in this table is caught rather than executed.
 */

import type { Messages } from "@/lib/i18n/types"

/** Which tool's footprint a target belongs to. */
export type CleanupApp =
  "claude" | "codex" | "opencode" | "copilot" | "cursor" | "cc-switch" | "agentpack"

/**
 * What kind of thing a target is, which is what decides how alarming it should
 * look. Ordered from "regenerates itself" to "this is your data".
 */
export type CleanupCategory =
  | "cache"
  /** Logs, crash dumps, telemetry the CLI failed to send. */
  | "logs"
  /** Shell snapshots, generated images, scratch files a run left behind. */
  | "artifacts"
  /** Rotated config backups the CLI keeps forever. */
  | "backups"
  /** Prompt history, todo state, plans — small, but they are records of you. */
  | "state"
  /** Chat transcripts. What the Chat history section reads. */
  | "chats"
  /** Hook wiring: shell commands the agent runs around every tool call. */
  | "hooks"

/** How much thought a target deserves before it is ticked. */
export type CleanupRisk =
  /** Regenerated automatically; clearing it costs a re-download at worst. */
  | "safe"
  /** Real content goes. Recoverable from quarantine, but the user should read the line. */
  | "review"
  /** Changes how the agent behaves, not just what it stores. Off by default. */
  | "behavioural"

/**
 * One path a target covers, before it is joined to a real directory.
 *
 * `root` names a key of `CleanupRoots` rather than embedding an absolute path,
 * because the roots are resolved in Rust (`$CLAUDE_CONFIG_DIR`, `$CODEX_HOME`,
 * the OS cache dir and OpenCode's probed data dir are all overridable and none
 * of them are `~/.thing`).
 */
export interface CleanupPath {
  root: keyof CleanupRoots
  /** Sub-path under the root, `/`-joined. Empty means the root itself — only legal with a glob. */
  rel?: string
  /** `*`-only pattern over the direct children of the resolved path. */
  glob?: string
}

/** The directories the catalog builds paths under, as resolved by `cleanup_roots`. */
export interface CleanupRoots {
  home: string
  claudeHome: string
  claudeCacheDir: string
  codexHome: string
  opencodeDataDir: string
  opencodeConfigDir: string
  ccSwitchDir: string
  ccConnectDir: string
  copilotDir: string
  cursorDir: string
  agentpackDir: string
}

export interface CleanupTarget {
  id: string
  app: CleanupApp
  category: CleanupCategory
  risk: CleanupRisk
  paths: CleanupPath[]
  /**
   * Whether "keep the last N days" applies. True only where the content is a
   * pile of dated files — an age filter over a single cache blob is a control
   * that looks like it works and doesn't.
   */
  ageFilterable?: boolean
  /**
   * The CLI holds this open while it runs, so cleaning it underneath a live
   * session can corrupt what's left. The UI warns when the process is up.
   */
  warnIfRunning?: boolean
}

/**
 * Targets that edit a config file instead of removing one.
 *
 * Hooks are the case that forced this: "clear Claude Code's hooks" means
 * deleting one key out of `~/.claude/settings.json`, not deleting the file — the
 * file also holds the model, the permissions and the status line. So these run
 * as ordinary `mergeFile` steps, which already back the file up to
 * `.agentpack.bak` before writing, rather than as cleanup steps.
 */
export interface CleanupConfigTarget {
  id: string
  app: CleanupApp
  category: CleanupCategory
  risk: CleanupRisk
  /** Which file, as a `Paths` key. */
  file: "claudeSettings" | "claudeConfig"
  /** Applied to the file's current text; returns the text to write. */
  edit: (existing: string) => string
  /** Whether the file currently has anything for this target to remove. */
  present: (existing: string) => boolean
}

/**
 * Every path-based cleanup candidate.
 *
 * Grounded in what the CLIs actually write, not in what would be tidy: each
 * entry below was checked against a real, heavily-used install. Deliberately
 * absent, and worth knowing why —
 *
 * - `~/.codex/computer-use` holds an installed `.app` bundle, not a cache.
 * - `~/.codex/pets`, `~/.codex/browser` hold user content and live sessions.
 * - `~/.codex/ipc`, `mcp-oauth-locks`, `thread-writer-locks`, `process_manager`
 *   are runtime coordination for a *running* CLI; removing them breaks it.
 * - `~/.claude/plugins/marketplaces` — plugins stop resolving without it, and
 *   whether Claude Code re-clones on demand isn't something to guess at.
 * - `~/.claude/ide` holds lockfiles an attached editor is using.
 * - Skills roots, credentials and live config are refused by the backend outright.
 */
export const CLEANUP_TARGETS: readonly CleanupTarget[] = [
  // ── Claude Code ───────────────────────────────────────────────────────────
  {
    id: "claude-chats",
    app: "claude",
    category: "chats",
    risk: "review",
    paths: [{ root: "claudeHome", rel: "projects" }],
    ageFilterable: true,
    warnIfRunning: true,
  },
  {
    id: "claude-prompt-history",
    app: "claude",
    category: "state",
    risk: "review",
    paths: [{ root: "claudeHome", rel: "history.jsonl" }],
  },
  {
    id: "claude-plans",
    app: "claude",
    category: "state",
    risk: "review",
    paths: [{ root: "claudeHome", rel: "plans" }],
    ageFilterable: true,
  },
  {
    id: "claude-tasks",
    app: "claude",
    category: "state",
    risk: "review",
    paths: [
      { root: "claudeHome", rel: "tasks" },
      { root: "claudeHome", rel: "sessions" },
      { root: "claudeHome", rel: "session-env" },
    ],
    ageFilterable: true,
  },
  {
    id: "claude-file-history",
    app: "claude",
    category: "state",
    risk: "review",
    paths: [{ root: "claudeHome", rel: "file-history" }],
    ageFilterable: true,
  },
  {
    id: "claude-shell-snapshots",
    app: "claude",
    category: "artifacts",
    risk: "safe",
    paths: [{ root: "claudeHome", rel: "shell-snapshots" }],
    ageFilterable: true,
  },
  {
    id: "claude-cache",
    app: "claude",
    category: "cache",
    risk: "safe",
    paths: [
      { root: "claudeHome", rel: "cache" },
      { root: "claudeHome", rel: "mcp-needs-auth-cache.json" },
      { root: "claudeHome", rel: "plugins/cache" },
    ],
  },
  {
    id: "claude-mcp-logs",
    app: "claude",
    category: "logs",
    risk: "safe",
    // The whole directory is Claude's, but a spec still has to narrow a root:
    // the backend refuses "sweep this entire root" outright, and the glob is
    // what keeps its protected-path filter in the loop.
    paths: [{ root: "claudeCacheDir", glob: "*" }],
    ageFilterable: true,
  },
  {
    id: "claude-telemetry",
    app: "claude",
    category: "logs",
    risk: "safe",
    paths: [{ root: "claudeHome", rel: "telemetry" }],
  },
  {
    id: "claude-config-backups",
    app: "claude",
    category: "backups",
    risk: "safe",
    paths: [
      { root: "claudeHome", rel: "backups" },
      // The rotated copies of ~/.claude.json, which live loose in the home dir.
      // `.claude.json` itself is excluded by the backend: only the copies match.
      { root: "home", glob: ".claude.json.*" },
    ],
    ageFilterable: true,
  },

  // ── Codex ─────────────────────────────────────────────────────────────────
  {
    id: "codex-chats",
    app: "codex",
    category: "chats",
    risk: "review",
    paths: [{ root: "codexHome", rel: "sessions" }],
    ageFilterable: true,
    warnIfRunning: true,
  },
  {
    id: "codex-archived-chats",
    app: "codex",
    category: "chats",
    risk: "review",
    paths: [{ root: "codexHome", rel: "archived_sessions" }],
    ageFilterable: true,
  },
  {
    id: "codex-prompt-history",
    app: "codex",
    category: "state",
    risk: "review",
    paths: [
      { root: "codexHome", rel: "history.jsonl" },
      { root: "codexHome", rel: "transcription-history.jsonl" },
    ],
  },
  {
    id: "codex-logs",
    app: "codex",
    category: "logs",
    risk: "review",
    // Version-stamped: the number moves between Codex releases, so a literal
    // name would silently stop matching after an upgrade. The `-wal`/`-shm`
    // siblings have to go with the database, not after it.
    paths: [{ root: "codexHome", glob: "logs_*.sqlite*" }],
    warnIfRunning: true,
  },
  {
    id: "codex-shell-snapshots",
    app: "codex",
    category: "artifacts",
    risk: "safe",
    paths: [{ root: "codexHome", rel: "shell_snapshots" }],
    ageFilterable: true,
  },
  {
    id: "codex-generated",
    app: "codex",
    category: "artifacts",
    risk: "review",
    paths: [
      { root: "codexHome", rel: "generated_images" },
      { root: "codexHome", rel: "visualizations" },
      { root: "codexHome", rel: "attachments" },
    ],
    ageFilterable: true,
  },
  {
    id: "codex-cache",
    app: "codex",
    category: "cache",
    risk: "safe",
    paths: [
      { root: "codexHome", rel: "cache" },
      { root: "codexHome", rel: "models_cache.json" },
      { root: "codexHome", rel: "plugins/cache" },
    ],
  },
  {
    id: "codex-temp",
    app: "codex",
    category: "artifacts",
    risk: "safe",
    paths: [
      { root: "codexHome", rel: "tmp" },
      { root: "codexHome", rel: ".tmp" },
      // Interrupted writes of the global state file, left behind forever.
      { root: "codexHome", glob: "..codex-global-state.json.tmp-*" },
    ],
  },
  {
    id: "codex-hooks-file",
    app: "codex",
    category: "hooks",
    risk: "behavioural",
    paths: [{ root: "codexHome", rel: "hooks.json" }],
  },

  // ── OpenCode ──────────────────────────────────────────────────────────────
  {
    id: "opencode-chats",
    app: "opencode",
    category: "chats",
    risk: "review",
    // The SQLite database the Chat history section reads. Its -wal/-shm
    // siblings have to go with it or OpenCode reopens a half-written database.
    paths: [{ root: "opencodeDataDir", glob: "opencode.db*" }],
    warnIfRunning: true,
  },
  {
    id: "opencode-cache",
    app: "opencode",
    category: "cache",
    risk: "safe",
    paths: [
      { root: "opencodeDataDir", rel: "cache" },
      { root: "opencodeDataDir", rel: "log" },
    ],
    ageFilterable: true,
  },

  // ── Second-tier agents ────────────────────────────────────────────────────
  // Install-only in this app (no skills/MCP writers), but they still fill up a
  // disk, so cleanup covers them. Only what has been verified against a real
  // install is listed — a guessed path with a confident `impact` line beside it
  // is worse than no row, and the catalog's job here is to be trustworthy rather
  // than exhaustive.
  {
    id: "copilot-logs",
    app: "copilot",
    category: "logs",
    risk: "safe",
    paths: [{ root: "copilotDir", rel: "logs" }],
    ageFilterable: true,
  },
  {
    id: "cursor-hooks",
    app: "cursor",
    category: "hooks",
    risk: "behavioural",
    paths: [{ root: "cursorDir", rel: "hooks.json" }],
  },

  // ── agentpack itself ──────────────────────────────────────────────────────
  {
    id: "agentpack-activity",
    app: "agentpack",
    category: "state",
    risk: "review",
    paths: [{ root: "agentpackDir", rel: "activity.json" }],
  },
  {
    id: "agentpack-history-cache",
    app: "agentpack",
    category: "cache",
    risk: "safe",
    // The Chat history caches — ~9 MB of packed events. Clearing them costs one
    // cold rescan (~17 s), never any data.
    paths: [{ root: "agentpackDir", glob: "history-cache*.json" }],
  },
  {
    id: "cc-switch-backups",
    app: "cc-switch",
    category: "backups",
    risk: "review",
    paths: [{ root: "ccSwitchDir", rel: "backups" }],
    ageFilterable: true,
  },
] as const

/**
 * Read `hooks` out of a Claude settings.json body.
 *
 * Tolerant on the way in and conservative on the way out: an unparseable
 * settings.json reports "nothing to clear" rather than offering to rewrite a
 * file we couldn't read — which is the only way this can't destroy a config it
 * didn't understand.
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    const data: unknown = JSON.parse(text)
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    return data as Record<string, unknown>
  } catch {
    return null
  }
}

/** Whether an object holds a non-empty value at `key`. */
function hasEntries(data: Record<string, unknown> | null, key: string): boolean {
  const value = data?.[key]
  if (!value || typeof value !== "object") return false
  return Object.keys(value as Record<string, unknown>).length > 0
}

/** Serialize back with the two-space indent both CLIs write. */
function writeJson(data: Record<string, unknown>): string {
  return `${JSON.stringify(data, null, 2)}\n`
}

/**
 * Config-key cleanup targets — the ones that edit rather than delete.
 *
 * Every `edit` here is a no-op on input it doesn't recognise: given an
 * unparseable file it returns the text verbatim, so the worst case of a bad
 * merge is that nothing happens.
 */
export const CLEANUP_CONFIG_TARGETS: readonly CleanupConfigTarget[] = [
  {
    id: "claude-hooks",
    app: "claude",
    category: "hooks",
    risk: "behavioural",
    file: "claudeSettings",
    present: (text) => hasEntries(parseJsonObject(text), "hooks"),
    edit: (text) => {
      const data = parseJsonObject(text)
      if (!data || !("hooks" in data)) return text
      const rest = { ...data }
      delete rest["hooks"]
      return writeJson(rest)
    },
  },
  {
    id: "claude-project-history",
    app: "claude",
    category: "state",
    risk: "review",
    file: "claudeConfig",
    // ~/.claude.json keeps a `history` array of every prompt you have typed, per
    // project, forever. It is the single largest record in that file and the one
    // people are most often surprised to learn exists.
    present: (text) => {
      const data = parseJsonObject(text)
      const projects = data?.["projects"]
      if (!projects || typeof projects !== "object") return false
      // A `history: []` is already clear. Treating a present-but-empty array as
      // "something to remove" would leave the row on screen forever, offering a
      // write that changes nothing.
      return Object.values(projects as Record<string, unknown>).some((p) => {
        const history = (p as Record<string, unknown> | null)?.["history"]
        return Array.isArray(history) && history.length > 0
      })
    },
    edit: (text) => {
      const data = parseJsonObject(text)
      const projects = data?.["projects"]
      if (!data || !projects || typeof projects !== "object") return text
      const cleaned = Object.fromEntries(
        Object.entries(projects as Record<string, unknown>).map(([key, project]) => {
          if (!project || typeof project !== "object") return [key, project]
          const entry = project as Record<string, unknown>
          // Emptied, not deleted: Claude Code expects the key to be an array,
          // and a missing one is a shape it has never had to read.
          return [key, "history" in entry ? { ...entry, history: [] } : entry]
        })
      )
      return writeJson({ ...data, projects: cleaned })
    },
  },
] as const

// ── Resolution ──────────────────────────────────────────────────────────────

/** One resolved path, ready to hand to the backend. */
export interface CleanupSpec {
  id: string
  path: string
  glob?: string
  olderThanDays?: number
}

/** What the backend measured for one spec. */
export interface CleanupStat {
  id: string
  path: string
  exists: boolean
  bytes: number
  files: number
  newestMs: number
  oldestMs: number
  degraded: boolean
}

/** A target joined to its scan results — what a row in the UI is. */
export interface CleanupRow {
  target: CleanupTarget
  bytes: number
  files: number
  /** Newest / oldest selected file, epoch ms; 0 when nothing matched. */
  newestMs: number
  oldestMs: number
  /** At least one of the target's paths exists on this machine. */
  exists: boolean
  /** At least one path couldn't be fully read, so `bytes` is a floor. */
  degraded: boolean
  paths: string[]
}

const SEP_RE = /\/+/g

/** Join a root and a `/`-separated sub-path using the platform's separator. */
export function joinPath(
  root: string,
  rel: string | undefined,
  os: "win" | "mac" | "linux"
): string {
  if (!rel) return root
  const sep = os === "win" ? "\\" : "/"
  const parts = rel.split(SEP_RE).filter(Boolean)
  return [root, ...parts].join(sep)
}

/**
 * Turn a target into the specs the backend scans or cleans.
 *
 * `olderThanDays` is applied only to `ageFilterable` targets. Passing it to the
 * others would be worse than ignoring it: `codex-logs` is one database file, and
 * an age filter over it means "clear it only if you haven't used Codex lately",
 * which is not what a slider labelled "keep the last 30 days" promises.
 */
export function specsFor(
  target: CleanupTarget,
  roots: CleanupRoots,
  os: "win" | "mac" | "linux",
  olderThanDays?: number
): CleanupSpec[] {
  const age = target.ageFilterable && olderThanDays && olderThanDays > 0 ? olderThanDays : undefined
  return target.paths.map((p) => ({
    id: target.id,
    path: joinPath(roots[p.root], p.rel, os),
    ...(p.glob ? { glob: p.glob } : {}),
    ...(age ? { olderThanDays: age } : {}),
  }))
}

/** Every spec for a set of targets, in catalog order. */
export function specsForAll(
  targets: readonly CleanupTarget[],
  roots: CleanupRoots,
  os: "win" | "mac" | "linux",
  olderThanDays?: number
): CleanupSpec[] {
  return targets.flatMap((t) => specsFor(t, roots, os, olderThanDays))
}

/**
 * Fold per-path stats back into one row per target.
 *
 * A row exists when **any** of its paths does — `claude-cache` covers three
 * locations and two of them are routinely absent, so requiring all of them would
 * hide the one holding 24 MB.
 */
export function rowsFrom(
  targets: readonly CleanupTarget[],
  stats: readonly CleanupStat[]
): CleanupRow[] {
  const byId = new Map<string, CleanupStat[]>()
  for (const stat of stats) {
    const list = byId.get(stat.id)
    if (list) list.push(stat)
    else byId.set(stat.id, [stat])
  }
  const rows: CleanupRow[] = []
  for (const target of targets) {
    const mine = byId.get(target.id) ?? []
    if (mine.length === 0) continue
    const present = mine.filter((s) => s.exists)
    const oldest = present.map((s) => s.oldestMs).filter((ms) => ms > 0)
    rows.push({
      target,
      bytes: present.reduce((sum, s) => sum + s.bytes, 0),
      files: present.reduce((sum, s) => sum + s.files, 0),
      newestMs: present.reduce((max, s) => Math.max(max, s.newestMs), 0),
      oldestMs: oldest.length ? Math.min(...oldest) : 0,
      exists: present.length > 0,
      degraded: mine.some((s) => s.degraded && s.exists) || present.some((s) => s.degraded),
      paths: mine.map((s) => s.path),
    })
  }
  return rows
}

/** Rows worth showing: the target exists and currently holds something. */
export function visibleRows(rows: readonly CleanupRow[]): CleanupRow[] {
  return rows.filter((r) => r.exists && (r.files > 0 || r.degraded))
}

/** Rows for one app, in catalog order. */
export function rowsForApp(rows: readonly CleanupRow[], app: CleanupApp): CleanupRow[] {
  return rows.filter((r) => r.target.app === app)
}

/**
 * Category order within an app's card: regenerated first, your data last.
 *
 * Deliberately safest-first. The eye lands on the caches — the things anyone can
 * clear without thinking — and has to travel past them to reach the transcripts,
 * which is the opposite of a list that opens with a 1.9 GB row begging to be ticked.
 */
export const CATEGORY_ORDER: readonly CleanupCategory[] = [
  "cache",
  "logs",
  "artifacts",
  "backups",
  "state",
  "chats",
  "hooks",
]

/** A category heading and the rows under it. Empty categories are omitted. */
export interface CleanupGroup<T> {
  category: CleanupCategory
  items: T[]
}

/**
 * Group by category in [`CATEGORY_ORDER`].
 *
 * The category is a heading rather than a per-row chip because as a chip it was
 * usually a second copy of the row's own title — "Caches / Caches" — which reads
 * as a rendering bug and pushes the risk badge, the one chip that carries new
 * information, off to the side.
 */
export function groupByCategory<T extends { category: CleanupCategory }>(
  items: readonly T[]
): CleanupGroup<T>[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((g) => g.items.length > 0)
}

/** Total bytes across a selection. */
export function totalBytes(rows: readonly CleanupRow[], selected: ReadonlySet<string>): number {
  return rows.reduce((sum, r) => (selected.has(r.target.id) ? sum + r.bytes : sum), 0)
}

/** Total file count across a selection. */
export function totalFiles(rows: readonly CleanupRow[], selected: ReadonlySet<string>): number {
  return rows.reduce((sum, r) => (selected.has(r.target.id) ? sum + r.files : sum), 0)
}

/**
 * Which targets a "one-click safe clean" ticks.
 *
 * Only `safe` ones, and only where something is actually there. The button has
 * to be the one a user can press without reading anything — the moment it also
 * clears chat history, every other affordance in the section becomes a thing
 * people click past.
 */
export function safeSelection(rows: readonly CleanupRow[]): string[] {
  return visibleRows(rows)
    .filter((r) => r.target.risk === "safe")
    .map((r) => r.target.id)
}

/** Apps that have at least one visible row, in catalog order. */
export function appsPresent(rows: readonly CleanupRow[]): CleanupApp[] {
  const out: CleanupApp[] = []
  for (const row of visibleRows(rows)) {
    if (!out.includes(row.target.app)) out.push(row.target.app)
  }
  return out
}

/** Human byte size. `0 B` for empty — never a blank cell. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** The i18n label for a target, falling back to its id if the catalog outruns the copy. */
export function targetLabel(t: Messages, id: string): string {
  return t.cleanup.targets[id]?.title ?? id
}

/** The "what it costs you" line for a target. */
export function targetImpact(t: Messages, id: string): string {
  return t.cleanup.targets[id]?.impact ?? ""
}

/** Preset age filters, in the order the UI offers them. `0` means everything. */
export const AGE_PRESETS: readonly number[] = [0, 7, 30, 90, 180]
