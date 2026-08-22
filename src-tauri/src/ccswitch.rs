use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Columns agentpack reads/writes — `assert_schema` refuses a DB missing any.
/// `website_url` belongs here even though nothing else in this file validates it:
/// `cc_load_providers` SELECTs it, so leaving it out let an old DB pass the check
/// and then fail mid-query with a raw SQLite error instead of the guidance below.
const REQUIRED: &[&str] = &[
  "id",
  "app_type",
  "name",
  "settings_config",
  "website_url",
  "category",
  "created_at",
  "sort_index",
  "notes",
  "meta",
  "is_current",
];

/// The `providers` table as cc-switch declares it. Used only to create the DB when
/// cc-switch has never been launched (or isn't installed) — agentpack never
/// migrates an existing one.
const PROVIDERS_DDL: &str = "CREATE TABLE IF NOT EXISTS providers (
  id TEXT NOT NULL,
  app_type TEXT NOT NULL,
  name TEXT NOT NULL,
  settings_config TEXT NOT NULL,
  website_url TEXT,
  category TEXT,
  created_at INTEGER,
  sort_index INTEGER,
  notes TEXT,
  icon TEXT,
  icon_color TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  is_current BOOLEAN NOT NULL DEFAULT 0,
  in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (id, app_type)
)";

// NOTE: snake_case fields (no rename) to match the ported TS `Provider` type
// (app_type, settings_config, website_url, is_current).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Provider {
  pub(crate) id: String,
  pub(crate) app_type: String,
  pub(crate) name: String,
  pub(crate) settings_config: String,
  pub(crate) website_url: Option<String>,
  pub(crate) notes: Option<String>,
  pub(crate) is_current: bool,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderForm {
  pub(crate) name: String,
  pub(crate) website_url: Option<String>,
  pub(crate) notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteReq {
  pub(crate) op: String,
  pub(crate) dry_run: bool,
  pub(crate) id: Option<String>,
  pub(crate) app: String,
  pub(crate) form: Option<ProviderForm>,
  pub(crate) settings_config: Option<String>,
}

/// Location of the cc-switch SQLite DB. `pub(crate)` so the backup module
/// snapshots the exact same file agentpack writes (no path divergence).
pub(crate) fn db_path() -> PathBuf {
  if let Ok(p) = std::env::var("AGENTPACK_CCSWITCH_DB") {
    return PathBuf::from(p);
  }
  dirs::home_dir()
    .unwrap_or_default()
    .join(".cc-switch/cc-switch.db")
}

fn exists() -> bool {
  db_path().exists()
}

fn provider_columns(conn: &Connection) -> Result<Vec<String>, String> {
  let mut cols = Vec::new();
  let mut stmt = conn
    .prepare("PRAGMA table_info(providers)")
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |r| r.get::<_, String>(1))
    .map_err(|e| e.to_string())?;
  for r in rows {
    cols.push(r.map_err(|e| e.to_string())?);
  }
  Ok(cols)
}

/// Columns from `REQUIRED` the `providers` table lacks. Empty => usable.
fn missing_columns(conn: &Connection) -> Result<Vec<String>, String> {
  let cols = provider_columns(conn)?;
  let missing = REQUIRED.iter().filter(|c| !cols.iter().any(|x| x == *c));
  Ok(missing.map(|c| (*c).to_string()).collect())
}

fn assert_schema(conn: &Connection) -> Result<(), String> {
  if missing_columns(conn)?.is_empty() {
    return Ok(());
  }
  Err(
    "this cc-switch database predates the columns agentpack needs. Launch cc-switch \
     once — it migrates the database on startup — then come back."
      .into(),
  )
}

/// What agentpack can tell about the cc-switch DB without touching it, so the UI can
/// distinguish "never created" (offer to create it) from "too old" (tell the user to
/// launch cc-switch) instead of showing one opaque error for both.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaStatus {
  exists: bool,
  /// `PRAGMA user_version`; 0 for a DB agentpack created itself.
  user_version: i64,
  missing_columns: Vec<String>,
}

#[tauri::command(async)]
pub fn cc_schema_status() -> Result<SchemaStatus, String> {
  if !exists() {
    return Ok(SchemaStatus {
      exists: false,
      user_version: 0,
      missing_columns: Vec::new(),
    });
  }
  let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
  let user_version: i64 = conn
    .query_row("PRAGMA user_version", [], |r| r.get(0))
    .unwrap_or(0);
  Ok(SchemaStatus {
    exists: true,
    user_version,
    missing_columns: missing_columns(&conn)?,
  })
}

/// Create the cc-switch database when it doesn't exist yet, so managing providers
/// doesn't require installing and launching cc-switch first. No-op if the file is
/// already there — agentpack never migrates someone else's database.
///
/// `user_version` is deliberately left at 0 rather than pinned to cc-switch's current
/// SCHEMA_VERSION. cc-switch refuses to start against a database whose version is
/// *newer* than the one it knows, so claiming a version would brick an older
/// cc-switch; leaving it at 0 makes cc-switch replay its migrations, which are
/// idempotent (`add_column_if_missing`), and then stamp its own version.
#[tauri::command(async)]
pub fn cc_init_db() -> Result<(), String> {
  if exists() {
    return Ok(());
  }
  if let Some(parent) = db_path().parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
  conn.execute_batch(PROVIDERS_DDL).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn cc_load_providers() -> Result<Vec<Provider>, String> {
  if !exists() {
    return Ok(vec![]);
  }
  let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
  assert_schema(&conn)?;
  let mut stmt = conn
    .prepare(
      "SELECT id, app_type, name, settings_config, website_url, notes, is_current \
       FROM providers WHERE app_type IN ('claude','codex','opencode') \
       ORDER BY app_type, sort_index",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |r| {
      Ok(Provider {
        id: r.get(0)?,
        app_type: r.get(1)?,
        name: r.get(2)?,
        settings_config: r.get(3)?,
        website_url: r.get(4)?,
        notes: r.get(5)?,
        is_current: r.get::<_, i64>(6)? != 0,
      })
    })
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

fn is_running() -> bool {
  if std::env::var("AGENTPACK_SKIP_RUNNING_CHECK").as_deref() == Ok("1") {
    return false;
  }
  crate::exec::is_process_running("cc-switch".into())
}

pub(crate) fn unique_id() -> String {
  let n = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos();
  format!("{n:032x}")
}

/// Add / update / delete / set-current a provider, with cc-switch's guardrails.
/// Dry-run opens read-only and returns "would run" lines without touching the DB.
#[tauri::command(async)]
pub fn cc_write_provider(req: WriteReq) -> Result<Vec<String>, String> {
  if !exists() {
    return Err("cc-switch database not found. Launch cc-switch once, then return here.".into());
  }
  let mut log = Vec::new();

  if req.dry_run {
    let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    assert_schema(&conn)?;
    log.push(format!("would run: {} provider ({})", req.op, req.app));
    return Ok(log);
  }

  if is_running() {
    return Err("cc-switch is running — close it before changing providers.".into());
  }
  // Snapshot the DB (and live configs) into the listable backup history before
  // any mutation, so a bad write can be rolled back from the dashboard.
  let snap = crate::backup::snapshot("provider write")?;
  log.push(format!("backed up → {}", snap.id));

  let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
  assert_schema(&conn)?;
  conn.execute("BEGIN", []).map_err(|e| e.to_string())?;

  let result = run_op(&conn, &req);
  match result {
    Ok(mut out) => {
      conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
      log.append(&mut out);
      Ok(log)
    }
    Err(e) => {
      let _ = conn.execute("ROLLBACK", []);
      Err(e)
    }
  }
}

fn run_op(conn: &Connection, req: &WriteReq) -> Result<Vec<String>, String> {
  match req.op.as_str() {
    "add" => {
      let form = req.form.as_ref().ok_or("missing form")?;
      let settings = req
        .settings_config
        .clone()
        .ok_or("missing settings_config")?;
      let id = unique_id();
      let sort: i64 = conn
        .query_row(
          "SELECT COALESCE(MAX(sort_index),-1)+1 FROM providers WHERE app_type=?1",
          [&req.app],
          |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
      let has_current: i64 = conn
        .query_row(
          "SELECT COUNT(*) FROM providers WHERE app_type=?1 AND is_current=1",
          [&req.app],
          |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
      let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
      conn
        .execute(
          "INSERT INTO providers (id, app_type, name, settings_config, website_url, category, \
           created_at, sort_index, notes, meta, is_current, in_failover_queue) \
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
          rusqlite::params![
            id,
            req.app,
            form.name,
            settings,
            form.website_url,
            Option::<String>::None,
            now,
            sort,
            form.notes,
            "{}",
            if has_current == 0 { 1 } else { 0 },
            0
          ],
        )
        .map_err(|e| e.to_string())?;
      Ok(vec![format!(
        "added provider \"{}\" ({})",
        form.name, req.app
      )])
    }
    "update" => {
      let form = req.form.as_ref().ok_or("missing form")?;
      let id = req.id.as_ref().ok_or("missing id")?;
      let settings = req
        .settings_config
        .clone()
        .ok_or("missing settings_config")?;
      let n = conn
        .execute(
          "UPDATE providers SET name=?1, settings_config=?2, website_url=?3, notes=?4 \
           WHERE id=?5 AND app_type=?6",
          rusqlite::params![
            form.name,
            settings,
            form.website_url,
            form.notes,
            id,
            req.app
          ],
        )
        .map_err(|e| e.to_string())?;
      if n == 0 {
        return Err(
          "provider not found — it may have been removed in cc-switch. Reload and try again."
            .into(),
        );
      }
      Ok(vec![format!(
        "updated provider \"{}\" ({})",
        form.name, req.app
      )])
    }
    "delete" => {
      let id = req.id.as_ref().ok_or("missing id")?;
      let cur: i64 = conn
        .query_row(
          "SELECT is_current FROM providers WHERE id=?1 AND app_type=?2",
          [id, &req.app],
          |r| r.get(0),
        )
        .unwrap_or(0);
      if cur != 0 {
        return Err(
          "cannot delete the active provider — switch to another provider in cc-switch first."
            .into(),
        );
      }
      conn
        .execute(
          "DELETE FROM providers WHERE id=?1 AND app_type=?2",
          [id, &req.app],
        )
        .map_err(|e| e.to_string())?;
      Ok(vec![format!("deleted provider ({})", req.app)])
    }
    "setCurrent" => {
      let id = req.id.as_ref().ok_or("missing id")?;
      conn
        .execute(
          "UPDATE providers SET is_current=0 WHERE app_type=?1",
          [&req.app],
        )
        .map_err(|e| e.to_string())?;
      let n = conn
        .execute(
          "UPDATE providers SET is_current=1 WHERE id=?1 AND app_type=?2",
          [id, &req.app],
        )
        .map_err(|e| e.to_string())?;
      if n == 0 {
        // The target row vanished after we cleared the flags — abort so the
        // transaction rolls back and no app is left without a current provider.
        return Err(
          "provider not found — it may have been removed in cc-switch. Reload and try again."
            .into(),
        );
      }
      Ok(vec![format!("set current provider ({})", req.app)])
    }
    other => Err(format!("unknown op {other}")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use rusqlite::Connection;

  // cc_write_provider reads the DB path from a process-global env var, so the
  // env-touching tests must not run concurrently — with each other or with the
  // backup tests (both mutate the same vars). Use the crate-wide lock.
  use crate::{TestEnvGuard, TEST_ENV_LOCK as ENV_LOCK};

  fn seed(path: &str) {
    let c = Connection::open(path).unwrap();
    c.execute_batch(
      "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, \
       website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT, \
       meta TEXT, is_current INTEGER, in_failover_queue INTEGER);",
    )
    .unwrap();
  }

  /// Seed a fresh DB, point the env var at it, and skip the running-process check.
  ///
  /// The returned guard clears the vars on drop — bind it (`let (p, _g) = …`)
  /// rather than discarding it, or they leak into the next test even when this
  /// one passes.
  fn setup_db() -> (String, TestEnvGuard) {
    let p = std::env::temp_dir()
      .join(format!("ccsw-{}.db", unique_id()))
      .to_string_lossy()
      .to_string();
    seed(&p);
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &p);
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");
    // Keep the pre-write snapshot (crate::backup::snapshot) out of the real home.
    std::env::set_var("AGENTPACK_BACKUP_ROOT", format!("{p}.backups"));
    (p, TestEnvGuard)
  }

  fn form(name: &str) -> Option<ProviderForm> {
    Some(ProviderForm {
      name: name.into(),
      website_url: None,
      notes: None,
    })
  }

  #[test]
  fn add_then_load() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (p, _env) = setup_db();

    let req = WriteReq {
      op: "add".into(),
      dry_run: false,
      id: None,
      app: "claude".into(),
      form: form("Test"),
      settings_config: Some("{\"env\":{}}".into()),
    };
    cc_write_provider(req).unwrap();

    let list = cc_load_providers().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Test");
    assert!(list[0].is_current); // first provider becomes current

    let _ = std::fs::remove_file(&p);
  }

  #[test]
  fn update_missing_row_errors() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (p, _env) = setup_db();

    // No row with this id exists → the UPDATE touches 0 rows and must surface a
    // stale-state error rather than reporting a phantom success.
    let req = WriteReq {
      op: "update".into(),
      dry_run: false,
      id: Some("does-not-exist".into()),
      app: "claude".into(),
      form: form("Ghost"),
      settings_config: Some("{\"env\":{}}".into()),
    };
    let err = cc_write_provider(req).unwrap_err();
    assert!(err.contains("not found"), "unexpected error: {err}");

    let _ = std::fs::remove_file(&p);
  }

  /// Point the env vars at a path without creating the file, so `cc_init_db` is the
  /// thing that brings the database into existence.
  fn setup_empty() -> (String, TestEnvGuard) {
    let p = std::env::temp_dir()
      .join(format!("ccsw-{}.db", unique_id()))
      .to_string_lossy()
      .to_string();
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &p);
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");
    std::env::set_var("AGENTPACK_BACKUP_ROOT", format!("{p}.backups"));
    (p, TestEnvGuard)
  }

  fn add_req(name: &str) -> WriteReq {
    WriteReq {
      op: "add".into(),
      dry_run: false,
      id: None,
      app: "claude".into(),
      form: form(name),
      settings_config: Some("{\"env\":{}}".into()),
    }
  }

  #[test]
  fn init_db_creates_a_usable_database() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (p, _env) = setup_empty();

    assert!(!cc_schema_status().unwrap().exists);
    cc_init_db().unwrap();

    let st = cc_schema_status().unwrap();
    assert!(st.exists);
    assert!(
      st.missing_columns.is_empty(),
      "missing: {:?}",
      st.missing_columns
    );
    // Left at 0 on purpose: claiming a version would brick an older cc-switch,
    // which refuses to start against a database newer than it understands.
    assert_eq!(st.user_version, 0);

    // The freshly created schema must actually accept a write, not just look right.
    cc_write_provider(add_req("Fresh")).unwrap();
    assert_eq!(cc_load_providers().unwrap().len(), 1);

    let _ = std::fs::remove_file(&p);
  }

  #[test]
  fn init_db_never_touches_an_existing_database() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (p, _env) = setup_db();
    cc_write_provider(add_req("Keep")).unwrap();

    cc_init_db().unwrap();
    let list = cc_load_providers().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Keep");

    let _ = std::fs::remove_file(&p);
  }

  /// `REQUIRED` and `PROVIDERS_DDL` declare the column set independently — the
  /// DDL is a faithful copy of cc-switch's own table (it carries `icon`,
  /// `icon_color`, `in_failover_queue`, which agentpack never reads), so neither
  /// can be generated from the other. This is the guard instead: add a column to
  /// `REQUIRED` and forget the DDL, and `cc_init_db` would build a database that
  /// `assert_schema` rejects on the very next call.
  #[test]
  fn our_own_ddl_satisfies_our_own_schema_check() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (p, _env) = setup_empty();

    cc_init_db().unwrap();
    let conn = Connection::open(&p).unwrap();
    assert!(
      missing_columns(&conn).unwrap().is_empty(),
      "PROVIDERS_DDL is missing columns REQUIRED lists: {:?}",
      missing_columns(&conn).unwrap()
    );

    let _ = std::fs::remove_file(&p);
  }

  #[test]
  fn an_old_schema_is_named_not_just_rejected() {
    let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (p, _env) = setup_empty();
    // `website_url` is SELECTed by cc_load_providers but used to be absent from
    // REQUIRED, so a DB like this passed the check and then failed mid-query.
    Connection::open(&p)
      .unwrap()
      .execute_batch(
        "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, \
         category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT, meta TEXT, \
         is_current INTEGER);",
      )
      .unwrap();

    let st = cc_schema_status().unwrap();
    assert_eq!(st.missing_columns, vec!["website_url".to_string()]);

    let err = cc_load_providers().expect_err("old schema must be rejected");
    assert!(err.contains("Launch cc-switch"), "unexpected error: {err}");

    let _ = std::fs::remove_file(&p);
  }
}
