use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Columns agentpack reads/writes — `assert_schema` refuses a DB missing any.
const REQUIRED: &[&str] = &[
  "id",
  "app_type",
  "name",
  "settings_config",
  "category",
  "created_at",
  "sort_index",
  "notes",
  "meta",
  "is_current",
];

// NOTE: snake_case fields (no rename) to match the ported TS `Provider` type
// (app_type, settings_config, website_url, is_current).
#[derive(Serialize)]
pub struct Provider {
  id: String,
  app_type: String,
  name: String,
  settings_config: String,
  website_url: Option<String>,
  notes: Option<String>,
  is_current: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderForm {
  name: String,
  website_url: Option<String>,
  notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteReq {
  op: String,
  dry_run: bool,
  id: Option<String>,
  app: String,
  form: Option<ProviderForm>,
  settings_config: Option<String>,
}

fn db_path() -> PathBuf {
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

fn assert_schema(conn: &Connection) -> Result<(), String> {
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
  for c in REQUIRED {
    if !cols.iter().any(|x| x == c) {
      return Err(
        "unsupported cc-switch database schema — update agentpack before editing providers.".into(),
      );
    }
  }
  Ok(())
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
       FROM providers WHERE app_type IN ('claude','codex') ORDER BY app_type, sort_index",
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

fn backup() -> Result<String, String> {
  let p = db_path();
  let stamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|e| e.to_string())?
    .as_millis();
  let dest = format!("{}.bak-{}", p.to_string_lossy(), stamp);
  std::fs::copy(&p, &dest).map_err(|e| e.to_string())?;
  Ok(dest)
}

fn unique_id() -> String {
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
  log.push(format!("backed up database → {}", backup()?));

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
      let settings = req.settings_config.clone().ok_or("missing settings_config")?;
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
      Ok(vec![format!("added provider \"{}\" ({})", form.name, req.app)])
    }
    "update" => {
      let form = req.form.as_ref().ok_or("missing form")?;
      let id = req.id.as_ref().ok_or("missing id")?;
      let settings = req.settings_config.clone().ok_or("missing settings_config")?;
      conn
        .execute(
          "UPDATE providers SET name=?1, settings_config=?2, website_url=?3, notes=?4 \
           WHERE id=?5 AND app_type=?6",
          rusqlite::params![form.name, settings, form.website_url, form.notes, id, req.app],
        )
        .map_err(|e| e.to_string())?;
      Ok(vec![format!("updated provider \"{}\" ({})", form.name, req.app)])
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
        .execute("DELETE FROM providers WHERE id=?1 AND app_type=?2", [id, &req.app])
        .map_err(|e| e.to_string())?;
      Ok(vec![format!("deleted provider ({})", req.app)])
    }
    "setCurrent" => {
      let id = req.id.as_ref().ok_or("missing id")?;
      conn
        .execute("UPDATE providers SET is_current=0 WHERE app_type=?1", [&req.app])
        .map_err(|e| e.to_string())?;
      conn
        .execute(
          "UPDATE providers SET is_current=1 WHERE id=?1 AND app_type=?2",
          [id, &req.app],
        )
        .map_err(|e| e.to_string())?;
      Ok(vec![format!("set current provider ({})", req.app)])
    }
    other => Err(format!("unknown op {other}")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use rusqlite::Connection;

  fn seed(path: &str) {
    let c = Connection::open(path).unwrap();
    c.execute_batch(
      "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, \
       website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT, \
       meta TEXT, is_current INTEGER, in_failover_queue INTEGER);",
    )
    .unwrap();
  }

  #[test]
  fn add_then_load() {
    let p = std::env::temp_dir()
      .join(format!("ccsw-{}.db", unique_id()))
      .to_string_lossy()
      .to_string();
    seed(&p);
    std::env::set_var("AGENTPACK_CCSWITCH_DB", &p);
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");

    let req = WriteReq {
      op: "add".into(),
      dry_run: false,
      id: None,
      app: "claude".into(),
      form: Some(ProviderForm {
        name: "Test".into(),
        website_url: None,
        notes: None,
      }),
      settings_config: Some("{\"env\":{}}".into()),
    };
    cc_write_provider(req).unwrap();

    let list = cc_load_providers().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Test");
    assert!(list[0].is_current); // first provider becomes current

    std::env::remove_var("AGENTPACK_CCSWITCH_DB");
    let _ = std::fs::remove_file(&p);
  }
}
