//! Skills discovery and copy-based installation across agent CLIs.
//!
//! Four global roots are scanned (the same list backs the delete guardrail in
//! `fsops::skills_roots`):
//!   - claude   `~/.claude/skills`            (may contain symlinks from skills.sh)
//!   - codex    `<codexHome>/skills`          (hidden `.system` dir is skipped)
//!   - opencode `~/.config/opencode/skills`   (XDG-style even on Windows)
//!   - agents   `~/.agents/skills`            (shared canonical dir; OpenCode reads it)
//!
//! Scanning mirrors `history.rs`: a missing root is an empty result, real read
//! errors are collected per source instead of failing the whole scan. SKILL.md
//! content ships inline (capped) so the list and the detail viewer need one IPC
//! round trip; frontmatter is parsed in TS where it is unit-testable.

use crate::paths::codex_home;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Cap on how much of a SKILL.md is shipped to the webview. Real skills are a
/// few KiB; anything past this renders truncated rather than ballooning IPC.
const MAX_SKILL_MD_BYTES: u64 = 256 * 1024;

/// The canonical (source, root) list. `fsops::skills_roots` derives its delete
/// whitelist from this, so scanner and guardrail can never disagree.
pub(crate) fn source_roots(home: &Path) -> [(&'static str, PathBuf); 4] {
  let opencode = home.join(".config").join("opencode");
  [
    ("claude", home.join(".claude").join("skills")),
    ("codex", codex_home(home).join("skills")),
    ("opencode", opencode.join("skills")),
    ("agents", home.join(".agents").join("skills")),
  ]
}

/// Root a skill installs into for a given target name. Shared with
/// `fsops::install_skill` so bundled-skill installs resolve the same four roots.
pub(crate) fn target_root(home: &Path, target: &str) -> Option<PathBuf> {
  source_roots(home)
    .into_iter()
    .find(|(source, _)| *source == target)
    .map(|(_, root)| root)
}

/// Where an installed skill came from: which repo/ref it was fetched from, and
/// the content hash it had at that point (for update detection). Persisted
/// alongside the skill as `.agentpack-origin.json`; absent for skills that
/// were hand-authored or copied in some other way.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillOrigin {
  pub repo: String,
  #[serde(rename = "ref")]
  pub git_ref: String,
  /// Path relative to the repo root ("" when the repo root itself is the skill).
  pub rel_path: String,
  pub content_hash: String,
  pub installed_at: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
  source: String,
  dir_name: String,
  path: String,
  is_symlink: bool,
  link_target: Option<String>,
  skill_md: String,
  /// Epoch ms of SKILL.md's mtime; 0 when unavailable.
  modified_at: i64,
  origin: Option<SkillOrigin>,
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as i64
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanError {
  source: String,
  message: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillsScanResult {
  skills: Vec<InstalledSkill>,
  errors: Vec<ScanError>,
}

/// Read up to `cap` bytes of a file as (lossy) UTF-8. A hard `take` could split
/// a multi-byte character, so decode bytes lossily instead of `read_to_string`.
fn read_text_capped(path: &Path, cap: u64) -> std::io::Result<String> {
  let file = fs::File::open(path)?;
  let mut bytes = Vec::new();
  file.take(cap).read_to_end(&mut bytes)?;
  Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn epoch_ms(meta: std::io::Result<fs::Metadata>) -> i64 {
  meta
    .and_then(|m| m.modified())
    .ok()
    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Origin tracking: a `.agentpack-origin.json` sidecar records which repo/ref a
// skill was fetched from and a content hash of it at install time, so a later
// scan can offer "check for updates" without re-downloading anything.
// ---------------------------------------------------------------------------

const ORIGIN_MANIFEST_NAME: &str = ".agentpack-origin.json";
/// How deep `hash_skill_dir`/`list_skill_files` walk below a skill root.
const MAX_WALK_DEPTH: usize = 8;

/// Deterministic content hash of a skill subtree: every file's path (relative,
/// forward-slashed) and bytes feed a single SHA-256, sorted by path so the
/// result doesn't depend on directory read order. The origin manifest itself
/// is skipped so its presence never perturbs the hash. Always computed over a
/// freshly-extracted repo source subtree, so install-time and check-time
/// hashes are comparable — never hash an installed dir directly.
pub(crate) fn hash_skill_dir(dir: &Path) -> String {
  let mut files = Vec::new();
  collect_hashable_paths(dir, dir, 0, &mut files);
  files.sort_by(|a, b| a.0.cmp(&b.0));

  let mut hasher = Sha256::new();
  for (rel, path) in &files {
    let bytes = fs::read(path).unwrap_or_default();
    hasher.update(rel.as_bytes());
    hasher.update([0u8]);
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(&bytes);
  }
  format!("{:x}", hasher.finalize())
}

fn collect_hashable_paths(dir: &Path, root: &Path, depth: usize, out: &mut Vec<(String, PathBuf)>) {
  if depth > MAX_WALK_DEPTH {
    return;
  }
  let Ok(rd) = fs::read_dir(dir) else { return };
  for entry in rd.flatten() {
    let child = entry.path();
    if entry.file_name().to_string_lossy() == ORIGIN_MANIFEST_NAME {
      continue;
    }
    if child.is_dir() {
      collect_hashable_paths(&child, root, depth + 1, out);
    } else if child.is_file() {
      let rel = child.strip_prefix(root).unwrap_or(&child).to_string_lossy().replace('\\', "/");
      out.push((rel, child));
    }
  }
}

/// Write the origin manifest into an installed skill dir.
pub(crate) fn write_origin(skill_dir: &Path, origin: &SkillOrigin) -> std::io::Result<()> {
  let json = serde_json::to_string_pretty(origin)
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
  fs::write(skill_dir.join(ORIGIN_MANIFEST_NAME), json)
}

/// Best-effort read of a skill's origin manifest; `None` when absent, unreadable,
/// or malformed rather than failing the caller (a scan tolerates missing origins).
pub(crate) fn read_origin(skill_dir: &Path) -> Option<SkillOrigin> {
  let text = fs::read_to_string(skill_dir.join(ORIGIN_MANIFEST_NAME)).ok()?;
  serde_json::from_str(&text).ok()
}

/// Scan one skills root. Missing root => empty (not an error). Per-entry read
/// errors skip the entry (mirrors history.rs tolerance); only a failure to read
/// the root itself is a source-level error.
fn scan_root(root: &Path, source: &str) -> Result<Vec<InstalledSkill>, String> {
  if !root.is_dir() {
    return Ok(Vec::new());
  }
  let mut skills = Vec::new();
  for entry in fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    // Dot-dirs are never skills: Codex's `.system`, `.git`, editor scratch.
    if name.starts_with('.') {
      continue;
    }
    let child = entry.path();
    let marker = child.join("SKILL.md");
    // `is_dir`/`is_file` follow symlinks, so linked skills count.
    if !child.is_dir() || !marker.is_file() {
      continue;
    }
    let link_target = fs::read_link(&child)
      .ok()
      .map(|t| t.to_string_lossy().into_owned());
    let is_symlink = link_target.is_some()
      || fs::symlink_metadata(&child)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    let Ok(skill_md) = read_text_capped(&marker, MAX_SKILL_MD_BYTES) else {
      continue;
    };
    skills.push(InstalledSkill {
      source: source.to_string(),
      dir_name: name,
      path: child.to_string_lossy().into_owned(),
      is_symlink,
      link_target,
      skill_md,
      modified_at: epoch_ms(marker.metadata()),
      origin: read_origin(&child),
    });
  }
  skills.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
  Ok(skills)
}

/// Enumerate every installed skill across the four global roots, with SKILL.md
/// content inline. Tolerant: missing roots are empty, per-source errors are
/// collected alongside the results.
#[tauri::command(async)]
pub fn skills_scan() -> SkillsScanResult {
  let mut skills = Vec::new();
  let mut errors = Vec::new();
  let Some(home) = dirs::home_dir() else {
    errors.push(ScanError {
      source: "all".into(),
      message: "no home dir".into(),
    });
    return SkillsScanResult { skills, errors };
  };
  for (source, root) in source_roots(&home) {
    match scan_root(&root, source) {
      Ok(mut list) => skills.append(&mut list),
      Err(message) => errors.push(ScanError {
        source: source.into(),
        message,
      }),
    }
  }
  SkillsScanResult { skills, errors }
}

/// Copy the skill at `src` into each target's skills root as `<root>/<dir_name>`.
/// Powers cross-agent copy and local-folder import. The source is canonicalized
/// (a symlinked skill copies its real content) and must contain a SKILL.md;
/// copying a skill onto itself is rejected rather than silently truncating it
/// (replace_dir deletes dest before the swap — on itself that would be data loss).
#[tauri::command(async)]
pub fn install_skill_from_dir(
  src: String,
  dir_name: String,
  targets: Vec<String>,
) -> Result<Vec<String>, String> {
  if !crate::fsops::is_safe_skill_id(&dir_name) {
    return Err(format!("invalid skill dir name: {dir_name}"));
  }
  let src = Path::new(&src)
    .canonicalize()
    .map_err(|e| format!("cannot resolve source folder: {e}"))?;
  if !src.join("SKILL.md").is_file() {
    return Err("source folder has no SKILL.md".into());
  }
  let home = dirs::home_dir().ok_or("no home dir")?;
  let mut dests = Vec::new();
  for t in &targets {
    let root = target_root(&home, t).ok_or_else(|| format!("invalid skill target: {t}"))?;
    let dest = root.join(&dir_name);
    if let Ok(resolved) = dest.canonicalize() {
      if resolved == src {
        return Err(format!(
          "source and destination are the same skill: {}",
          dest.to_string_lossy()
        ));
      }
    }
    crate::fsops::replace_dir(&src, &dest).map_err(|e| e.to_string())?;
    dests.push(dest.to_string_lossy().into_owned());
  }
  Ok(dests)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
  pub rel_path: String,
  pub bytes: u64,
  pub is_dir: bool,
}

/// List every file/dir inside a skill (for the detail view's file browser).
/// Read-only, depth-capped, dotfiles/dot-dirs skipped (so `.agentpack-origin.json`
/// and `.git` never show up).
#[tauri::command(async)]
pub fn list_skill_files(path: String) -> Result<Vec<SkillFile>, String> {
  let root = Path::new(&path)
    .canonicalize()
    .map_err(|e| format!("cannot resolve path: {e}"))?;
  if !root.is_dir() {
    return Err(format!("not a directory: {path}"));
  }
  let mut out = Vec::new();
  walk_skill_files(&root, &root, 0, &mut out);
  out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
  Ok(out)
}

fn walk_skill_files(dir: &Path, root: &Path, depth: usize, out: &mut Vec<SkillFile>) {
  if depth > MAX_WALK_DEPTH {
    return;
  }
  let Ok(rd) = fs::read_dir(dir) else { return };
  for entry in rd.flatten() {
    let name = entry.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') {
      continue;
    }
    let child = entry.path();
    let rel = child.strip_prefix(root).unwrap_or(&child).to_string_lossy().replace('\\', "/");
    let is_dir = child.is_dir();
    let bytes = if is_dir { 0 } else { entry.metadata().map(|m| m.len()).unwrap_or(0) };
    out.push(SkillFile { rel_path: rel, bytes, is_dir });
    if is_dir {
      walk_skill_files(&child, root, depth + 1, out);
    }
  }
}

// ---------------------------------------------------------------------------
// GitHub direct install: fetch a repo tarball into a temp scan dir, list the
// skills it contains, install the picked ones, clean up.
// ---------------------------------------------------------------------------

/// Cap on a downloaded repo tarball. A truncated read shows up as a gzip/tar
/// error ("repo too large or corrupt") instead of filling the disk.
const MAX_TARBALL_BYTES: u64 = 100 * 1024 * 1024;
/// How deep below the repo root to look for skill dirs.
const MAX_SKILL_DEPTH: usize = 4;
/// Scan dirs older than this are swept on the next fetch.
const SCAN_MAX_AGE_SECS: u64 = 24 * 60 * 60;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoSkill {
  dir_name: String,
  /// Path relative to the repo root ("" when the repo root itself is a skill).
  rel_path: String,
  skill_md: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoScan {
  scan_id: String,
  skills: Vec<RepoSkill>,
}

fn scan_base() -> PathBuf {
  std::env::temp_dir().join("agentpack-repo-scan")
}

fn new_scan_id() -> String {
  let n = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos();
  format!("{n:032x}")
}

/// Best-effort sweep of scan dirs older than 24h (crashed sessions, abandoned
/// fetches). Never fails the fetch that triggered it.
fn prune_stale_scans(base: &Path) {
  let Ok(rd) = fs::read_dir(base) else { return };
  for entry in rd.flatten() {
    let stale = entry
      .metadata()
      .and_then(|m| m.modified())
      .ok()
      .and_then(|t| t.elapsed().ok())
      .is_some_and(|age| age.as_secs() > SCAN_MAX_AGE_SECS);
    if stale {
      let _ = fs::remove_dir_all(entry.path());
    }
  }
}

/// Gunzip + untar a repo tarball into `dest`. `tar`'s `unpack` refuses entries
/// that would escape `dest` (zip-slip) and won't write through symlinks.
pub(crate) fn extract_repo(reader: impl Read, dest: &Path) -> std::io::Result<()> {
  let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(reader));
  archive.unpack(dest)
}

/// The single `<repo>-<ref>` dir a codeload tarball unpacks to.
fn single_top_dir(scan_dir: &Path) -> Result<PathBuf, String> {
  let mut dirs = Vec::new();
  for entry in fs::read_dir(scan_dir).map_err(|e| e.to_string())?.flatten() {
    if entry.path().is_dir() {
      dirs.push(entry.path());
    }
  }
  match dirs.as_slice() {
    [single] => Ok(single.clone()),
    _ => Err("unexpected tarball layout".into()),
  }
}

/// Dest dir name when the repo root itself is the skill: the tarball's top dir
/// is `<repo>-<sha|ref>`, so strip a trailing all-hex segment (`-a1b2c3…`).
fn repo_dir_name(top: &Path) -> String {
  let name = top
    .file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .unwrap_or_default();
  if let Some((prefix, suffix)) = name.rsplit_once('-') {
    if suffix.len() >= 7 && suffix.chars().all(|c| c.is_ascii_hexdigit()) && !prefix.is_empty() {
      return prefix.to_string();
    }
  }
  name
}

/// Every dir under `top` (depth-capped, dot-dirs skipped) containing a SKILL.md,
/// including `top` itself. Skill dirs are not descended into — a nested
/// SKILL.md inside references/tests is part of the outer skill.
pub(crate) fn enumerate_repo_skills(top: &Path) -> Vec<RepoSkill> {
  fn walk(dir: &Path, top: &Path, depth: usize, out: &mut Vec<RepoSkill>) {
    if depth > MAX_SKILL_DEPTH {
      return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
      let child = entry.path();
      let name = entry.file_name().to_string_lossy().into_owned();
      if name.starts_with('.') || !child.is_dir() {
        continue;
      }
      if child.join("SKILL.md").is_file() {
        let rel = child
          .strip_prefix(top)
          .unwrap_or(&child)
          .to_string_lossy()
          .replace('\\', "/");
        let Ok(skill_md) = read_text_capped(&child.join("SKILL.md"), MAX_SKILL_MD_BYTES) else {
          continue;
        };
        out.push(RepoSkill { dir_name: name, rel_path: rel, skill_md });
        continue;
      }
      walk(&child, top, depth + 1, out);
    }
  }

  let mut skills = Vec::new();
  if top.join("SKILL.md").is_file() {
    if let Ok(skill_md) = read_text_capped(&top.join("SKILL.md"), MAX_SKILL_MD_BYTES) {
      skills.push(RepoSkill {
        dir_name: repo_dir_name(top),
        rel_path: String::new(),
        skill_md,
      });
    }
  }
  walk(top, top, 1, &mut skills);
  skills.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
  skills
}

/// Download a tarball from `url` (https only; honors HTTPS_PROXY) and extract it
/// into `dest` (created if needed). Factored out of `fetch_repo_skills` so
/// `check_repo_updates`/`update_skill` can reuse the same agent/proxy/size-cap/
/// extract logic instead of re-downloading with different code paths.
fn download_and_extract(url: &str, dest: &Path) -> Result<(), String> {
  if !url.starts_with("https://") {
    return Err("only https:// URLs are allowed".into());
  }
  fs::create_dir_all(dest).map_err(|e| e.to_string())?;

  let mut builder = ureq::AgentBuilder::new()
    .timeout_connect(std::time::Duration::from_secs(30))
    .timeout_read(std::time::Duration::from_secs(30));
  if let Ok(proxy_url) =
    std::env::var("HTTPS_PROXY").or_else(|_| std::env::var("https_proxy"))
  {
    if let Ok(proxy) = ureq::Proxy::new(&proxy_url) {
      builder = builder.proxy(proxy);
    }
  }
  let agent = builder.build();

  let response = agent.get(url).call().map_err(|e| format!("download failed: {e}"))?;
  let reader = response.into_reader().take(MAX_TARBALL_BYTES);
  extract_repo(reader, dest).map_err(|e| format!("extract failed (repo too large or corrupt?): {e}"))
}

/// The codeload tarball URL for a repo/ref, with an optional mirror prefix
/// prepended verbatim (matches the TS `tarballUrl`).
fn codeload_url(repo: &str, git_ref: &str, mirror_prefix: Option<&str>) -> String {
  let base = format!("https://codeload.github.com/{repo}/tar.gz/{git_ref}");
  match mirror_prefix {
    Some(p) => format!("{p}{base}"),
    None => base,
  }
}

/// Download a repo tarball into a fresh scan dir and list the skills inside.
/// Read-only besides the temp dir — installing is a separate, user-confirmed
/// step.
#[tauri::command(async)]
pub fn fetch_repo_skills(url: String) -> Result<RepoScan, String> {
  let base = scan_base();
  prune_stale_scans(&base);
  let scan_id = new_scan_id();
  let scan_dir = base.join(&scan_id);

  if let Err(e) = download_and_extract(&url, &scan_dir) {
    let _ = fs::remove_dir_all(&scan_dir);
    return Err(e);
  }
  let top = match single_top_dir(&scan_dir) {
    Ok(t) => t,
    Err(e) => {
      let _ = fs::remove_dir_all(&scan_dir);
      return Err(e);
    }
  };
  Ok(RepoScan { scan_id, skills: enumerate_repo_skills(&top) })
}

/// Validate a repo-relative skill path from the frontend: no traversal, no
/// absolute paths, no drive letters.
fn is_safe_rel_path(rel: &str) -> bool {
  !rel.starts_with('/')
    && !rel.starts_with('\\')
    && !rel.contains(':')
    && !rel.split(['/', '\\']).any(|seg| seg == ".." || seg.is_empty())
}

/// Testable core of `install_repo_skills`: validate each pick and copy it into
/// every given root.
pub(crate) fn install_picks(
  top: &Path,
  rel_paths: &[String],
  roots: &[PathBuf],
) -> Result<Vec<String>, String> {
  let mut dests = Vec::new();
  for rel in rel_paths {
    if !rel.is_empty() && !is_safe_rel_path(rel) {
      return Err(format!("invalid skill path: {rel}"));
    }
    let src = if rel.is_empty() { top.to_path_buf() } else { top.join(rel) };
    if !src.join("SKILL.md").is_file() {
      return Err(format!("not a skill: {rel}"));
    }
    let dir_name = if rel.is_empty() {
      repo_dir_name(top)
    } else {
      rel.rsplit('/').next().unwrap_or(rel).to_string()
    };
    if !crate::fsops::is_safe_skill_id(&dir_name) {
      return Err(format!("invalid skill dir name: {dir_name}"));
    }
    for root in roots {
      let dest = root.join(&dir_name);
      crate::fsops::replace_dir(&src, &dest).map_err(|e| e.to_string())?;
      dests.push(dest.to_string_lossy().into_owned());
    }
  }
  Ok(dests)
}

/// After `install_picks` copies each pick into every root, write an origin
/// manifest into each installed dir so a later `check_repo_updates` knows
/// where it came from. Mirrors `install_picks`'s rel -> dir_name mapping; run
/// only after `install_picks` has already validated every pick.
fn write_origins_for_picks(
  top: &Path,
  rel_paths: &[String],
  roots: &[PathBuf],
  repo: &str,
  git_ref: &str,
) -> Result<(), String> {
  let installed_at = now_ms();
  for rel in rel_paths {
    let src = if rel.is_empty() { top.to_path_buf() } else { top.join(rel) };
    let dir_name = if rel.is_empty() {
      repo_dir_name(top)
    } else {
      rel.rsplit('/').next().unwrap_or(rel).to_string()
    };
    let origin = SkillOrigin {
      repo: repo.to_string(),
      git_ref: git_ref.to_string(),
      rel_path: rel.clone(),
      content_hash: hash_skill_dir(&src),
      installed_at,
    };
    for root in roots {
      write_origin(&root.join(&dir_name), &origin).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

/// Install skills picked from a previous `fetch_repo_skills` scan. `repo`/
/// `git_ref` (the source repo the scan came from, e.g. "owner/name" and the
/// branch/tag/sha used) are recorded into each installed skill's origin
/// manifest for later update checks.
#[tauri::command(async)]
pub fn install_repo_skills(
  scan_id: String,
  rel_paths: Vec<String>,
  targets: Vec<String>,
  repo: String,
  git_ref: String,
) -> Result<Vec<String>, String> {
  if !crate::fsops::is_safe_skill_id(&scan_id) {
    return Err(format!("invalid scan id: {scan_id}"));
  }
  let scan_dir = scan_base().join(&scan_id);
  let top = single_top_dir(&scan_dir).map_err(|_| "unknown or expired scan".to_string())?;
  let home = dirs::home_dir().ok_or("no home dir")?;
  let roots = targets
    .iter()
    .map(|t| target_root(&home, t).ok_or_else(|| format!("invalid skill target: {t}")))
    .collect::<Result<Vec<_>, _>>()?;
  let dests = install_picks(&top, &rel_paths, &roots)?;
  write_origins_for_picks(&top, &rel_paths, &roots, &repo, &git_ref)?;
  Ok(dests)
}

/// One installed skill to check for updates: its path (echoed back into the
/// result so the caller can map results to rows) and recorded origin.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQuery {
  pub path: String,
  pub origin: SkillOrigin,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
  pub path: String,
  pub has_update: bool,
  pub latest_hash: String,
  pub error: Option<String>,
}

/// Check a batch of installed skills for updates against their recorded
/// origin. Entries are grouped by (repo, ref) so a repo shared by several
/// installed skills is downloaded once. Network-free besides the download;
/// failures are per-group and surface as `error` on every entry in that group
/// rather than failing the whole batch.
#[tauri::command(async)]
pub fn check_repo_updates(entries: Vec<UpdateQuery>, mirror_prefix: Option<String>) -> Vec<UpdateResult> {
  let base = scan_base();
  let mut groups: HashMap<(String, String), Vec<&UpdateQuery>> = HashMap::new();
  for e in &entries {
    groups
      .entry((e.origin.repo.clone(), e.origin.git_ref.clone()))
      .or_default()
      .push(e);
  }

  let mut results = Vec::new();
  for ((repo, git_ref), group) in groups {
    let scan_dir = base.join(format!("update-{}", new_scan_id()));
    let url = codeload_url(&repo, &git_ref, mirror_prefix.as_deref());
    let top = download_and_extract(&url, &scan_dir).and_then(|_| single_top_dir(&scan_dir));
    let top = match top {
      Ok(t) => t,
      Err(e) => {
        for q in group {
          results.push(UpdateResult {
            path: q.path.clone(),
            has_update: false,
            latest_hash: String::new(),
            error: Some(e.clone()),
          });
        }
        let _ = fs::remove_dir_all(&scan_dir);
        continue;
      }
    };
    for q in group {
      let src = if q.origin.rel_path.is_empty() { top.clone() } else { top.join(&q.origin.rel_path) };
      if !src.join("SKILL.md").is_file() {
        results.push(UpdateResult {
          path: q.path.clone(),
          has_update: false,
          latest_hash: String::new(),
          error: Some("skill path not found in latest repo".into()),
        });
        continue;
      }
      let latest_hash = hash_skill_dir(&src);
      results.push(UpdateResult {
        path: q.path.clone(),
        has_update: latest_hash != q.origin.content_hash,
        latest_hash,
        error: None,
      });
    }
    let _ = fs::remove_dir_all(&scan_dir);
  }
  results
}

/// Re-fetch an installed skill's origin repo and replace it in each target
/// with the fresh copy, updating the origin manifest's hash/timestamp.
#[tauri::command(async)]
pub fn update_skill(path: String, targets: Vec<String>, mirror_prefix: Option<String>) -> Result<Vec<String>, String> {
  let origin = read_origin(Path::new(&path)).ok_or("skill has no origin manifest")?;
  let dir_name = Path::new(&path)
    .file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .ok_or("invalid skill path")?;
  if !crate::fsops::is_safe_skill_id(&dir_name) {
    return Err(format!("invalid skill dir name: {dir_name}"));
  }
  let home = dirs::home_dir().ok_or("no home dir")?;
  let roots = targets
    .iter()
    .map(|t| target_root(&home, t).ok_or_else(|| format!("invalid skill target: {t}")))
    .collect::<Result<Vec<_>, _>>()?;

  let scan_dir = scan_base().join(format!("update-{}", new_scan_id()));
  let cleanup_and_err = |msg: String| {
    let _ = fs::remove_dir_all(&scan_dir);
    Err(msg)
  };
  let url = codeload_url(&origin.repo, &origin.git_ref, mirror_prefix.as_deref());
  if let Err(e) = download_and_extract(&url, &scan_dir) {
    return cleanup_and_err(e);
  }
  let top = match single_top_dir(&scan_dir) {
    Ok(t) => t,
    Err(e) => return cleanup_and_err(e),
  };
  let src = if origin.rel_path.is_empty() { top.clone() } else { top.join(&origin.rel_path) };
  if !src.join("SKILL.md").is_file() {
    return cleanup_and_err("skill path not found in latest repo".into());
  }
  let new_origin = SkillOrigin {
    repo: origin.repo.clone(),
    git_ref: origin.git_ref.clone(),
    rel_path: origin.rel_path.clone(),
    content_hash: hash_skill_dir(&src),
    installed_at: now_ms(),
  };

  let mut dests = Vec::new();
  for root in &roots {
    let dest = root.join(&dir_name);
    if let Err(e) = crate::fsops::replace_dir(&src, &dest) {
      return cleanup_and_err(e.to_string());
    }
    if let Err(e) = write_origin(&dest, &new_origin) {
      return cleanup_and_err(e.to_string());
    }
    dests.push(dest.to_string_lossy().into_owned());
  }
  let _ = fs::remove_dir_all(&scan_dir);
  Ok(dests)
}

/// Delete a scan's temp dir (also swept automatically after 24h).
#[tauri::command(async)]
pub fn cleanup_repo_scan(scan_id: String) -> Result<(), String> {
  if !crate::fsops::is_safe_skill_id(&scan_id) {
    return Err(format!("invalid scan id: {scan_id}"));
  }
  let dir = scan_base().join(&scan_id);
  if dir.exists() {
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
  }
  Ok(())
}

// ---------------------------------------------------------------------------
// Skill backups: a manual "snapshot this skill before I edit/update/remove
// it" safety net, independent of the cc-switch-focused `backup.rs`.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillBackup {
  pub id: String,
  pub name: String,
  pub dir_name: String,
  pub source: String,
  pub bytes: u64,
  pub created_at: i64,
}

/// Root under which skill backups live. `AGENTPACK_SKILL_BACKUP_ROOT` overrides
/// it (used by tests, mirroring `backup::backup_root`) else `~/.agentpack/skill-backups`.
fn backups_root() -> Option<PathBuf> {
  if let Ok(p) = std::env::var("AGENTPACK_SKILL_BACKUP_ROOT") {
    return Some(PathBuf::from(p));
  }
  dirs::home_dir().map(|h| h.join(".agentpack").join("skill-backups"))
}

/// Backup ids are used as a directory name under `backups_root()`; reject the
/// same shapes as a skill id, plus a drive-letter colon.
fn is_safe_backup_id(id: &str) -> bool {
  crate::fsops::is_safe_skill_id(id) && !id.contains(':')
}

/// Best-effort match of a skill path's parent against the four known skills
/// roots, for the backup's `source` label. "unknown" when it doesn't match
/// (e.g. a skill backed up from an arbitrary folder).
fn source_for_path(path: &Path) -> String {
  let Some(parent_canon) = path.parent().and_then(|p| p.canonicalize().ok()) else {
    return "unknown".into();
  };
  let Some(home) = dirs::home_dir() else { return "unknown".into() };
  source_roots(&home)
    .into_iter()
    .find(|(_, root)| root.canonicalize().map(|r| r == parent_canon).unwrap_or(false))
    .map(|(s, _)| s.to_string())
    .unwrap_or_else(|| "unknown".into())
}

fn dir_total_bytes(dir: &Path) -> u64 {
  let mut total = 0u64;
  let Ok(rd) = fs::read_dir(dir) else { return 0 };
  for entry in rd.flatten() {
    let path = entry.path();
    if path.is_dir() {
      total += dir_total_bytes(&path);
    } else if let Ok(meta) = entry.metadata() {
      total += meta.len();
    }
  }
  total
}

/// Snapshot a skill dir into `<backups_root>/<id>/skill` plus a `meta.json`
/// sidecar. `path` is canonicalized before copying (a symlinked skill backs up
/// its real content) but `dir_name` is taken from the original last segment so
/// a link keeps its own entry name.
#[tauri::command(async)]
pub fn backup_skill(path: String) -> Result<SkillBackup, String> {
  let backups_root = backups_root().ok_or("no home dir")?;
  let path = Path::new(&path);
  let dir_name = path
    .file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .ok_or("invalid skill path")?;
  if !crate::fsops::is_safe_skill_id(&dir_name) {
    return Err(format!("invalid skill dir name: {dir_name}"));
  }
  let resolved = path
    .canonicalize()
    .map_err(|e| format!("cannot resolve skill folder: {e}"))?;
  if !resolved.join("SKILL.md").is_file() {
    return Err("not a skill (no SKILL.md)".into());
  }
  let source = source_for_path(path);

  let id = format!("{dir_name}-{}", now_ms());
  let entry_dir = backups_root.join(&id);
  let skill_dest = entry_dir.join("skill");
  crate::fsops::copy_dir(&resolved, &skill_dest).map_err(|e| e.to_string())?;
  let bytes = dir_total_bytes(&skill_dest);

  let backup = SkillBackup {
    id: id.clone(),
    name: dir_name.clone(),
    dir_name,
    source,
    bytes,
    created_at: now_ms(),
  };
  let meta = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
  fs::write(entry_dir.join("meta.json"), meta).map_err(|e| e.to_string())?;
  Ok(backup)
}

/// List every skill backup, newest first. Entries without a readable manifest
/// are skipped rather than failing the whole listing. Missing root => empty.
#[tauri::command(async)]
pub fn list_skill_backups() -> Result<Vec<SkillBackup>, String> {
  let Some(root) = backups_root() else { return Ok(Vec::new()) };
  if !root.is_dir() {
    return Ok(Vec::new());
  }
  let mut out = Vec::new();
  for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
    if let Ok(text) = fs::read_to_string(entry.path().join("meta.json")) {
      if let Ok(b) = serde_json::from_str::<SkillBackup>(&text) {
        out.push(b);
      }
    }
  }
  out.sort_by_key(|b| std::cmp::Reverse(b.created_at));
  Ok(out)
}

/// Testable core of `restore_skill_backup`: copy `src` into `<root>/<dir_name>`
/// for each already-resolved root.
fn restore_backup_into_roots(src: &Path, dir_name: &str, roots: &[PathBuf]) -> Result<Vec<String>, String> {
  let mut dests = Vec::new();
  for root in roots {
    let dest = root.join(dir_name);
    crate::fsops::replace_dir(src, &dest).map_err(|e| e.to_string())?;
    dests.push(dest.to_string_lossy().into_owned());
  }
  Ok(dests)
}

/// Restore a backup into each target's skills root as `<root>/<dir_name>`
/// (the name recorded in the backup's own metadata, not derived from `id`).
#[tauri::command(async)]
pub fn restore_skill_backup(id: String, targets: Vec<String>) -> Result<Vec<String>, String> {
  if !is_safe_backup_id(&id) {
    return Err(format!("invalid backup id: {id}"));
  }
  let root = backups_root().ok_or("no home dir")?;
  let entry_dir = root.join(&id);
  let src = entry_dir.join("skill");
  if !src.is_dir() {
    return Err(format!("backup not found: {id}"));
  }
  let meta: SkillBackup = serde_json::from_str(
    &fs::read_to_string(entry_dir.join("meta.json")).map_err(|e| e.to_string())?,
  )
  .map_err(|e| e.to_string())?;

  let home = dirs::home_dir().ok_or("no home dir")?;
  let roots = targets
    .iter()
    .map(|t| target_root(&home, t).ok_or_else(|| format!("invalid skill target: {t}")))
    .collect::<Result<Vec<_>, _>>()?;
  restore_backup_into_roots(&src, &meta.dir_name, &roots)
}

/// Delete a backup. Idempotent on a missing id. Guardrail: the target's parent
/// must canonicalize to the backups root itself (mirrors
/// `fsops::ensure_within_skills_dir`) — never delete outside it.
#[tauri::command(async)]
pub fn delete_skill_backup(id: String) -> Result<(), String> {
  if !is_safe_backup_id(&id) {
    return Err(format!("invalid backup id: {id}"));
  }
  let root = backups_root().ok_or("no home dir")?;
  let target = root.join(&id);
  if !target.exists() {
    return Ok(());
  }
  let root_canon = root.canonicalize().map_err(|e| e.to_string())?;
  let parent_canon = target
    .parent()
    .ok_or("invalid backup id")?
    .canonicalize()
    .map_err(|e| e.to_string())?;
  if parent_canon != root_canon {
    return Err("refusing to remove path outside the backups root".into());
  }
  fs::remove_dir_all(&target).map_err(|e| e.to_string())
}

/// Testable core of `create_skill`: given already-resolved dest roots, write a
/// new SKILL.md into `<root>/<name>` for each. Existence is checked across all
/// roots before writing any of them, so a later root failing never leaves a
/// mix of created/not-created dirs.
fn create_skill_in_roots(
  name: &str,
  roots: &[PathBuf],
  content: &str,
  overwrite: bool,
) -> Result<Vec<String>, String> {
  if !crate::fsops::is_safe_skill_id(name) {
    return Err(format!("invalid skill name: {name}"));
  }
  let mut dests = Vec::new();
  for root in roots {
    let dest = root.join(name);
    if dest.exists() && !overwrite {
      return Err(format!("skill already exists: {}", dest.to_string_lossy()));
    }
    dests.push(dest);
  }
  for dest in &dests {
    // On overwrite, drop any prior skill dir first so stale files never linger.
    if dest.exists() {
      fs::remove_dir_all(dest).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    fs::write(dest.join("SKILL.md"), content).map_err(|e| e.to_string())?;
  }
  Ok(dests.into_iter().map(|d| d.to_string_lossy().into_owned()).collect())
}

/// Hand-author a new skill's SKILL.md into each target's skills root. By default
/// refuses to overwrite an existing dir (brand-new skills only); pass
/// `overwrite: true` — which the frontend only does after the user resolves the
/// install-conflict dialog — to replace an existing skill in place. Unmanaged: no
/// origin manifest is written.
#[tauri::command(async)]
pub fn create_skill(
  name: String,
  targets: Vec<String>,
  content: String,
  overwrite: bool,
) -> Result<Vec<String>, String> {
  let home = dirs::home_dir().ok_or("no home dir")?;
  let roots = targets
    .iter()
    .map(|t| target_root(&home, t).ok_or_else(|| format!("invalid skill target: {t}")))
    .collect::<Result<Vec<_>, _>>()?;
  create_skill_in_roots(&name, &roots, &content, overwrite)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let n = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos();
    std::env::temp_dir().join(format!("apsk-{tag}-{n:032x}"))
  }

  fn write_skill(root: &Path, name: &str, body: &str) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("SKILL.md"), body).unwrap();
    dir
  }

  /// Create a directory symlink, returning false when the platform refuses
  /// (Windows without Developer Mode) so callers can skip gracefully.
  fn try_symlink_dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(target, link).is_ok();
    #[cfg(windows)]
    return std::os::windows::fs::symlink_dir(target, link).is_ok();
  }

  #[test]
  fn scan_root_finds_skills_and_skips_clutter() {
    let root = temp_dir("scan");
    fs::create_dir_all(&root).unwrap();
    write_skill(&root, "find-docs", "---\nname: find-docs\ndescription: d\n---\n# Docs\n");
    write_skill(&root, ".system", "hidden"); // dot-dir: never a skill
    fs::create_dir_all(root.join("no-marker")).unwrap(); // no SKILL.md
    fs::write(root.join("stray.md"), "file, not dir").unwrap();

    let got = scan_root(&root, "claude").unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].dir_name, "find-docs");
    assert_eq!(got[0].source, "claude");
    assert!(got[0].skill_md.contains("name: find-docs"));
    assert!(!got[0].is_symlink);
    assert!(got[0].modified_at > 0);

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn scan_root_missing_dir_is_empty_not_error() {
    let root = temp_dir("scan-missing");
    assert!(scan_root(&root, "codex").unwrap().is_empty());
  }

  #[test]
  fn scan_root_caps_oversized_skill_md() {
    let root = temp_dir("scan-cap");
    fs::create_dir_all(&root).unwrap();
    let big = "x".repeat((MAX_SKILL_MD_BYTES + 1024) as usize);
    write_skill(&root, "huge", &big);

    let got = scan_root(&root, "agents").unwrap();
    assert_eq!(got[0].skill_md.len() as u64, MAX_SKILL_MD_BYTES);

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn scan_root_reports_symlinked_skills() {
    let base = temp_dir("scan-link");
    let canonical = base.join("agents");
    let root = base.join("claude");
    fs::create_dir_all(&root).unwrap();
    let real = write_skill(&canonical, "caveman", "---\nname: caveman\n---\nbody");
    if !try_symlink_dir(&real, &root.join("caveman")) {
      return; // symlink creation unavailable (Windows without Developer Mode)
    }

    let got = scan_root(&root, "claude").unwrap();
    assert_eq!(got.len(), 1);
    assert!(got[0].is_symlink);
    assert!(got[0].link_target.as_deref().unwrap().contains("agents"));
    assert!(got[0].skill_md.contains("caveman"));

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn remove_skill_dir_at_unlinks_without_touching_canonical_content() {
    let base = temp_dir("unlink");
    let canonical = base.join("agents");
    let root = base.join("claude");
    fs::create_dir_all(&root).unwrap();
    let real = write_skill(&canonical, "caveman", "body");
    let link = root.join("caveman");
    if !try_symlink_dir(&real, &link) {
      return;
    }

    crate::fsops::remove_skill_dir_at(&link).unwrap();
    assert!(fs::symlink_metadata(&link).is_err(), "link must be gone");
    assert!(
      real.join("SKILL.md").is_file(),
      "canonical content must survive deleting the link"
    );

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn remove_skill_dir_at_removes_real_dirs_recursively() {
    let base = temp_dir("rmreal");
    let dir = write_skill(&base, "rust", "body");
    fs::create_dir_all(dir.join("references")).unwrap();
    fs::write(dir.join("references").join("a.md"), "ref").unwrap();

    crate::fsops::remove_skill_dir_at(&dir).unwrap();
    assert!(!dir.exists());

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn install_skill_from_dir_validates_inputs() {
    let base = temp_dir("inst-bad");
    fs::create_dir_all(&base).unwrap();
    let no_marker = base.join("plain");
    fs::create_dir_all(&no_marker).unwrap();
    let src = no_marker.to_string_lossy().into_owned();

    // Traversal-shaped dir names are rejected before any fs work.
    assert!(install_skill_from_dir(src.clone(), "../evil".into(), vec!["claude".into()]).is_err());
    // A folder without SKILL.md is not a skill.
    assert!(install_skill_from_dir(src.clone(), "plain".into(), vec!["claude".into()]).is_err());
    // Unknown targets are rejected.
    let skill = write_skill(&base, "ok", "---\nname: ok\n---\n");
    assert!(install_skill_from_dir(
      skill.to_string_lossy().into_owned(),
      "ok".into(),
      vec!["cursor".into()]
    )
    .is_err());
    // A missing source cannot be canonicalized.
    assert!(install_skill_from_dir(
      base.join("nope").to_string_lossy().into_owned(),
      "ok".into(),
      vec!["claude".into()]
    )
    .is_err());

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn source_roots_cover_all_four_agents() {
    let home = Path::new("/h");
    let roots = source_roots(home);
    let sources: Vec<&str> = roots.iter().map(|(s, _)| *s).collect();
    assert_eq!(sources, vec!["claude", "codex", "opencode", "agents"]);
    // `install_skill` (bundled), `install_skill_from_dir`, `create_skill` and the
    // repo installer all resolve targets through `target_root`; every one of the
    // four sources must map to a root, and anything else must be rejected.
    assert_eq!(target_root(home, "claude"), Some(home.join(".claude").join("skills")));
    assert_eq!(target_root(home, "codex"), Some(codex_home(home).join("skills")));
    assert_eq!(
      target_root(home, "opencode"),
      Some(home.join(".config").join("opencode").join("skills"))
    );
    assert_eq!(target_root(home, "agents"), Some(home.join(".agents").join("skills")));
    assert_eq!(target_root(home, "cursor"), None);
  }

  /// Build a gzip'd tarball in memory, GitHub-style: one `repo-<sha>/` top dir.
  fn make_tarball(files: &[(&str, &str)]) -> Vec<u8> {
    let gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let mut tar = tar::Builder::new(gz);
    for (path, content) in files {
      let mut header = tar::Header::new_gnu();
      header.set_size(content.len() as u64);
      header.set_mode(0o644);
      header.set_cksum();
      tar.append_data(&mut header, path, content.as_bytes()).unwrap();
    }
    tar.into_inner().unwrap().finish().unwrap()
  }

  #[test]
  fn extract_and_enumerate_finds_root_and_nested_skills() {
    let tarball = make_tarball(&[
      ("agent-skills-a1b2c3d4e5/SKILL.md", "---\nname: root-skill\n---\n"),
      ("agent-skills-a1b2c3d4e5/skills/web/SKILL.md", "---\nname: web\n---\n"),
      ("agent-skills-a1b2c3d4e5/skills/web/references/notes.md", "not a skill marker"),
      ("agent-skills-a1b2c3d4e5/docs/readme.md", "no skill here"),
      ("agent-skills-a1b2c3d4e5/.github/SKILL.md", "hidden dirs are skipped"),
    ]);
    let dest = temp_dir("repo-enum");
    extract_repo(&tarball[..], &dest).unwrap();

    let top = single_top_dir(&dest).unwrap();
    let skills = enumerate_repo_skills(&top);
    let rels: Vec<&str> = skills.iter().map(|s| s.rel_path.as_str()).collect();
    assert_eq!(rels, vec!["", "skills/web"]);
    // The root skill's dest name strips the tarball's `-<sha>` suffix.
    assert_eq!(skills[0].dir_name, "agent-skills");
    assert_eq!(skills[1].dir_name, "web");
    assert!(skills[1].skill_md.contains("name: web"));

    let _ = fs::remove_dir_all(&dest);
  }

  #[test]
  fn extract_repo_errors_on_truncated_input() {
    let tarball = make_tarball(&[("repo-abcdef1/SKILL.md", &"x".repeat(64 * 1024))]);
    let dest = temp_dir("repo-cap");
    // Simulate the download size cap: a hard-truncated stream must error, not
    // silently produce a partial extraction that looks complete.
    let capped = &tarball[..tarball.len() / 2];
    assert!(extract_repo(capped, &dest).is_err());
    let _ = fs::remove_dir_all(&dest);
  }

  #[test]
  fn install_picks_validates_and_copies_into_roots() {
    let base = temp_dir("repo-install");
    let top = base.join("repo-abcdef1");
    fs::create_dir_all(top.join("skills/web")).unwrap();
    fs::write(top.join("skills/web/SKILL.md"), "---\nname: web\n---\n").unwrap();
    fs::write(top.join("skills/web/extra.md"), "ref").unwrap();
    let root_a = base.join("root-a");
    let root_b = base.join("root-b");

    // Traversal and absolute paths are rejected before any copy.
    for bad in ["../evil", "/abs", "a//b", "c:/x"] {
      assert!(
        install_picks(&top, &[bad.to_string()], std::slice::from_ref(&root_a)).is_err(),
        "should reject {bad}"
      );
    }
    // A rel path without a SKILL.md is not installable.
    assert!(install_picks(&top, &["skills".into()], std::slice::from_ref(&root_a)).is_err());

    let dests =
      install_picks(&top, &["skills/web".into()], &[root_a.clone(), root_b.clone()]).unwrap();
    assert_eq!(dests.len(), 2);
    assert!(root_a.join("web/SKILL.md").is_file());
    assert!(root_b.join("web/extra.md").is_file());

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn repo_dir_name_strips_hex_suffix_only() {
    assert_eq!(repo_dir_name(Path::new("/t/agent-skills-a1b2c3d")), "agent-skills");
    // A short or non-hex suffix is part of the real name.
    assert_eq!(repo_dir_name(Path::new("/t/tauri-v2")), "tauri-v2");
    assert_eq!(repo_dir_name(Path::new("/t/plain")), "plain");
  }

  #[test]
  fn install_repo_skills_rejects_bad_or_unknown_scan_ids() {
    assert!(install_repo_skills("../etc".into(), vec![], vec![], "o/r".into(), "main".into()).is_err());
    assert!(install_repo_skills(
      "00nope00".into(),
      vec![],
      vec!["claude".into()],
      "o/r".into(),
      "main".into()
    )
    .is_err());
  }

  #[test]
  fn cleanup_repo_scan_removes_only_safe_ids() {
    assert!(cleanup_repo_scan("../evil".into()).is_err());
    let base = scan_base().join("test-cleanup-scan");
    fs::create_dir_all(&base).unwrap();
    cleanup_repo_scan("test-cleanup-scan".into()).unwrap();
    assert!(!base.exists());
    // Idempotent on a missing dir.
    cleanup_repo_scan("test-cleanup-scan".into()).unwrap();
  }

  #[test]
  fn hash_skill_dir_is_deterministic_content_sensitive_and_ignores_origin() {
    let root = temp_dir("hash");
    let dir = write_skill(&root, "sk", "---\nname: sk\n---\nbody");
    fs::write(dir.join("extra.md"), "extra").unwrap();

    let h1 = hash_skill_dir(&dir);
    assert_eq!(h1, hash_skill_dir(&dir), "hash must be deterministic");

    // A changed byte anywhere in the tree changes the hash.
    fs::write(dir.join("extra.md"), "extraa").unwrap();
    assert_ne!(h1, hash_skill_dir(&dir));
    fs::write(dir.join("extra.md"), "extra").unwrap(); // revert
    assert_eq!(h1, hash_skill_dir(&dir));

    // The origin manifest itself must never affect the hash.
    let origin = SkillOrigin {
      repo: "o/r".into(),
      git_ref: "main".into(),
      rel_path: String::new(),
      content_hash: "irrelevant".into(),
      installed_at: 0,
    };
    write_origin(&dir, &origin).unwrap();
    assert_eq!(h1, hash_skill_dir(&dir), "origin manifest must not affect the hash");

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn write_origin_read_origin_roundtrip() {
    let dir = temp_dir("origin-roundtrip");
    fs::create_dir_all(&dir).unwrap();
    let origin = SkillOrigin {
      repo: "owner/name".into(),
      git_ref: "v1".into(),
      rel_path: "skills/web".into(),
      content_hash: "abc123".into(),
      installed_at: 42,
    };
    write_origin(&dir, &origin).unwrap();

    let got = read_origin(&dir).unwrap();
    assert_eq!(got.repo, "owner/name");
    assert_eq!(got.git_ref, "v1");
    assert_eq!(got.rel_path, "skills/web");
    assert_eq!(got.content_hash, "abc123");
    assert_eq!(got.installed_at, 42);

    // Missing manifest => None, not an error.
    assert!(read_origin(&temp_dir("origin-missing")).is_none());

    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn install_repo_skills_writes_origin_readable_and_surfaced_by_scan() {
    let tarball = make_tarball(&[("agent-skills-a1b2c3d4e5/skills/web/SKILL.md", "---\nname: web\n---\n")]);
    let base = temp_dir("origin-install");
    extract_repo(&tarball[..], &base).unwrap();
    let top = single_top_dir(&base).unwrap();
    let root = base.join("target-root");
    fs::create_dir_all(&root).unwrap();

    // Drive the same two steps `install_repo_skills` does, without network.
    let dests = install_picks(&top, &["skills/web".to_string()], std::slice::from_ref(&root)).unwrap();
    write_origins_for_picks(
      &top,
      &["skills/web".to_string()],
      std::slice::from_ref(&root),
      "owner/repo",
      "main",
    )
    .unwrap();

    let dest = PathBuf::from(&dests[0]);
    let origin = read_origin(&dest).unwrap();
    assert_eq!(origin.repo, "owner/repo");
    assert_eq!(origin.git_ref, "main");
    assert_eq!(origin.rel_path, "skills/web");
    assert!(!origin.content_hash.is_empty());

    let scanned = scan_root(&root, "claude").unwrap();
    assert_eq!(scanned.len(), 1);
    let scanned_origin = scanned[0].origin.as_ref().expect("scan should surface the origin");
    assert_eq!(scanned_origin.repo, "owner/repo");

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn create_skill_in_roots_refuses_overwrite_and_bad_names() {
    let base = temp_dir("create");
    let root_a = base.join("root-a");
    let root_b = base.join("root-b");
    fs::create_dir_all(&root_a).unwrap();
    fs::create_dir_all(&root_b).unwrap();

    // A bad name is rejected before any fs work.
    assert!(create_skill_in_roots("../evil", std::slice::from_ref(&root_a), "# body", false).is_err());

    // Happy path writes SKILL.md into every root.
    let dests =
      create_skill_in_roots("brand-new", &[root_a.clone(), root_b.clone()], "# body", false).unwrap();
    assert_eq!(dests.len(), 2);
    assert_eq!(fs::read_to_string(root_a.join("brand-new/SKILL.md")).unwrap(), "# body");
    assert_eq!(fs::read_to_string(root_b.join("brand-new/SKILL.md")).unwrap(), "# body");

    // A second call refuses to overwrite, and does not touch root_b either
    // (the existence check runs across all roots before any write happens).
    fs::write(root_a.join("brand-new/SKILL.md"), "# body").unwrap();
    assert!(
      create_skill_in_roots("brand-new", &[root_a.clone(), root_b.clone()], "# changed", false).is_err()
    );
    assert_eq!(fs::read_to_string(root_a.join("brand-new/SKILL.md")).unwrap(), "# body");

    // With overwrite=true the existing skill is replaced in place (and stale
    // files are cleared: the extra file below must be gone afterwards).
    fs::write(root_a.join("brand-new/stale.md"), "old").unwrap();
    let dests =
      create_skill_in_roots("brand-new", &[root_a.clone(), root_b.clone()], "# changed", true).unwrap();
    assert_eq!(dests.len(), 2);
    assert_eq!(fs::read_to_string(root_a.join("brand-new/SKILL.md")).unwrap(), "# changed");
    assert!(!root_a.join("brand-new/stale.md").exists());

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn create_skill_rejects_unknown_target() {
    assert!(create_skill("new-skill".into(), vec!["cursor".into()], "# body".into(), false).is_err());
  }

  #[test]
  fn list_skill_files_lists_nested_files_skips_dotfiles_marks_dirs() {
    let root = temp_dir("list-files");
    fs::create_dir_all(root.join("references")).unwrap();
    fs::write(root.join("SKILL.md"), "# skill").unwrap();
    fs::write(root.join("references").join("notes.md"), "notes").unwrap();
    fs::write(root.join(".agentpack-origin.json"), "{}").unwrap();
    fs::create_dir_all(root.join(".git")).unwrap();

    let got = list_skill_files(root.to_string_lossy().into_owned()).unwrap();
    let rels: Vec<&str> = got.iter().map(|f| f.rel_path.as_str()).collect();
    assert!(rels.contains(&"SKILL.md"));
    assert!(rels.contains(&"references"));
    assert!(rels.contains(&"references/notes.md"));
    // Dotfiles/dot-dirs are skipped entirely (not descended into either).
    assert!(!rels.iter().any(|r| r.starts_with('.')));

    let references = got.iter().find(|f| f.rel_path == "references").unwrap();
    assert!(references.is_dir);
    let skill_md = got.iter().find(|f| f.rel_path == "SKILL.md").unwrap();
    assert!(!skill_md.is_dir);
    assert!(skill_md.bytes > 0);

    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn list_skill_files_errors_on_missing_path() {
    assert!(list_skill_files(temp_dir("nope").to_string_lossy().into_owned()).is_err());
  }

  /// Point `AGENTPACK_SKILL_BACKUP_ROOT` at a fresh temp dir for the duration
  /// of `f`, serialized against every other test that mutates process env vars.
  fn with_backup_root<T>(f: impl FnOnce(&Path) -> T) -> T {
    let _g = crate::TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let root = temp_dir("skill-backups");
    std::env::set_var("AGENTPACK_SKILL_BACKUP_ROOT", &root);
    let result = f(&root);
    std::env::remove_var("AGENTPACK_SKILL_BACKUP_ROOT");
    let _ = fs::remove_dir_all(&root);
    result
  }

  #[test]
  fn backup_list_restore_delete_roundtrip() {
    with_backup_root(|backups_root| {
      let src_base = temp_dir("backup-src");
      let skill = write_skill(&src_base, "my-skill", "---\nname: my-skill\n---\noriginal");

      let backup = backup_skill(skill.to_string_lossy().into_owned()).unwrap();
      assert_eq!(backup.dir_name, "my-skill");
      assert_eq!(backup.name, "my-skill");
      assert!(backup.bytes > 0);

      let listed = list_skill_backups().unwrap();
      assert!(listed.iter().any(|b| b.id == backup.id));

      // Mutate the original after backing it up, then restore (via the
      // testable core, so this doesn't need to touch the real home dir) into
      // a fresh root and confirm it has the ORIGINAL content back.
      fs::write(skill.join("SKILL.md"), "---\nname: my-skill\n---\nchanged").unwrap();
      let restore_root = src_base.join("restore-target");
      fs::create_dir_all(&restore_root).unwrap();
      let src = backups_root.join(&backup.id).join("skill");
      let dests =
        restore_backup_into_roots(&src, &backup.dir_name, std::slice::from_ref(&restore_root)).unwrap();
      assert_eq!(dests.len(), 1);
      let restored = fs::read_to_string(restore_root.join("my-skill").join("SKILL.md")).unwrap();
      assert!(restored.contains("original"), "restore must bring back the backed-up content");

      delete_skill_backup(backup.id.clone()).unwrap();
      let after_delete = list_skill_backups().unwrap();
      assert!(!after_delete.iter().any(|b| b.id == backup.id));

      // Deleting again is idempotent.
      delete_skill_backup(backup.id).unwrap();

      let _ = fs::remove_dir_all(&src_base);
    });
  }

  #[test]
  fn delete_skill_backup_rejects_traversal_ids() {
    with_backup_root(|_root| {
      assert!(delete_skill_backup("../evil".into()).is_err());
      assert!(delete_skill_backup("a/b".into()).is_err());
      assert!(delete_skill_backup("a\\b".into()).is_err());
      assert!(delete_skill_backup("c:evil".into()).is_err());
    });
  }
}
