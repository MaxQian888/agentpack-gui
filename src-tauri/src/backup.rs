use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// One backed-up file inside a snapshot: where it came from and its copy name.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
  original_path: String,
  stored_name: String,
  #[serde(default = "backup_file_existed_by_default")]
  existed: bool,
}

// Manifests created before absence tracking only contain copied files, so every
// legacy entry necessarily represents a file that existed at snapshot time.
fn backup_file_existed_by_default() -> bool {
  true
}

/// A single timestamped snapshot of the cc-switch DB + live agent configs.
/// Serialized camelCase to match the TS `BackupEntry` in `lib/tauri/commands.ts`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
  /// Snapshot directory name (e.g. `snapshot-1700000000000`); the restore key.
  pub(crate) id: String,
  ts: u128,
  reason: String,
  files: Vec<BackupFile>,
}

/// Root under which every snapshot folder lives. Backups are Agentpack-owned
/// even when the selected provider store is CC Switch, so native mode never
/// creates a surprising `~/.cc-switch` directory.
fn backup_root() -> PathBuf {
  if let Ok(p) = std::env::var("AGENTPACK_BACKUP_ROOT") {
    return PathBuf::from(p);
  }
  dirs::home_dir()
    .unwrap_or_default()
    .join(".agentpack/backups/providers")
}

fn legacy_backup_root() -> PathBuf {
  dirs::home_dir()
    .unwrap_or_default()
    .join(".cc-switch/backups/agentpack")
}

fn backup_roots() -> Vec<PathBuf> {
  let current = backup_root();
  if std::env::var("AGENTPACK_BACKUP_ROOT").is_ok() {
    return vec![current];
  }
  let legacy = legacy_backup_root();
  if legacy == current {
    vec![current]
  } else {
    vec![current, legacy]
  }
}

/// How many snapshots to keep. Every provider write takes one, so without a cap the
/// folder grows for the life of the install.
const MAX_SNAPSHOTS: usize = 20;

/// Absolute paths agentpack snapshots: the cc-switch DB plus the live agent
/// configs it can rewrite. Only files that exist are copied.
///
/// `~/.codex/auth.json` is deliberately absent. It holds the official ChatGPT login
/// (OAuth refresh token in plaintext) and agentpack never writes it, so copying it on
/// every provider write would scatter credentials for no rollback value — and
/// restoring a stale refresh token can log the user out.
fn live_config_files() -> Vec<PathBuf> {
  let home = dirs::home_dir().unwrap_or_default();
  let codex = crate::paths::codex_home(&home);
  vec![
    home.join(".claude/settings.json"),
    codex.join("config.toml"),
    home.join(".config/opencode/opencode.json"),
  ]
}

fn tracked_files() -> Vec<PathBuf> {
  let mut files = vec![crate::ccswitch::db_path()];
  files.extend(live_config_files());
  files
}

fn native_tracked_files() -> Vec<PathBuf> {
  let mut files = vec![crate::providers::native_store_path()];
  files.extend(live_config_files());
  files
}

fn restorable_files() -> Vec<PathBuf> {
  let mut files = tracked_files();
  for path in native_tracked_files() {
    if !files.contains(&path) {
      files.push(path);
    }
  }
  files
}

/// Drop all but the newest `MAX_SNAPSHOTS` snapshots. Best-effort: a folder that
/// won't delete is skipped rather than failing the write that triggered it.
fn prune() {
  let Ok(entries) = backup_list() else { return };
  let root = backup_root();
  for stale in entries.iter().skip(MAX_SNAPSHOTS) {
    let _ = fs::remove_dir_all(root.join(&stale.id));
  }
}

fn now_millis() -> u128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
}

/// Nanosecond stamp for the snapshot folder name. A provider write snapshots and then
/// writes, so two snapshots can land inside the same millisecond — with a
/// millisecond-named folder the second would silently overwrite the first, losing the
/// rollback point it was taken for.
fn now_nanos() -> u128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos()
}

/// Snapshot the tracked files into a new timestamped folder. Internal helper so
/// `cc_write_provider` and the sync flow can snapshot before mutating.
pub(crate) fn snapshot(reason: &str) -> Result<BackupEntry, String> {
  snapshot_files(reason, &tracked_files())
}

pub(crate) fn snapshot_native(reason: &str) -> Result<BackupEntry, String> {
  snapshot_files(reason, &native_tracked_files())
}

fn snapshot_files(reason: &str, files: &[PathBuf]) -> Result<BackupEntry, String> {
  let ts = now_millis();
  let id = format!("snapshot-{}", now_nanos());
  let dir = backup_root().join(&id);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let mut entry_files = Vec::new();
  for (i, src) in files.iter().enumerate() {
    if !src.exists() {
      entry_files.push(BackupFile {
        original_path: src.to_string_lossy().into_owned(),
        stored_name: String::new(),
        existed: false,
      });
      continue;
    }
    let base = src
      .file_name()
      .map(|s| s.to_string_lossy().into_owned())
      .unwrap_or_else(|| "file".into());
    // Prefix with the index so two tracked files with the same base name (never
    // today, but cheap insurance) can't collide inside the snapshot folder.
    let stored = format!("{i}-{base}");
    fs::copy(src, dir.join(&stored)).map_err(|e| e.to_string())?;
    entry_files.push(BackupFile {
      original_path: src.to_string_lossy().into_owned(),
      stored_name: stored,
      existed: true,
    });
  }

  let entry = BackupEntry {
    id,
    ts,
    reason: reason.to_string(),
    files: entry_files,
  };
  let manifest = serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?;
  fs::write(dir.join("manifest.json"), manifest).map_err(|e| e.to_string())?;
  prune();
  Ok(entry)
}

/// Take a snapshot on demand (e.g. before a manual live-config sync).
#[tauri::command(async)]
pub fn backup_snapshot(reason: String, backend: Option<String>) -> Result<BackupEntry, String> {
  if backend.as_deref() == Some("native") {
    snapshot_native(&reason)
  } else {
    snapshot(&reason)
  }
}

/// List every snapshot, newest first. Folders without a readable manifest are
/// skipped rather than failing the whole listing.
#[tauri::command(async)]
pub fn backup_list() -> Result<Vec<BackupEntry>, String> {
  let mut out = Vec::new();
  for root in backup_roots() {
    if !root.is_dir() {
      continue;
    }
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
      let entry = entry.map_err(|e| e.to_string())?;
      let manifest = entry.path().join("manifest.json");
      if let Ok(text) = fs::read_to_string(&manifest) {
        if let Ok(be) = serde_json::from_str::<BackupEntry>(&text) {
          out.push(be);
        }
      }
    }
  }
  out.sort_by_key(|b| std::cmp::Reverse(b.ts));
  Ok(out)
}

fn cc_switch_running() -> bool {
  if std::env::var("AGENTPACK_SKIP_RUNNING_CHECK").as_deref() == Ok("1") {
    return false;
  }
  crate::exec::is_process_running("cc-switch".into())
}

/// What a restore did, and how to undo it.
///
/// The safety snapshot was always taken; it just used to be thrown away, which
/// left the one operation whose whole purpose is "go back" as the one operation
/// you could not go back from. Returning its id is what lets the UI record a
/// restore point for the restore itself.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
  /// One line per file: the path written, or a "skipped (not managed)" note.
  pub restored_paths: Vec<String>,
  /// The snapshot taken immediately before this restore.
  pub safety_snapshot_id: String,
}

/// Restore every file recorded in a snapshot back to its original path. Takes a
/// fresh "before restore" snapshot first so the restore itself is reversible.
/// Refuses while cc-switch is running to avoid corrupting the DB underneath it.
#[tauri::command(async)]
pub fn backup_restore(id: String) -> Result<RestoreResult, String> {
  let dir = backup_roots()
    .into_iter()
    .map(|root| root.join(&id))
    .find(|candidate| candidate.join("manifest.json").is_file())
    .ok_or_else(|| "backup not found".to_string())?;
  let text =
    fs::read_to_string(dir.join("manifest.json")).map_err(|_| "backup not found".to_string())?;
  let entry: BackupEntry = serde_json::from_str(&text).map_err(|e| e.to_string())?;

  if cc_switch_running()
    && entry
      .files
      .iter()
      .any(|file| Path::new(&file.original_path) == crate::ccswitch::db_path())
  {
    return Err("cc-switch is running — close it before restoring its database.".into());
  }

  let allowed = restorable_files();
  let destinations: Vec<PathBuf> = entry
    .files
    .iter()
    .map(|file| PathBuf::from(&file.original_path))
    .filter(|path| allowed.contains(path))
    .collect();
  let safety = snapshot_files("before restore", &destinations)?;

  let mut restored = Vec::new();
  for f in &entry.files {
    let dest = PathBuf::from(&f.original_path);
    // Snapshots taken by an older agentpack also captured ~/.codex/auth.json. Putting
    // that back would roll the official login to an older refresh token and can sign
    // the user out, so a restore only ever rewrites what agentpack currently manages.
    if !allowed.contains(&dest) {
      restored.push(format!("skipped (not managed): {}", f.original_path));
      continue;
    }
    if !f.existed {
      if dest.exists() {
        fs::remove_file(&dest).map_err(|e| e.to_string())?;
        restored.push(format!("removed: {}", f.original_path));
      } else {
        restored.push(format!("already absent: {}", f.original_path));
      }
      continue;
    }
    if let Some(parent) = dest.parent() {
      fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(dir.join(&f.stored_name), &dest).map_err(|e| e.to_string())?;
    restored.push(f.original_path.clone());
  }
  Ok(RestoreResult {
    restored_paths: restored,
    safety_snapshot_id: safety.id,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn snapshot_list_restore_roundtrip() {
    // Shared with ccswitch tests: both mutate the same global env vars.
    let _g = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let _env = crate::TestEnvGuard;

    let tmp = std::env::temp_dir().join(format!("apbk-{}", now_millis()));
    let root = tmp.join("backups");
    let db = tmp.join("cc-switch.db");
    fs::create_dir_all(&tmp).unwrap();
    fs::write(&db, b"ORIGINAL").unwrap();

    std::env::set_var("AGENTPACK_BACKUP_ROOT", &root);
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &db);
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");

    // Snapshot the original DB contents.
    let entry = snapshot("test").unwrap();
    assert!(entry
      .files
      .iter()
      .any(|f| f.original_path == db.to_string_lossy()));

    // Mutate the DB, then confirm the snapshot is listed and restores the original.
    fs::write(&db, b"CHANGED").unwrap();
    let list = backup_list().unwrap();
    assert!(list.iter().any(|e| e.id == entry.id));

    let result = backup_restore(entry.id.clone()).unwrap();
    assert_eq!(fs::read(&db).unwrap(), b"ORIGINAL");

    // The restore is itself reversible: it hands back the snapshot it took of
    // the pre-restore state, and that snapshot really holds the mutated bytes.
    assert!(!result.safety_snapshot_id.is_empty());
    assert_ne!(result.safety_snapshot_id, entry.id);
    let safety = backup_list()
      .unwrap()
      .into_iter()
      .find(|e| e.id == result.safety_snapshot_id)
      .expect("safety snapshot is listed");
    assert_eq!(safety.reason, "before restore");
    let stored = safety
      .files
      .iter()
      .find(|f| f.original_path == db.to_string_lossy())
      .expect("safety snapshot captured the db");
    assert_eq!(
      fs::read(root.join(&safety.id).join(&stored.stored_name)).unwrap(),
      b"CHANGED"
    );

    // And restoring THAT undoes the undo, which is the property the UI's
    // "restore point" promise depends on.
    backup_restore(result.safety_snapshot_id.clone()).unwrap();
    assert_eq!(fs::read(&db).unwrap(), b"CHANGED");

    let _ = fs::remove_dir_all(&tmp);
  }

  #[test]
  fn restore_removes_a_file_that_was_absent_at_snapshot_time() {
    let _g = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let _env = crate::TestEnvGuard;

    let tmp = std::env::temp_dir().join(format!("apbk-absent-{}", now_nanos()));
    let root = tmp.join("backups");
    let db = tmp.join("cc-switch.db");
    fs::create_dir_all(&tmp).unwrap();
    std::env::set_var("AGENTPACK_BACKUP_ROOT", &root);
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &db);
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");

    let entry = snapshot_files("before first write", std::slice::from_ref(&db)).unwrap();
    let recorded = entry
      .files
      .iter()
      .find(|file| file.original_path == db.to_string_lossy())
      .expect("absent destination is recorded");
    assert!(!recorded.existed);

    fs::write(&db, b"FIRST WRITE").unwrap();
    let result = backup_restore(entry.id).unwrap();
    assert!(!db.exists());
    assert!(result
      .restored_paths
      .iter()
      .any(|line| line.starts_with("removed:")));

    // The safety snapshot keeps the restore reversible even when the target
    // action was deleting a file that did not exist originally.
    backup_restore(result.safety_snapshot_id).unwrap();
    assert_eq!(fs::read(&db).unwrap(), b"FIRST WRITE");

    let _ = fs::remove_dir_all(&tmp);
  }

  #[test]
  fn snapshots_are_capped_and_never_carry_credentials() {
    let _g = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let _env = crate::TestEnvGuard;

    let tmp = std::env::temp_dir().join(format!("apbk-cap-{}", now_nanos()));
    let root = tmp.join("backups");
    let db = tmp.join("cc-switch.db");
    fs::create_dir_all(&tmp).unwrap();
    fs::write(&db, b"X").unwrap();
    std::env::set_var("AGENTPACK_BACKUP_ROOT", &root);
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &db);

    // auth.json holds the official ChatGPT login; agentpack never writes it, so it
    // must never be copied into a snapshot either.
    assert!(
      !tracked_files().iter().any(|p| p.ends_with("auth.json")),
      "auth.json must not be snapshotted"
    );

    for _ in 0..(MAX_SNAPSHOTS + 5) {
      snapshot("cap test").unwrap();
    }
    assert_eq!(backup_list().unwrap().len(), MAX_SNAPSHOTS);

    let _ = fs::remove_dir_all(&tmp);
  }

  #[test]
  fn restore_skips_files_agentpack_no_longer_manages() {
    let _g = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    let _env = crate::TestEnvGuard;

    let tmp = std::env::temp_dir().join(format!("apbk-skip-{}", now_nanos()));
    let root = tmp.join("backups");
    let db = tmp.join("cc-switch.db");
    let auth = tmp.join("auth.json");
    fs::create_dir_all(&tmp).unwrap();
    fs::write(&db, b"DB").unwrap();
    fs::write(&auth, b"OLD-LOGIN").unwrap();
    std::env::set_var("AGENTPACK_BACKUP_ROOT", &root);
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &db);
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");

    // Stands in for a snapshot taken by an older agentpack, which also captured
    // ~/.codex/auth.json.
    let entry = snapshot_files("legacy", &[db.clone(), auth.clone()]).unwrap();
    fs::write(&auth, b"CURRENT-LOGIN").unwrap();

    let log = backup_restore(entry.id.clone()).unwrap().restored_paths;
    // The DB rolls back; the credential file is left exactly as it is.
    assert_eq!(fs::read(&db).unwrap(), b"DB");
    assert_eq!(fs::read(&auth).unwrap(), b"CURRENT-LOGIN");
    assert!(log.iter().any(|l| l.contains("skipped")), "log: {log:?}");

    let _ = fs::remove_dir_all(&tmp);
  }
}
