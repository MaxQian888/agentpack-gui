use crate::paths::codex_home;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Read a text file, returning "" when it does not exist (mirrors the TUI's
/// readTextOrEmpty so config merges start from a blank slate).
///
/// A *missing* file is the expected "start from blank" case. But any other error
/// (permission denied, a lock held by another process, an I/O fault) must NOT be
/// swallowed into "": a merge step reads-then-writes, so returning "" for an
/// unreadable-but-present config would make the merge treat it as empty, skip the
/// backup, and clobber the real file it couldn't read. Surface those as errors so
/// the merge step fails loudly and writes nothing.
#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<String, String> {
  match fs::read_to_string(&path) {
    Ok(s) => Ok(s),
    Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(String::new()),
    Err(e) => Err(format!("cannot read {path}: {e}")),
  }
}

/// Write a text file, creating parent directories as needed. Writes to a sibling
/// temp file then renames it over the target, so a crash mid-write never leaves a
/// truncated config (rename is atomic within a filesystem, and replaces the
/// existing file on Windows). Every agent-config mutation lands through here.
#[tauri::command(async)]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
  let p = Path::new(&path);
  if let Some(parent) = p.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let tmp = PathBuf::from(format!("{path}.agentpack.tmp"));
  fs::write(&tmp, content).map_err(|e| e.to_string())?;
  fs::rename(&tmp, p).map_err(|e| e.to_string())
}

/// Whether a path exists (used to show skill install status).
#[tauri::command(async)]
pub fn path_exists(path: String) -> bool {
  Path::new(&path).exists()
}

/// The skills directories a skill may legitimately be installed into / removed
/// from: `~/.claude/skills` and `<codexHome>/skills`. Used as a delete whitelist.
fn skills_roots() -> Vec<PathBuf> {
  match dirs::home_dir() {
    Some(home) => vec![
      home.join(".claude").join("skills"),
      codex_home(&home).join("skills"),
    ],
    None => Vec::new(),
  }
}

/// Guardrail for `remove_dir`: the target must be a direct child of a known
/// skills root (i.e. `<root>/<skill-id>`), canonicalized to defeat traversal.
/// Refuses anything else so this command can never recursively delete an
/// arbitrary directory handed to it by a frontend bug or a crafted path.
fn ensure_within_skills_dir(target: &Path) -> Result<(), String> {
  // Canonicalize the parent (the target itself is what we're about to delete;
  // its parent — the skills root — must exist and resolve to a real path).
  let parent = target
    .parent()
    .ok_or_else(|| "invalid skill path".to_string())?
    .canonicalize()
    .map_err(|e| e.to_string())?;
  for root in skills_roots() {
    if let Ok(root) = root.canonicalize() {
      if parent == root {
        return Ok(());
      }
    }
  }
  Err(format!(
    "refusing to remove path outside a skills dir: {}",
    target.to_string_lossy()
  ))
}

/// Remove a skill directory. No-op if absent. Validated against the skills-dir
/// whitelist so it can only ever delete `<skillsRoot>/<id>`, never an arbitrary
/// path.
#[tauri::command(async)]
pub fn remove_dir(path: String) -> Result<(), String> {
  let p = Path::new(&path);
  if !p.exists() {
    return Ok(());
  }
  ensure_within_skills_dir(p)?;
  fs::remove_dir_all(p).map_err(|e| e.to_string())?;
  Ok(())
}

/// Enumerate installed skills in a skills directory (used by the dashboard),
/// including ones added outside agentpack. A skill is a sub-directory containing
/// a `SKILL.md`; that marker is what makes the CLI recognize it, so filtering on
/// it keeps out non-skill clutter the old blanket listing surfaced — Codex's
/// hidden `.system` dir, scratch dirs like `tmp` / `*-workspace`, and stray
/// files — which would otherwise show a destructive ✕ remove button. Symlinked
/// skills count too (the `SKILL.md` check resolves through the link). Returns an
/// empty list when the path is missing or not a directory.
#[tauri::command(async)]
pub fn list_skills(path: String) -> Result<Vec<String>, String> {
  let p = Path::new(&path);
  if !p.is_dir() {
    return Ok(Vec::new());
  }
  let mut names = Vec::new();
  for entry in fs::read_dir(p).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let child = entry.path();
    // `is_dir` / `is_file` follow symlinks, so a symlinked skill dir counts.
    if child.is_dir() && child.join("SKILL.md").is_file() {
      names.push(entry.file_name().to_string_lossy().into_owned());
    }
  }
  Ok(names)
}

fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
  fs::create_dir_all(dest)?;
  for entry in fs::read_dir(src)? {
    let entry = entry?;
    let to = dest.join(entry.file_name());
    if entry.file_type()?.is_dir() {
      copy_dir(&entry.path(), &to)?;
    } else {
      fs::copy(entry.path(), to)?;
    }
  }
  Ok(())
}

/// Replace `dest` with a fresh copy of `src` (a clean replace, not a merge, so
/// files removed between skill versions don't linger as orphans).
///
/// Done atomically: the new copy is staged into a sibling temp dir and only
/// swapped in once the copy fully succeeds. A failure mid-copy therefore leaves
/// the existing install untouched, rather than the old delete-then-copy which
/// could leave a skill half-deleted / half-installed if the copy blew up.
fn replace_dir(src: &Path, dest: &Path) -> io::Result<()> {
  let name = dest
    .file_name()
    .and_then(|n| n.to_str())
    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid dest path"))?;
  let parent = dest
    .parent()
    .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid dest path"))?;
  let staging = parent.join(format!("{name}.agentpack.tmp"));

  if staging.exists() {
    fs::remove_dir_all(&staging)?;
  }
  if let Err(e) = copy_dir(src, &staging) {
    let _ = fs::remove_dir_all(&staging); // best-effort cleanup
    return Err(e);
  }
  if dest.exists() {
    fs::remove_dir_all(dest)?;
  }
  fs::rename(&staging, dest)
}

/// Copy a bundled skill (shipped under Tauri resources at `assets/skills/<id>`)
/// into each requested target's skills dir. Returns the destination paths.
/// A skill id must be a plain directory name — it is joined into both a resource
/// path and a delete target, so a traversal id (`../foo`) or a separator could
/// escape the skills dir. Reject empties, separators, and `..`.
fn is_safe_skill_id(id: &str) -> bool {
  !id.is_empty() && !id.contains('/') && !id.contains('\\') && !id.contains("..")
}

#[tauri::command(async)]
pub fn install_skill(app: AppHandle, id: String, targets: Vec<String>) -> Result<Vec<String>, String> {
  if !is_safe_skill_id(&id) {
    return Err(format!("invalid skill id: {id}"));
  }
  let base = app
    .path()
    .resource_dir()
    .map_err(|e| e.to_string())?
    .join("assets/skills")
    .join(&id);
  if !base.exists() {
    return Err(format!("bundled skill not found: {}", base.to_string_lossy()));
  }
  let home = dirs::home_dir().ok_or("no home dir")?;
  let codex = codex_home(&home);
  let mut dests = Vec::new();
  for t in targets {
    let dir: PathBuf = match t.as_str() {
      "claude" => home.join(".claude/skills"),
      "codex" => codex.join("skills"),
      other => return Err(format!("invalid skill target: {other}")),
    };
    let dest = dir.join(&id);
    replace_dir(&base, &dest).map_err(|e| e.to_string())?;
    dests.push(dest.to_string_lossy().into_owned());
  }
  Ok(dests)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Unique temp dir per test — no temp-dir crate in the project, so mirror the
  /// hand-rolled nanosecond-suffix pattern from backup.rs / ccswitch.rs tests.
  fn temp_dir(tag: &str) -> PathBuf {
    let n = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos();
    std::env::temp_dir().join(format!("apfs-{tag}-{n:032x}"))
  }

  #[test]
  fn replace_dir_drops_stale_files() {
    let base = temp_dir("replace");
    let src = base.join("src");
    let dest = base.join("dest");
    fs::create_dir_all(&src).unwrap();
    fs::write(src.join("keep.txt"), b"keep").unwrap();
    // Pre-existing dest holds a file that no longer exists in the new src.
    fs::create_dir_all(&dest).unwrap();
    fs::write(dest.join("stale.txt"), b"stale").unwrap();

    replace_dir(&src, &dest).unwrap();

    assert!(dest.join("keep.txt").exists(), "new file should be copied");
    assert!(!dest.join("stale.txt").exists(), "stale file should be removed");

    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn rejects_unsafe_skill_ids() {
    assert!(is_safe_skill_id("rust"));
    assert!(is_safe_skill_id("stm32-c"));
    assert!(!is_safe_skill_id(""));
    assert!(!is_safe_skill_id("../evil"));
    assert!(!is_safe_skill_id("a/b"));
    assert!(!is_safe_skill_id("a\\b"));
    assert!(!is_safe_skill_id(".."));
  }

  #[test]
  fn read_text_file_distinguishes_missing_from_unreadable() {
    let base = temp_dir("read");
    fs::create_dir_all(&base).unwrap();
    // A missing file is the expected "start from blank" case → empty string.
    let missing = base.join("nope.txt").to_string_lossy().into_owned();
    assert_eq!(read_text_file(missing).unwrap(), "");
    // A directory is present-but-not-readable-as-text → an error, never "".
    assert!(read_text_file(base.to_string_lossy().into_owned()).is_err());
    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn remove_dir_refuses_paths_outside_a_skills_dir() {
    let base = temp_dir("guard");
    let victim = base.join("important");
    fs::create_dir_all(&victim).unwrap();
    // Not under a known skills root → refused, and the directory is untouched.
    assert!(remove_dir(victim.to_string_lossy().into_owned()).is_err());
    assert!(victim.exists(), "guardrail must not delete an out-of-scope dir");
    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn replace_dir_leaves_no_staging_dir() {
    let base = temp_dir("stage");
    let src = base.join("src");
    let dest = base.join("dest");
    fs::create_dir_all(&src).unwrap();
    fs::write(src.join("f.txt"), b"x").unwrap();

    replace_dir(&src, &dest).unwrap();

    assert!(dest.join("f.txt").exists());
    // The staging sibling used during the atomic swap must be cleaned up.
    assert!(!base.join("dest.agentpack.tmp").exists());
    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn list_skills_returns_only_dirs_with_a_skill_md() {
    let root = temp_dir("skills");
    fs::create_dir_all(&root).unwrap();
    // A real skill: dir with SKILL.md.
    fs::create_dir_all(root.join("rust")).unwrap();
    fs::write(root.join("rust").join("SKILL.md"), b"# rust").unwrap();
    // Not skills: a dir without the marker, a hidden system dir, a stray file.
    fs::create_dir_all(root.join("tmp")).unwrap();
    fs::create_dir_all(root.join(".system")).unwrap();
    fs::write(root.join("README.md"), b"noise").unwrap();

    let mut got = list_skills(root.to_string_lossy().into_owned()).unwrap();
    got.sort();
    assert_eq!(got, vec!["rust".to_string()]);

    // A missing path is simply empty, never an error.
    assert!(list_skills(root.join("nope").to_string_lossy().into_owned())
      .unwrap()
      .is_empty());
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn write_text_file_is_atomic_and_leaves_no_temp() {
    let base = temp_dir("write");
    let target = base.join("nested").join("config.toml");
    let path = target.to_string_lossy().into_owned();

    // Parent dirs are created; the file gets the content.
    write_text_file(path.clone(), "first".into()).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "first");
    // Overwrite works, and the temp sibling is gone afterwards.
    write_text_file(path.clone(), "second".into()).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), "second");
    assert!(!Path::new(&format!("{path}.agentpack.tmp")).exists());

    let _ = fs::remove_dir_all(&base);
  }
}
