//! Environment cleanup: reclaim the disk the agent CLIs quietly fill up, and
//! clear the records they leave behind.
//!
//! The agents write a lot and delete almost nothing. On a working machine
//! `~/.codex/sessions` alone reaches gigabytes, `~/.claude/projects` hundreds of
//! megabytes, and neither CLI offers a way to prune them. This module is the
//! side-effect half of that: the *taxonomy* (which directory is a cache, which
//! is a record, what deleting it costs the user) lives in `lib/agentpack/cleanup.ts`
//! so it stays pure and translatable — everything here is path math, `stat`,
//! rename and unlink.
//!
//! Three rules the rest of this file exists to enforce:
//!
//! 1. **The frontend never picks the path.** Every incoming path is re-validated
//!    against roots computed *here* ([`allowed_roots`]) and against a deny-list
//!    of files that must survive any cleanup ([`protected_paths`]) — credentials,
//!    live config, installed skills. A crafted or buggy spec cannot reach them.
//! 2. **A directory named as a target is preserved; its entries are what go.**
//!    So cleaning `~/.claude/projects` leaves the directory the CLI expects to
//!    find, and cleaning `~/.claude/plugins/cache` can never take
//!    `installed_plugins.json` sitting next to it.
//! 3. **Removal is a move, not an unlink,** unless the caller explicitly asks
//!    for [`CleanupMode::Delete`]. Quarantine is a same-volume rename into
//!    `~/.agentpack/trash/<batch>/`, so clearing 1.9 GB is instant and stays
//!    undoable; the space comes back when the user purges the batch.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Every directory the cleanup catalog is allowed to build paths under.
///
/// Resolved here rather than in `paths::get_paths` because these are cleanup's
/// concern alone, and because two of them (the OS cache dir, OpenCode's data
/// dir) are probed rather than derived — `Paths` is a flat set of well-known
/// locations and lying about "the" OpenCode data dir there would mislead the
/// eight other callers of it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRoots {
  pub home: String,
  /// `$CLAUDE_CONFIG_DIR` or `~/.claude`.
  pub claude_home: String,
  /// Claude Code's OS cache dir (`~/Library/Caches/claude-cli-nodejs` on macOS).
  pub claude_cache_dir: String,
  /// `$CODEX_HOME` or `~/.codex`.
  pub codex_home: String,
  /// OpenCode's XDG data dir — the first candidate that exists, else the default.
  pub opencode_data_dir: String,
  /// `~/.config/opencode`.
  pub opencode_config_dir: String,
  pub cc_switch_dir: String,
  pub cc_connect_dir: String,
  /// `~/.copilot` — GitHub Copilot CLI.
  pub copilot_dir: String,
  /// `~/.cursor` — Cursor CLI.
  pub cursor_dir: String,
  /// `~/.agentpack` — agentpack's own store, and where the quarantine lives.
  pub agentpack_dir: String,
}

fn home_dir() -> PathBuf {
  dirs::home_dir().unwrap_or_default()
}

/// `$CLAUDE_CONFIG_DIR` or `~/.claude`, matching what Claude Code itself honors
/// (and what `history::claude::claude_root` already reads).
pub fn claude_home(home: &Path) -> PathBuf {
  std::env::var("CLAUDE_CONFIG_DIR")
    .map(PathBuf::from)
    .unwrap_or_else(|_| home.join(".claude"))
}

/// The OS cache directory Claude Code's node CLI writes MCP logs into.
fn claude_cache_dir() -> PathBuf {
  dirs::cache_dir()
    .unwrap_or_else(|| home_dir().join(".cache"))
    .join("claude-cli-nodejs")
}

/// OpenCode data-dir candidates, most specific first.
///
/// Shared with `history::opencode` so the dir this cleans is always the dir the
/// history dashboard read from — two independent candidate lists would drift and
/// then this would clean a database nothing was ever reading.
pub fn opencode_data_candidates() -> Vec<PathBuf> {
  let home = dirs::home_dir();
  let mut candidates: Vec<PathBuf> = Vec::new();
  if let Ok(p) = std::env::var("XDG_DATA_HOME") {
    if !p.is_empty() {
      candidates.push(PathBuf::from(p).join("opencode"));
    }
  }
  if let Some(h) = &home {
    candidates.push(h.join(".local/share/opencode"));
    candidates.push(h.join(".opencode"));
  }
  if let Some(d) = dirs::data_dir() {
    candidates.push(d.join("opencode"));
  }
  if let Ok(p) = std::env::var("APPDATA") {
    candidates.push(PathBuf::from(p).join("opencode"));
  }
  if let Ok(p) = std::env::var("LOCALAPPDATA") {
    candidates.push(PathBuf::from(p).join("opencode"));
  }
  candidates
}

/// The first OpenCode data dir that exists, or the platform default. A path that
/// doesn't exist is not an error here — the scan reports `exists: false` and the
/// UI simply doesn't offer it.
fn opencode_data_dir() -> PathBuf {
  let candidates = opencode_data_candidates();
  candidates
    .iter()
    .find(|p| p.is_dir())
    .cloned()
    .or_else(|| candidates.first().cloned())
    .unwrap_or_else(|| home_dir().join(".local/share/opencode"))
}

/// `~/.agentpack` — overridable so tests never touch a developer's real store.
pub(crate) fn agentpack_dir() -> PathBuf {
  if let Ok(p) = std::env::var("AGENTPACK_HOME") {
    return PathBuf::from(p);
  }
  home_dir().join(".agentpack")
}

fn roots() -> CleanupRoots {
  let home = home_dir();
  CleanupRoots {
    claude_home: s(claude_home(&home)),
    claude_cache_dir: s(claude_cache_dir()),
    codex_home: s(crate::paths::codex_home(&home)),
    opencode_data_dir: s(opencode_data_dir()),
    opencode_config_dir: s(home.join(".config").join("opencode")),
    cc_switch_dir: s(home.join(".cc-switch")),
    cc_connect_dir: s(home.join(".cc-connect")),
    copilot_dir: s(home.join(".copilot")),
    cursor_dir: s(home.join(".cursor")),
    agentpack_dir: s(agentpack_dir()),
    home: s(home),
  }
}

fn s(p: PathBuf) -> String {
  p.to_string_lossy().into_owned()
}

/// Where the cleanup catalog may build paths. Anything outside every one of
/// these is refused, whatever the frontend asked for.
fn allowed_roots() -> Vec<PathBuf> {
  let r = roots();
  vec![
    PathBuf::from(r.claude_home),
    PathBuf::from(r.claude_cache_dir),
    PathBuf::from(r.codex_home),
    PathBuf::from(r.opencode_data_dir),
    PathBuf::from(r.opencode_config_dir),
    PathBuf::from(r.cc_switch_dir),
    PathBuf::from(r.cc_connect_dir),
    PathBuf::from(r.copilot_dir),
    PathBuf::from(r.cursor_dir),
    PathBuf::from(r.agentpack_dir),
  ]
}

/// Paths that survive every cleanup, even though they sit inside an allowed root.
///
/// Two kinds, and both have bitten someone somewhere: **credentials** (deleting
/// `auth.json` or `.credentials.json` signs the user out of a CLI they may not
/// know how to sign back into) and **live config plus installed content** —
/// `settings.json`, `config.toml`, the skills roots the Skills section manages.
/// Cleaning is supposed to reclaim disk and clear records, never to un-configure
/// the machine; anything that would is somebody else's button.
fn protected_paths() -> Vec<PathBuf> {
  let r = roots();
  let claude = PathBuf::from(&r.claude_home);
  let codex = PathBuf::from(&r.codex_home);
  vec![
    claude.join("settings.json"),
    claude.join("settings.local.json"),
    claude.join(".credentials.json"),
    claude.join("CLAUDE.md"),
    claude.join("skills"),
    claude.join("agents"),
    claude.join("commands"),
    codex.join("auth.json"),
    codex.join("config.toml"),
    codex.join("AGENTS.md"),
    codex.join("skills"),
    PathBuf::from(&r.opencode_config_dir).join("opencode.json"),
    PathBuf::from(&r.cc_switch_dir).join("cc-switch.db"),
    PathBuf::from(&r.cc_switch_dir).join("settings.json"),
    PathBuf::from(&r.cc_connect_dir).join("config.toml"),
    PathBuf::from(&r.copilot_dir).join("config.json"),
    PathBuf::from(&r.copilot_dir).join("settings.json"),
    PathBuf::from(&r.copilot_dir).join("mcp-config.json"),
    PathBuf::from(&r.cursor_dir).join("mcp.json"),
    PathBuf::from(&r.cursor_dir).join("cli-config.json"),
    // The quarantine is emptied by `cleanup_quarantine_purge`, which knows how
    // to keep its manifests consistent. Letting a generic cleanup spec walk in
    // here would strip the manifests and orphan the files they describe.
    quarantine_root(),
  ]
}

/// Whether cleanup may *look inside* `p` — i.e. whether it is a legal place for
/// a spec to point at. A root itself qualifies; that only ever means "read this
/// directory's entries", never "remove this directory".
///
/// Compared lexically, on paths already normalized by [`normalize`]. Canonicalizing
/// instead would follow symlinks — and `~/.claude/skills/<id>` is very often a
/// symlink into `~/.agents/skills`, so a canonicalizing check would silently
/// widen the reachable set to wherever those links point.
fn is_container(p: &Path) -> bool {
  if p.components().any(|c| c.as_os_str() == "..") {
    return false;
  }
  for prot in protected_paths() {
    if p == prot || p.starts_with(&prot) {
      return false;
    }
  }
  if allowed_roots().iter().any(|root| p.starts_with(root)) {
    return true;
  }
  // `~/.claude.json.backup` and the rotated `~/.claude.json.bak.<ts>` copies sit
  // directly in the home directory rather than under any agent's root, and are
  // the one thing outside the roots worth offering. The live `~/.claude.json` is
  // excluded by the trailing dot: only its *copies* match.
  let home = home_dir();
  // The home directory is a *container* so a glob can enumerate those copies —
  // and only that. It is deliberately absent from `allowed_roots`, so
  // `is_cleanable` below still refuses every one of its children that doesn't
  // match the name rule, and `select` refuses a home spec that carries no glob.
  if p == home {
    return true;
  }
  if p.parent() == Some(home.as_path()) {
    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
      return name.starts_with(".claude.json.");
    }
  }
  false
}

/// Whether `p` may actually be moved or unlinked. Everything [`is_container`]
/// allows, minus the directories that are only ever containers: the agent roots,
/// and the home directory.
fn is_cleanable(p: &Path) -> bool {
  is_container(p) && p != home_dir() && !allowed_roots().iter().any(|root| p == root)
}

fn ensure_cleanable(p: &Path) -> Result<(), String> {
  if is_cleanable(p) {
    return Ok(());
  }
  Err(format!(
    "refusing to clean a path outside the agent data directories: {}",
    p.to_string_lossy()
  ))
}

/// Lexical normalization: drop `.` components and resolve `..` against what came
/// before, without touching the filesystem. Enough to defeat a traversal in a
/// spec while leaving symlinks alone (see [`is_cleanable`]).
fn normalize(p: &Path) -> PathBuf {
  let mut out = PathBuf::new();
  for c in p.components() {
    match c {
      std::path::Component::CurDir => {}
      std::path::Component::ParentDir => {
        // Keep a leading `..` so the result stays outside every root and the
        // guardrail rejects it, rather than silently climbing to `/`.
        if !out.pop() {
          out.push("..");
        }
      }
      other => out.push(other.as_os_str()),
    }
  }
  out
}

// ── Specs and results ───────────────────────────────────────────────────────

/// One path a cleanup target covers. A target (a row in the UI) is one or more
/// of these sharing an `id`; the frontend groups the results back by it.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSpec {
  /// Catalog id from `lib/agentpack/cleanup.ts`, echoed back untouched.
  pub id: String,
  /// Absolute path. Re-validated here; never trusted.
  pub path: String,
  /// When set, `path` must be a directory and only its direct children whose
  /// file name matches are selected. `*` is the only wildcard — enough for the
  /// version-stamped databases Codex writes (`logs_2.sqlite`, `state_5.sqlite`)
  /// whose numbers change between releases.
  #[serde(default)]
  pub glob: Option<String>,
  /// Select only files last modified more than this many days ago. This is what
  /// makes "keep the last 30 days of chats" possible; without it a chat-record
  /// target is all-or-nothing.
  #[serde(default)]
  pub older_than_days: Option<u32>,
}

/// What one spec currently matches on disk.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupStat {
  pub id: String,
  pub path: String,
  /// False when the path isn't there at all — the UI hides the row entirely
  /// rather than offering to clean nothing.
  pub exists: bool,
  pub bytes: u64,
  pub files: u64,
  /// Newest selected file's mtime, epoch ms. 0 when nothing matched.
  pub newest_ms: i64,
  /// Oldest selected file's mtime, epoch ms. 0 when nothing matched. Together
  /// with `newest_ms` this is what lets the UI say "spanning 8 months".
  pub oldest_ms: i64,
  /// Something under this path could not be read. The size is then a floor, not
  /// a total — the UI has to say so rather than quote a number it knows is low.
  pub degraded: bool,
}

/// Whether a removal is reversible.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CleanupMode {
  /// Move into `~/.agentpack/trash/<batch>/` — instant, and undoable until purged.
  Quarantine,
  /// Unlink outright. Frees the space immediately and cannot be undone.
  Delete,
}

/// What a cleanup run actually did.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOutcome {
  /// The quarantine batch this run created, when `mode` was `quarantine`. This
  /// is the run's restore point, and the runner records it as the step artifact.
  pub quarantine_id: Option<String>,
  /// Bytes that left the agent directories. Under `quarantine` they are still on
  /// disk — moved, not freed — which is what `mode` tells the UI to say.
  pub bytes: u64,
  /// How many filesystem entries were moved or unlinked.
  pub removed: u64,
  /// Per-path failures. A run reports what it could not do instead of failing
  /// wholesale: one locked file must not abandon the other twelve gigabytes.
  pub errors: Vec<String>,
}

// ── Scanning ────────────────────────────────────────────────────────────────

fn mtime_ms(md: &fs::Metadata) -> i64 {
  md.modified()
    .ok()
    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

/// Match a file name against a `*`-only pattern, anchored at both ends.
pub(crate) fn glob_match(pattern: &str, name: &str) -> bool {
  let parts: Vec<&str> = pattern.split('*').collect();
  if parts.len() == 1 {
    return pattern == name;
  }
  let mut rest = name;
  // The segment before the first `*` must be a prefix…
  if let Some(first) = parts.first() {
    match rest.strip_prefix(first) {
      Some(r) => rest = r,
      None => return false,
    }
  }
  // …the one after the last `*` a suffix…
  if let Some(last) = parts.last() {
    if parts.len() > 1 {
      if rest.len() < last.len() || !rest.ends_with(last) {
        return false;
      }
      rest = &rest[..rest.len() - last.len()];
    }
  }
  // …and everything between appears in order.
  for mid in &parts[1..parts.len().saturating_sub(1)] {
    if mid.is_empty() {
      continue;
    }
    match rest.find(mid) {
      Some(i) => rest = &rest[i + mid.len()..],
      None => return false,
    }
  }
  true
}

/// A directory's direct children, or the empty list when it can't be read.
/// Returns `degraded` so an unreadable directory reports as "couldn't read",
/// never as "nothing here".
fn children(dir: &Path) -> (Vec<PathBuf>, bool) {
  match fs::read_dir(dir) {
    Ok(rd) => {
      let mut out = Vec::new();
      let mut degraded = false;
      for entry in rd {
        match entry {
          Ok(e) => out.push(e.path()),
          Err(_) => degraded = true,
        }
      }
      out.sort();
      (out, degraded)
    }
    Err(_) => (Vec::new(), true),
  }
}

#[derive(Default)]
struct Tally {
  bytes: u64,
  files: u64,
  newest_ms: i64,
  oldest_ms: i64,
  degraded: bool,
}

impl Tally {
  fn note(&mut self, bytes: u64, mtime: i64) {
    self.bytes += bytes;
    self.files += 1;
    if mtime > self.newest_ms {
      self.newest_ms = mtime;
    }
    if self.oldest_ms == 0 || (mtime > 0 && mtime < self.oldest_ms) {
      self.oldest_ms = mtime;
    }
  }
}

/// Walk `p`, adding every regular file to `tally`. Symlinks are counted as the
/// link itself and never followed — a skills symlink into `~/.agents/skills`
/// must not make a cleanup preview claim the shared copy's bytes.
fn walk(p: &Path, tally: &mut Tally) {
  let Ok(md) = fs::symlink_metadata(p) else {
    tally.degraded = true;
    return;
  };
  if md.file_type().is_symlink() {
    tally.note(0, mtime_ms(&md));
    return;
  }
  if md.is_file() {
    tally.note(md.len(), mtime_ms(&md));
    return;
  }
  if md.is_dir() {
    let (kids, degraded) = children(p);
    tally.degraded |= degraded;
    for kid in kids {
      walk(&kid, tally);
    }
  }
}

/// Collect the files under `p` last modified before `cutoff_ms`.
fn walk_older_than(p: &Path, cutoff_ms: i64, out: &mut Vec<PathBuf>, tally: &mut Tally) {
  let Ok(md) = fs::symlink_metadata(p) else {
    tally.degraded = true;
    return;
  };
  if md.is_dir() && !md.file_type().is_symlink() {
    let (kids, degraded) = children(p);
    tally.degraded |= degraded;
    for kid in kids {
      walk_older_than(&kid, cutoff_ms, out, tally);
    }
    return;
  }
  let mtime = mtime_ms(&md);
  if mtime < cutoff_ms {
    let bytes = if md.file_type().is_symlink() {
      0
    } else {
      md.len()
    };
    tally.note(bytes, mtime);
    out.push(p.to_path_buf());
  }
}

/// The entries a spec selects, plus what they weigh.
///
/// The unit of removal depends on the spec, and the difference matters for speed:
/// with no age filter a whole child directory is one rename; with one, each
/// matching *file* is its own unit and the emptied directories are pruned after.
struct Selection {
  /// Paths to move or unlink, deepest-last (so pruning works bottom-up).
  units: Vec<PathBuf>,
  tally: Tally,
  exists: bool,
  /// Directories to prune if the removal empties them (age-filtered runs only).
  prune_under: Option<PathBuf>,
}

fn select(spec: &CleanupSpec) -> Result<Selection, String> {
  let path = normalize(Path::new(&spec.path));
  if !is_container(&path) {
    return Err(format!(
      "refusing to clean a path outside the agent data directories: {}",
      path.to_string_lossy()
    ));
  }
  // A spec may point *at* a root — that is how the version-stamped Codex
  // databases and the loose `~/.claude.json.*` copies are reachable — but only
  // with a glob to narrow it. Without one it would mean "sweep this whole
  // directory", which no catalog entry wants and no accident should be able to
  // express. The home directory is included for the obvious reason.
  if spec.glob.is_none() && (path == home_dir() || allowed_roots().contains(&path)) {
    return Err(format!(
      "refusing to sweep a whole agent data directory: {}",
      path.to_string_lossy()
    ));
  }

  let Ok(md) = fs::symlink_metadata(&path) else {
    return Ok(Selection {
      units: Vec::new(),
      tally: Tally::default(),
      exists: false,
      prune_under: None,
    });
  };

  // Roots of the selection: what the spec points at, before any age filter.
  let is_dir = md.is_dir() && !md.file_type().is_symlink();
  let mut roots: Vec<PathBuf> = if let Some(pattern) = &spec.glob {
    if !is_dir {
      return Err(format!("{} is not a directory", path.to_string_lossy()));
    }
    let (kids, _) = children(&path);
    kids
      .into_iter()
      .filter(|k| {
        k.file_name()
          .and_then(|n| n.to_str())
          .is_some_and(|n| glob_match(pattern, n))
      })
      .collect()
  } else if is_dir {
    // Rule 2: the directory a target names is preserved; its entries are what go.
    children(&path).0
  } else {
    vec![path.clone()]
  };
  // A crafted spec cannot smuggle a protected sibling in through a glob.
  roots.retain(|r| is_cleanable(r));

  let mut tally = Tally::default();
  let cutoff = spec
    .older_than_days
    .filter(|d| *d > 0)
    .map(|d| now_ms() - (d as i64) * 86_400_000);

  let units = match cutoff {
    None => {
      for r in &roots {
        walk(r, &mut tally);
      }
      roots
    }
    Some(cutoff_ms) => {
      let mut files = Vec::new();
      for r in &roots {
        walk_older_than(r, cutoff_ms, &mut files, &mut tally);
      }
      files
    }
  };

  Ok(Selection {
    units,
    tally,
    exists: true,
    prune_under: cutoff.map(|_| path),
  })
}

/// Measure what each spec currently matches. Read-only: nothing here writes,
/// renames or unlinks, so the UI can scan freely and the review panel can show
/// real numbers before the user commits to anything.
#[tauri::command(async)]
pub fn cleanup_scan(specs: Vec<CleanupSpec>) -> Result<Vec<CleanupStat>, String> {
  let mut out = Vec::with_capacity(specs.len());
  for spec in &specs {
    let stat = match select(spec) {
      Ok(sel) => CleanupStat {
        id: spec.id.clone(),
        path: spec.path.clone(),
        exists: sel.exists,
        bytes: sel.tally.bytes,
        files: sel.tally.files,
        newest_ms: sel.tally.newest_ms,
        oldest_ms: sel.tally.oldest_ms,
        degraded: sel.tally.degraded,
      },
      // A refused or unreadable spec is reported as an empty, degraded row
      // rather than failing the whole scan: one bad entry must not blank the
      // other twenty the user was about to act on.
      Err(_) => CleanupStat {
        id: spec.id.clone(),
        path: spec.path.clone(),
        exists: false,
        bytes: 0,
        files: 0,
        newest_ms: 0,
        oldest_ms: 0,
        degraded: true,
      },
    };
    out.push(stat);
  }
  Ok(out)
}

/// The roots the cleanup catalog builds its paths from.
#[tauri::command(async)]
pub fn cleanup_roots() -> Result<CleanupRoots, String> {
  Ok(roots())
}

// ── Quarantine ──────────────────────────────────────────────────────────────

/// One quarantined entry: where it came from, and what it's stored as.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct QuarantineItem {
  original_path: String,
  /// Flat, index-derived name. Original names collide constantly (every Codex
  /// session directory holds a `rollout.jsonl`), and a name derived from the
  /// full path would blow past the filesystem's component limit.
  stored_name: String,
  bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct QuarantineManifest {
  id: String,
  ts: u128,
  bytes: u64,
  target_ids: Vec<String>,
  items: Vec<QuarantineItem>,
}

/// A quarantine batch as the UI lists it — counts, not the item table. A batch
/// can hold tens of thousands of files and none of them belong on screen.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineEntry {
  pub id: String,
  pub ts: u128,
  pub bytes: u64,
  pub items: usize,
  /// Catalog ids this batch came from, so the UI can name it in the user's language.
  pub target_ids: Vec<String>,
}

fn quarantine_root() -> PathBuf {
  agentpack_dir().join("trash")
}

fn now_millis() -> u128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
}

fn now_nanos() -> u128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos()
}

/// Move `src` to `dest`, falling back to copy-then-remove across filesystems.
///
/// `rename` is what makes quarantining gigabytes instant, but it only works
/// within one filesystem — and `$CODEX_HOME` can point at another volume
/// entirely. Without the fallback that user's cleanup would fail with a bare
/// `EXDEV` and no explanation.
fn move_path(src: &Path, dest: &Path) -> Result<(), String> {
  if let Some(parent) = dest.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  if fs::rename(src, dest).is_ok() {
    return Ok(());
  }
  let md = fs::symlink_metadata(src).map_err(|e| e.to_string())?;
  if md.is_dir() && !md.file_type().is_symlink() {
    copy_dir(src, dest)?;
    fs::remove_dir_all(src).map_err(|e| e.to_string())
  } else {
    fs::copy(src, dest).map_err(|e| e.to_string())?;
    fs::remove_file(src).map_err(|e| e.to_string())
  }
}

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
  fs::create_dir_all(dest).map_err(|e| e.to_string())?;
  for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let to = dest.join(entry.file_name());
    let md = entry.metadata().map_err(|e| e.to_string())?;
    if md.is_dir() {
      copy_dir(&entry.path(), &to)?;
    } else {
      fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

/// Remove `p` whether it's a file, a symlink or a directory. Symlinks are
/// removed as links, never traversed.
fn remove_path(p: &Path) -> Result<(), String> {
  let md = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
  if md.file_type().is_symlink() {
    #[cfg(windows)]
    return fs::remove_dir(p)
      .or_else(|_| fs::remove_file(p))
      .map_err(|e| e.to_string());
    #[cfg(not(windows))]
    return fs::remove_file(p).map_err(|e| e.to_string());
  }
  if md.is_dir() {
    return fs::remove_dir_all(p).map_err(|e| e.to_string());
  }
  fs::remove_file(p).map_err(|e| e.to_string())
}

/// Delete directories left empty by an age-filtered run, bottom-up, stopping at
/// `root` itself (rule 2: the directory a target names always survives).
fn prune_empty_dirs(root: &Path) {
  fn visit(p: &Path, root: &Path) {
    let Ok(md) = fs::symlink_metadata(p) else {
      return;
    };
    if !md.is_dir() || md.file_type().is_symlink() {
      return;
    }
    for kid in children(p).0 {
      visit(&kid, root);
    }
    let empty = fs::read_dir(p)
      .map(|mut d| d.next().is_none())
      .unwrap_or(false);
    if p != root && empty {
      let _ = fs::remove_dir(p);
    }
  }
  visit(root, root);
}

/// Clean everything the specs select.
///
/// Never fails wholesale: a unit that won't move is recorded in `errors` and the
/// run continues. A cleanup that abandons twelve gigabytes because one file was
/// locked by a running CLI is worse than one that says which file it skipped.
#[tauri::command(async)]
pub fn cleanup_apply(specs: Vec<CleanupSpec>, mode: CleanupMode) -> Result<CleanupOutcome, String> {
  let mut errors: Vec<String> = Vec::new();
  let mut items: Vec<QuarantineItem> = Vec::new();
  let mut target_ids: Vec<String> = Vec::new();
  let mut bytes: u64 = 0;
  let mut removed: u64 = 0;
  let mut prune_roots: Vec<PathBuf> = Vec::new();

  let batch_id = format!("trash-{}", now_nanos());
  let batch_dir = quarantine_root().join(&batch_id);
  let items_dir = batch_dir.join("items");

  for spec in &specs {
    let sel = match select(spec) {
      Ok(sel) => sel,
      Err(e) => {
        errors.push(e);
        continue;
      }
    };
    if !sel.exists || sel.units.is_empty() {
      continue;
    }
    if !target_ids.contains(&spec.id) {
      target_ids.push(spec.id.clone());
    }
    if let Some(root) = sel.prune_under {
      if !prune_roots.contains(&root) {
        prune_roots.push(root);
      }
    }

    for unit in sel.units {
      // Re-check immediately before touching it: `select` validated the spec's
      // root, and this validates every individual unit it expanded to.
      if ensure_cleanable(&unit).is_err() {
        continue;
      }
      let mut unit_tally = Tally::default();
      walk(&unit, &mut unit_tally);

      let result = match mode {
        CleanupMode::Delete => remove_path(&unit),
        CleanupMode::Quarantine => {
          let stored = format!("{}", items.len());
          let dest = items_dir.join(&stored);
          move_path(&unit, &dest).map(|()| {
            items.push(QuarantineItem {
              original_path: unit.to_string_lossy().into_owned(),
              stored_name: stored,
              bytes: unit_tally.bytes,
            });
          })
        }
      };
      match result {
        Ok(()) => {
          bytes += unit_tally.bytes;
          removed += 1;
        }
        Err(e) => errors.push(format!("{}: {e}", unit.to_string_lossy())),
      }
    }
  }

  for root in &prune_roots {
    prune_empty_dirs(root);
  }

  let quarantine_id = if mode == CleanupMode::Quarantine && !items.is_empty() {
    let manifest = QuarantineManifest {
      id: batch_id.clone(),
      ts: now_millis(),
      bytes,
      target_ids: target_ids.clone(),
      items,
    };
    let json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    fs::create_dir_all(&batch_dir).map_err(|e| e.to_string())?;
    // Written last: a batch directory without a readable manifest is invisible
    // to `cleanup_quarantine_list`, so writing it first would make a crash
    // mid-move present a half-batch as restorable.
    fs::write(batch_dir.join("manifest.json"), json).map_err(|e| e.to_string())?;
    Some(batch_id)
  } else {
    None
  };

  Ok(CleanupOutcome {
    quarantine_id,
    bytes,
    removed,
    errors,
  })
}

fn read_manifest(dir: &Path) -> Option<QuarantineManifest> {
  let text = fs::read_to_string(dir.join("manifest.json")).ok()?;
  serde_json::from_str(&text).ok()
}

/// Every quarantine batch, newest first.
#[tauri::command(async)]
pub fn cleanup_quarantine_list() -> Result<Vec<QuarantineEntry>, String> {
  let root = quarantine_root();
  if !root.is_dir() {
    return Ok(Vec::new());
  }
  let mut out = Vec::new();
  for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
    let Ok(entry) = entry else { continue };
    let Some(m) = read_manifest(&entry.path()) else {
      continue;
    };
    out.push(QuarantineEntry {
      id: m.id,
      ts: m.ts,
      bytes: m.bytes,
      items: m.items.len(),
      target_ids: m.target_ids,
    });
  }
  out.sort_by_key(|e| std::cmp::Reverse(e.ts));
  Ok(out)
}

/// What a restore put back, and what it could not.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineRestore {
  pub restored: u64,
  pub bytes: u64,
  /// Items left in quarantine, with the reason. The batch directory survives
  /// whenever this is non-empty, so a partial restore is retryable rather than
  /// leaving files stranded under a manifest that has been deleted.
  pub errors: Vec<String>,
}

/// Put a quarantined batch back where it came from.
///
/// An item whose original path is occupied again is **skipped, not overwritten**:
/// the CLI has written something new there since the cleanup, and that new file
/// is the one the user has been working with.
#[tauri::command(async)]
pub fn cleanup_quarantine_restore(id: String) -> Result<QuarantineRestore, String> {
  let dir = quarantine_root().join(&id);
  if !dir.starts_with(quarantine_root()) || id.contains("..") || id.contains('/') {
    return Err("invalid quarantine id".into());
  }
  let manifest = read_manifest(&dir).ok_or("quarantine batch not found")?;

  let mut restored = 0u64;
  let mut bytes = 0u64;
  let mut errors = Vec::new();
  for item in &manifest.items {
    let dest = PathBuf::from(&item.original_path);
    let src = dir.join("items").join(&item.stored_name);
    if fs::symlink_metadata(&dest).is_ok() {
      errors.push(format!("{} already exists again", item.original_path));
      continue;
    }
    if ensure_cleanable(&dest).is_err() {
      errors.push(format!(
        "{} is no longer a restorable path",
        item.original_path
      ));
      continue;
    }
    match move_path(&src, &dest) {
      Ok(()) => {
        restored += 1;
        bytes += item.bytes;
      }
      Err(e) => errors.push(format!("{}: {e}", item.original_path)),
    }
  }
  if errors.is_empty() {
    let _ = fs::remove_dir_all(&dir);
  }
  Ok(QuarantineRestore {
    restored,
    bytes,
    errors,
  })
}

/// The payload size of a quarantine batch — what the UI listed for it, and so
/// what a purge should report reclaiming. Deliberately not a `walk` of the batch
/// directory: that would add the manifest's own few hundred bytes and make
/// "reclaimed 6 B" read as "reclaimed 403 B" for a batch the user was told held
/// 6 B. Falls back to measuring when the manifest can't be read.
fn batch_bytes(dir: &Path) -> u64 {
  if let Some(m) = read_manifest(dir) {
    return m.bytes;
  }
  let mut tally = Tally::default();
  walk(dir, &mut tally);
  tally.bytes
}

/// Permanently delete one quarantine batch, or every batch when `id` is absent.
/// This is the only place cleanup destroys anything irreversibly, and it is
/// always a separate, explicit action — never a step in a cleanup run.
#[tauri::command(async)]
pub fn cleanup_quarantine_purge(id: Option<String>) -> Result<u64, String> {
  let root = quarantine_root();
  if !root.is_dir() {
    return Ok(0);
  }
  let mut freed = 0u64;
  match id {
    Some(id) => {
      if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("invalid quarantine id".into());
      }
      let dir = root.join(&id);
      let bytes = batch_bytes(&dir);
      fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
      freed += bytes;
    }
    None => {
      for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let bytes = batch_bytes(&entry.path());
        if fs::remove_dir_all(entry.path()).is_ok() {
          freed += bytes;
        }
      }
    }
  }
  Ok(freed)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A scratch `~/.agentpack` + fake agent roots, wired through the env vars the
  /// resolvers honour so nothing here can reach a developer's real home.
  struct Sandbox {
    dir: PathBuf,
  }

  impl Sandbox {
    fn new(name: &str) -> Sandbox {
      let dir = std::env::temp_dir().join(format!("apcleanup-{name}-{}", now_nanos()));
      fs::create_dir_all(&dir).unwrap();
      std::env::set_var("AGENTPACK_HOME", dir.join("agentpack"));
      std::env::set_var("CLAUDE_CONFIG_DIR", dir.join("claude"));
      std::env::set_var("CODEX_HOME", dir.join("codex"));
      fs::create_dir_all(dir.join("claude")).unwrap();
      fs::create_dir_all(dir.join("codex")).unwrap();
      Sandbox { dir }
    }
    fn claude(&self) -> PathBuf {
      self.dir.join("claude")
    }
    fn codex(&self) -> PathBuf {
      self.dir.join("codex")
    }
  }

  impl Drop for Sandbox {
    fn drop(&mut self) {
      std::env::remove_var("AGENTPACK_HOME");
      std::env::remove_var("CLAUDE_CONFIG_DIR");
      std::env::remove_var("CODEX_HOME");
      let _ = fs::remove_dir_all(&self.dir);
    }
  }

  fn write(p: &Path, body: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
  }

  fn spec(id: &str, path: &Path) -> CleanupSpec {
    CleanupSpec {
      id: id.into(),
      path: path.to_string_lossy().into_owned(),
      glob: None,
      older_than_days: None,
    }
  }

  #[test]
  fn glob_matches_only_what_it_should() {
    assert!(glob_match("logs_*.sqlite*", "logs_2.sqlite"));
    assert!(glob_match("logs_*.sqlite*", "logs_2.sqlite-wal"));
    assert!(glob_match("logs_*.sqlite*", "logs_12.sqlite-shm"));
    assert!(!glob_match("logs_*.sqlite*", "state_5.sqlite"));
    assert!(!glob_match("logs_*.sqlite*", "logs.txt"));
    assert!(glob_match("*.tmp", "a.tmp"));
    assert!(!glob_match("*.tmp", "a.tmpx"));
    assert!(glob_match("exact", "exact"));
    assert!(!glob_match("exact", "exactly"));
    // A bare `*` matches anything, including the empty name.
    assert!(glob_match("*", "whatever"));
  }

  /// The single most important property in this module: a spec cannot reach a
  /// credential, a live config, or anywhere outside the agent data directories.
  #[test]
  fn guardrail_refuses_credentials_config_and_escapes() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("guard");

    for denied in [
      sb.codex().join("auth.json"),
      sb.codex().join("config.toml"),
      sb.codex().join("skills"),
      sb.codex().join("skills").join("some-skill"),
      sb.claude().join("settings.json"),
      sb.claude().join(".credentials.json"),
      sb.claude().join("CLAUDE.md"),
      sb.claude().join("skills").join("caveman"),
      // The roots themselves are never removable — only what is inside them.
      sb.claude(),
      sb.codex(),
      // Traversal out of a root.
      sb.claude().join("..").join("..").join("etc"),
      PathBuf::from("/etc/passwd"),
    ] {
      assert!(
        !is_cleanable(&normalize(&denied)),
        "must refuse {}",
        denied.to_string_lossy()
      );
    }

    for allowed in [
      sb.claude().join("projects"),
      sb.claude().join("shell-snapshots"),
      sb.codex().join("sessions"),
      sb.codex().join("logs_2.sqlite"),
    ] {
      assert!(
        is_cleanable(&normalize(&allowed)),
        "must allow {}",
        allowed.to_string_lossy()
      );
    }
  }

  /// Rule 2 in the module docs. Cleaning `plugins/cache` must not be able to
  /// take `installed_plugins.json` with it, and cleaning a directory leaves the
  /// directory itself in place for the CLI to find.
  #[test]
  fn a_directory_target_keeps_the_directory_and_takes_its_entries() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("dir");
    let plugins = sb.claude().join("plugins");
    write(&plugins.join("installed_plugins.json"), "{}");
    write(&plugins.join("cache").join("a").join("blob"), "0123456789");
    write(&plugins.join("cache").join("b"), "xyz");

    let out = cleanup_apply(
      vec![spec("plugins-cache", &plugins.join("cache"))],
      CleanupMode::Delete,
    )
    .unwrap();

    assert_eq!(out.removed, 2, "both children of cache/ went");
    assert_eq!(out.bytes, 13);
    assert!(out.errors.is_empty(), "{:?}", out.errors);
    assert!(plugins.join("cache").is_dir(), "the cache dir itself stays");
    assert!(
      plugins.join("installed_plugins.json").exists(),
      "a sibling of the target is never touched"
    );
  }

  /// "Keep the last N days" is the whole reason chat records are cleanable at
  /// all — an all-or-nothing button on a year of transcripts is one nobody presses.
  #[test]
  fn an_age_filter_selects_only_old_files_and_prunes_what_it_empties() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("age");
    let projects = sb.claude().join("projects");
    let old = projects.join("proj-a").join("old.jsonl");
    let fresh = projects.join("proj-b").join("fresh.jsonl");
    write(&old, "old");
    write(&fresh, "fresh");

    // Backdate the whole of proj-a by 60 days.
    let sixty_days_ago = SystemTime::now() - std::time::Duration::from_secs(60 * 86_400);
    let ft = fs::FileTimes::new().set_modified(sixty_days_ago);
    fs::File::options()
      .write(true)
      .open(&old)
      .unwrap()
      .set_times(ft)
      .unwrap();

    let aged = CleanupSpec {
      older_than_days: Some(30),
      ..spec("claude-chats", &projects)
    };

    let stat = &cleanup_scan(vec![aged.clone()]).unwrap()[0];
    assert_eq!(stat.files, 1, "only the backdated file is selected");
    assert_eq!(stat.bytes, 3);

    let out = cleanup_apply(vec![aged], CleanupMode::Delete).unwrap();
    assert_eq!(out.removed, 1);
    assert!(!old.exists(), "the old transcript went");
    assert!(fresh.exists(), "the recent one stayed");
    assert!(
      !projects.join("proj-a").exists(),
      "the directory it emptied was pruned"
    );
    assert!(projects.is_dir(), "the target directory itself survives");
  }

  /// Quarantine is what makes the default safe: the bytes leave the agent's
  /// directory, and a restore puts every one of them back.
  #[test]
  fn quarantine_round_trips_and_purge_is_the_only_permanent_step() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("quar");
    let sessions = sb.codex().join("sessions");
    write(&sessions.join("s1").join("rollout.jsonl"), "aaaa");
    write(&sessions.join("s2").join("rollout.jsonl"), "bb");

    let out = cleanup_apply(
      vec![spec("codex-chats", &sessions)],
      CleanupMode::Quarantine,
    )
    .unwrap();
    let batch = out.quarantine_id.clone().expect("a batch was created");
    assert_eq!(out.bytes, 6);
    assert_eq!(out.removed, 2);
    assert!(!sessions.join("s1").exists());

    let listed = cleanup_quarantine_list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, batch);
    assert_eq!(listed[0].items, 2);
    assert_eq!(listed[0].target_ids, vec!["codex-chats".to_string()]);

    let restored = cleanup_quarantine_restore(batch.clone()).unwrap();
    assert_eq!(restored.restored, 2);
    assert!(restored.errors.is_empty(), "{:?}", restored.errors);
    assert_eq!(
      fs::read_to_string(sessions.join("s1").join("rollout.jsonl")).unwrap(),
      "aaaa"
    );
    // A fully restored batch stops being listed.
    assert!(cleanup_quarantine_list().unwrap().is_empty());

    // Round two: quarantine again, then purge — that one is permanent.
    let out = cleanup_apply(
      vec![spec("codex-chats", &sessions)],
      CleanupMode::Quarantine,
    )
    .unwrap();
    let batch = out.quarantine_id.unwrap();
    let freed = cleanup_quarantine_purge(Some(batch)).unwrap();
    assert_eq!(freed, 6);
    assert!(cleanup_quarantine_list().unwrap().is_empty());
    assert!(!sessions.join("s1").exists());
  }

  /// A restore must not clobber work the CLI has done since the cleanup.
  #[test]
  fn restore_skips_a_path_the_cli_has_since_written_again() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("reoccupied");
    let snaps = sb.claude().join("shell-snapshots");
    write(&snaps.join("a.sh"), "old");

    let out = cleanup_apply(vec![spec("claude-shell", &snaps)], CleanupMode::Quarantine).unwrap();
    let batch = out.quarantine_id.unwrap();

    write(&snaps.join("a.sh"), "NEW");
    let restored = cleanup_quarantine_restore(batch.clone()).unwrap();
    assert_eq!(restored.restored, 0);
    assert_eq!(restored.errors.len(), 1);
    assert_eq!(
      fs::read_to_string(snaps.join("a.sh")).unwrap(),
      "NEW",
      "the newer file wins"
    );
    // Nothing was lost: the batch is still listed and still restorable.
    assert_eq!(cleanup_quarantine_list().unwrap().len(), 1);
  }

  /// An unreadable or refused spec reports as degraded, never as "nothing here" —
  /// the same honesty rule the dashboard scan follows.
  #[test]
  fn a_refused_spec_degrades_rather_than_failing_the_whole_scan() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("degraded");
    write(&sb.claude().join("telemetry").join("e.json"), "12345");

    let stats = cleanup_scan(vec![
      spec("nope", &sb.codex().join("auth.json")),
      spec("claude-telemetry", &sb.claude().join("telemetry")),
    ])
    .unwrap();

    assert_eq!(stats.len(), 2);
    assert!(stats[0].degraded && !stats[0].exists);
    assert_eq!(stats[0].bytes, 0);
    assert!(!stats[1].degraded);
    assert_eq!(stats[1].bytes, 5);
    assert_eq!(stats[1].files, 1);
  }

  /// A glob is how the version-stamped Codex databases are reachable at all —
  /// and it must not become a way to name a protected sibling.
  #[test]
  fn a_glob_selects_versioned_siblings_but_not_protected_ones() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("glob");
    write(&sb.codex().join("logs_2.sqlite"), "aaaa");
    write(&sb.codex().join("logs_2.sqlite-wal"), "bb");
    write(&sb.codex().join("auth.json"), "SECRET");
    write(&sb.codex().join("config.toml"), "keep");

    let logs = CleanupSpec {
      glob: Some("logs_*.sqlite*".into()),
      ..spec("codex-logs", &sb.codex())
    };
    let stat = &cleanup_scan(vec![logs.clone()]).unwrap()[0];
    assert_eq!(stat.files, 2);
    assert_eq!(stat.bytes, 6);

    // Even a spec that globs everything in the Codex home leaves the two
    // protected files behind.
    let everything = CleanupSpec {
      glob: Some("*".into()),
      ..spec("codex-everything", &sb.codex())
    };
    cleanup_apply(vec![everything], CleanupMode::Delete).unwrap();
    assert_eq!(
      fs::read_to_string(sb.codex().join("auth.json")).unwrap(),
      "SECRET"
    );
    assert_eq!(
      fs::read_to_string(sb.codex().join("config.toml")).unwrap(),
      "keep"
    );
  }

  /// Pointing a spec at a whole agent data directory with no glob is the one
  /// mistake that would be catastrophic and looks entirely reasonable in a diff.
  #[test]
  fn a_root_without_a_glob_is_refused_outright() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let sb = Sandbox::new("wholeroot");
    write(
      &sb.codex().join("sessions").join("s1").join("r.jsonl"),
      "aaaa",
    );

    let out = cleanup_apply(vec![spec("oops", &sb.codex())], CleanupMode::Delete).unwrap();
    assert_eq!(out.removed, 0);
    assert_eq!(out.errors.len(), 1);
    assert!(
      out.errors[0].contains("whole agent data directory"),
      "{:?}",
      out.errors
    );
    assert!(sb
      .codex()
      .join("sessions")
      .join("s1")
      .join("r.jsonl")
      .exists());
  }

  /// The rotated `~/.claude.json.*` copies are the one thing worth cleaning that
  /// lives loose in the home directory rather than under any agent root — which
  /// made the home directory the one container the guardrail forgot, so that
  /// target silently scanned as "refused" on every real machine.
  ///
  /// Both halves matter: the glob has to reach the copies, and the home
  /// directory must stay unreachable for anything else. Uses the real home
  /// because that is what `is_container` compares against; it only ever reads.
  #[test]
  fn the_home_directory_is_a_container_for_the_claude_json_copies_and_nothing_else() {
    let _lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let home = home_dir();

    assert!(is_container(&home), "a glob must be able to enumerate it");
    assert!(!is_cleanable(&home), "but it is never itself removable");
    assert!(is_cleanable(&home.join(".claude.json.backup")));
    assert!(is_cleanable(&home.join(".claude.json.bak.1781784389")));
    // The live file is excluded by the trailing dot: only its copies match.
    assert!(!is_cleanable(&home.join(".claude.json")));
    // And nothing else in the home directory is reachable, so even a `*` glob
    // over it selects only the copies.
    for other in [".zshrc", "Documents", ".ssh", ".gitconfig"] {
      assert!(!is_cleanable(&home.join(other)), "must refuse {other}");
    }

    // A home spec with no glob is refused outright rather than sweeping.
    let bare = CleanupSpec {
      id: "home".into(),
      path: home.to_string_lossy().into_owned(),
      glob: None,
      older_than_days: None,
    };
    assert!(select(&bare).is_err());
  }
}
