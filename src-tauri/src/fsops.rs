use crate::paths::codex_home;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Read a text file, returning "" when it does not exist (mirrors the TUI's
/// readTextOrEmpty so config merges start from a blank slate).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
  match fs::read_to_string(&path) {
    Ok(s) => Ok(s),
    Err(_) => Ok(String::new()),
  }
}

/// Write a text file, creating parent directories as needed.
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
  if let Some(parent) = Path::new(&path).parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(&path, content).map_err(|e| e.to_string())
}

/// Remove a directory tree (used to uninstall a skill). No-op if absent.
#[tauri::command]
pub fn remove_dir(path: String) -> Result<(), String> {
  if Path::new(&path).exists() {
    fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
  }
  Ok(())
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

/// Copy a bundled skill (shipped under Tauri resources at `assets/skills/<id>`)
/// into each requested target's skills dir. Returns the destination paths.
#[tauri::command]
pub fn install_skill(app: AppHandle, id: String, targets: Vec<String>) -> Result<Vec<String>, String> {
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
    let dir: PathBuf = if t == "claude" {
      home.join(".claude/skills")
    } else {
      codex.join("skills")
    };
    let dest = dir.join(&id);
    copy_dir(&base, &dest).map_err(|e| e.to_string())?;
    dests.push(dest.to_string_lossy().into_owned());
  }
  Ok(dests)
}
