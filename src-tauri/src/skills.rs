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
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

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

/// Root a skill installs into for a given target name.
fn target_root(home: &Path, target: &str) -> Option<PathBuf> {
  source_roots(home)
    .into_iter()
    .find(|(source, _)| *source == target)
    .map(|(_, root)| root)
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

/// Download a repo tarball (https only; honors HTTPS_PROXY) into a fresh scan
/// dir and list the skills inside. Read-only besides the temp dir — installing
/// is a separate, user-confirmed step.
#[tauri::command(async)]
pub fn fetch_repo_skills(url: String) -> Result<RepoScan, String> {
  if !url.starts_with("https://") {
    return Err("only https:// URLs are allowed".into());
  }
  let base = scan_base();
  prune_stale_scans(&base);
  let scan_id = new_scan_id();
  let scan_dir = base.join(&scan_id);
  fs::create_dir_all(&scan_dir).map_err(|e| e.to_string())?;

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

  let cleanup_and_err = |msg: String| {
    let _ = fs::remove_dir_all(&scan_dir);
    Err(msg)
  };
  let response = match agent.get(&url).call() {
    Ok(r) => r,
    Err(e) => return cleanup_and_err(format!("download failed: {e}")),
  };
  let reader = response.into_reader().take(MAX_TARBALL_BYTES);
  if let Err(e) = extract_repo(reader, &scan_dir) {
    return cleanup_and_err(format!("extract failed (repo too large or corrupt?): {e}"));
  }
  let top = match single_top_dir(&scan_dir) {
    Ok(t) => t,
    Err(e) => return cleanup_and_err(e),
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

/// Install skills picked from a previous `fetch_repo_skills` scan.
#[tauri::command(async)]
pub fn install_repo_skills(
  scan_id: String,
  rel_paths: Vec<String>,
  targets: Vec<String>,
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
  install_picks(&top, &rel_paths, &roots)
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
    assert!(install_repo_skills("../etc".into(), vec![], vec![]).is_err());
    assert!(install_repo_skills("00nope00".into(), vec![], vec!["claude".into()]).is_err());
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
}
