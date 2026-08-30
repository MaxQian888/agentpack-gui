//! OpenCode history reader.
//!
//! Unlike the two JSONL sources, OpenCode keeps everything in one SQLite
//! database with `session` / `message` / `part` tables and precomputed
//! per-session token and cost columns — so the summary scan is a single query
//! rather than a parse, and the cost it reports is a real billed figure rather
//! than an estimate.
//!
//! Opened **read-only** on purpose: OpenCode may be running against the same
//! file, and this app is never the writer.

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

use super::util::{basename, s, u};
use super::{
  model_index, pack_event, Message, Part, SessionDetail, SessionSeries, SessionSummary, TokenUsage,
  ToolTally,
};

/// First existing OpenCode data directory across the platform-specific
/// candidates. OpenCode follows XDG on all platforms, but honors overrides.
///
/// The candidate list is shared with `cleanup`, which offers to clear this very
/// database: two independent lists would eventually drift, and then the cleanup
/// section would clean a directory the dashboard never read from.
fn opencode_db() -> Option<PathBuf> {
  crate::cleanup::opencode_data_candidates()
    .into_iter()
    .map(|d| d.join("opencode.db"))
    .find(|p| p.exists())
}

/// Open the OpenCode DB read-only (WAL lets us read while OpenCode runs).
fn opencode_conn() -> Result<Connection, String> {
  let path = opencode_db().ok_or("opencode database not found")?;
  Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())
}

fn opencode_model_id(raw: Option<String>) -> String {
  raw
    .and_then(|m| serde_json::from_str::<Value>(&m).ok())
    .and_then(|v| v.get("id").and_then(Value::as_str).map(String::from))
    .unwrap_or_default()
}

/// The session columns both the list scan and the single-session detail select,
/// in the fixed order `opencode_row_to_summary` reads them by index. The
/// `msg_count` correlated subquery references `s.id`, valid in either query.
const OPENCODE_COLS: &str = "s.id, s.title, s.slug, s.directory, s.model, s.cost, \
   s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, \
   s.tokens_cache_write, s.time_created, s.time_updated, \
   (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS msg_count";

/// Map one `SELECT OPENCODE_COLS …` row into a `SessionSummary`. Shared by the
/// full scan and by `opencode_detail` (which selects a single row by id).
fn opencode_row_to_summary(r: &rusqlite::Row) -> rusqlite::Result<SessionSummary> {
  let input: i64 = r.get::<_, Option<i64>>(6)?.unwrap_or(0);
  let output: i64 = r.get::<_, Option<i64>>(7)?.unwrap_or(0);
  let reasoning: i64 = r.get::<_, Option<i64>>(8)?.unwrap_or(0);
  let cache_read: i64 = r.get::<_, Option<i64>>(9)?.unwrap_or(0);
  let cache_write: i64 = r.get::<_, Option<i64>>(10)?.unwrap_or(0);
  let title: Option<String> = r.get(1)?;
  let slug: Option<String> = r.get(2)?;
  let directory: String = r.get::<_, Option<String>>(3)?.unwrap_or_default();
  let model = opencode_model_id(r.get::<_, Option<String>>(4)?);
  let usage = TokenUsage {
    input: input as u64,
    output: output as u64,
    cache_read: cache_read as u64,
    cache_write: cache_write as u64,
    reasoning: reasoning as u64,
    total: (input + output + cache_read + cache_write) as u64,
  };
  Ok(SessionSummary {
    id: r.get(0)?,
    source: "opencode".into(),
    title: title
      .filter(|t| !t.trim().is_empty())
      .or(slug)
      .unwrap_or_else(|| "Untitled session".into()),
    project_name: if directory.is_empty() {
      "—".into()
    } else {
      basename(&directory)
    },
    cwd: directory,
    models: if model.is_empty() {
      Vec::new()
    } else {
      vec![model.clone()]
    },
    model,
    message_count: r.get::<_, Option<i64>>(13)?.unwrap_or(0) as u64,
    usage,
    cost: r.get::<_, Option<f64>>(5)?,
    cost_basis: Some("billed".into()),
    branch_count: 1,
    started_at: r.get::<_, Option<i64>>(11)?.unwrap_or(0),
    updated_at: r.get::<_, Option<i64>>(12)?.unwrap_or(0),
    path: r.get(0)?,
    git_branch: None,
    parent_id: None,
    agent_name: None,
    duration_ms: None,
  })
}

pub(super) fn scan_opencode(out: &mut Vec<SessionSummary>) -> Result<(), String> {
  if opencode_db().is_none() {
    return Ok(()); // Not installed → absent, not an error.
  }
  let conn = opencode_conn()?;
  let mut stmt = conn
    .prepare(&format!(
      "SELECT {OPENCODE_COLS} FROM session s ORDER BY s.time_updated DESC"
    ))
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], opencode_row_to_summary)
    .map_err(|e| e.to_string())?;
  for sum in rows.flatten() {
    out.push(sum);
  }
  Ok(())
}

/// Per-message usage series for every OpenCode session, read straight from
/// SQLite. Unlike the JSONL sources this isn't cached: the rows are already
/// indexed, and a database has no per-session `(mtime, size)` to key a cache on.
pub(super) fn opencode_series(out: &mut Vec<SessionSeries>) -> Result<(), String> {
  if opencode_db().is_none() {
    return Ok(()); // Not installed → absent, not an error.
  }
  let conn = opencode_conn()?;
  let mut series: HashMap<String, SessionSeries> = HashMap::new();
  let mut tools: HashMap<String, ToolTally> = HashMap::new();

  let mut sessions = conn
    .prepare("SELECT id, directory FROM session")
    .map_err(|e| e.to_string())?;
  for row in sessions
    .query_map([], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    })
    .map_err(|e| e.to_string())?
    .flatten()
  {
    let dir = row.1.unwrap_or_default();
    series.insert(
      row.0.clone(),
      SessionSeries {
        id: row.0,
        source: "opencode".into(),
        project_name: if dir.is_empty() {
          "—".into()
        } else {
          basename(&dir)
        },
        git_branch: None,
        parent_id: None,
        models: Vec::new(),
        events: Vec::new(),
        tools: Vec::new(),
        cost_basis: Some("billed".into()),
      },
    );
  }

  let mut messages = conn
    .prepare("SELECT session_id, data FROM message ORDER BY time_created")
    .map_err(|e| e.to_string())?;
  for (sid, data) in messages
    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
    .map_err(|e| e.to_string())?
    .flatten()
  {
    let Some(entry) = series.get_mut(&sid) else {
      continue;
    };
    let Ok(data) = serde_json::from_str::<Value>(&data) else {
      continue;
    };
    let Some(tk) = data.get("tokens").filter(|t| !t.is_null()) else {
      continue;
    };
    let input = u(tk, "input");
    let output = u(tk, "output");
    let cache = tk.get("cache");
    let cache_read = cache.map(|c| u(c, "read")).unwrap_or(0);
    let cache_write = cache.map(|c| u(c, "write")).unwrap_or(0);
    let usage = TokenUsage {
      input,
      output,
      cache_read,
      cache_write,
      reasoning: u(tk, "reasoning"),
      total: input + output + cache_read + cache_write,
    };
    let ts = data
      .get("time")
      .and_then(|t| t.get("created"))
      .and_then(Value::as_i64)
      .unwrap_or(0);
    let idx = model_index(&mut entry.models, s(&data, "modelID"));
    if let Some(mut ev) = pack_event(ts, idx, &usage) {
      ev[7] = data
        .get("cost")
        .and_then(Value::as_f64)
        .map(|cost| (cost * 1_000_000.0).round() as i64)
        .unwrap_or(-1);
      entry.events.push(ev);
    }
  }

  // Tool parts carry their own `state.status`, so OpenCode is the one source
  // besides Claude that can report a real error rate.
  let mut parts = conn
    .prepare(
      "SELECT m.session_id, p.data FROM part p \
       JOIN message m ON p.message_id = m.id \
       WHERE p.data LIKE '%\"type\":\"tool\"%'",
    )
    .map_err(|e| e.to_string())?;
  for (sid, data) in parts
    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
    .map_err(|e| e.to_string())?
    .flatten()
  {
    let Ok(p) = serde_json::from_str::<Value>(&data) else {
      continue;
    };
    if s(&p, "type") != Some("tool") {
      continue;
    }
    let Some(name) = s(&p, "tool") else { continue };
    let state = p.get("state").unwrap_or(&Value::Null);
    tools
      .entry(sid)
      .or_default()
      .call_with_outcome(name, s(state, "status") == Some("error"));
  }

  for (sid, tally) in tools {
    if let Some(entry) = series.get_mut(&sid) {
      entry.tools = tally.finish();
    }
  }
  out.extend(
    series
      .into_values()
      .filter(|s| !s.events.is_empty() || !s.tools.is_empty()),
  );
  Ok(())
}

pub(super) fn opencode_detail(id: &str) -> Result<SessionDetail, String> {
  let conn = opencode_conn()?;
  // The session's summary in one indexed lookup (no full-table rescan).
  let summary = conn
    .query_row(
      &format!("SELECT {OPENCODE_COLS} FROM session s WHERE s.id = ?1"),
      [id],
      opencode_row_to_summary,
    )
    .map_err(|e| match e {
      rusqlite::Error::QueryReturnedNoRows => "session not found".to_string(),
      other => other.to_string(),
    })?;

  let mut stmt = conn
    .prepare("SELECT id, data FROM message WHERE session_id = ?1 ORDER BY time_created")
    .map_err(|e| e.to_string())?;
  let msg_rows: Vec<(String, String)> = stmt
    .query_map([id], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })
    .map_err(|e| e.to_string())?
    .filter_map(Result::ok)
    .collect();

  // All parts for the session in a single query, grouped by message id — turns
  // the former N+1 (one query per message) into two queries total. The ORDER BY
  // keeps each message's parts in their original time order.
  let mut part_stmt = conn
    .prepare(
      "SELECT p.message_id, p.data FROM part p \
       JOIN message m ON p.message_id = m.id \
       WHERE m.session_id = ?1 ORDER BY m.time_created, p.time_created",
    )
    .map_err(|e| e.to_string())?;
  let mut parts_by_msg: HashMap<String, Vec<Value>> = HashMap::new();
  for row in part_stmt
    .query_map([id], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })
    .map_err(|e| e.to_string())?
    .filter_map(Result::ok)
  {
    if let Ok(v) = serde_json::from_str::<Value>(&row.1) {
      parts_by_msg.entry(row.0).or_default().push(v);
    }
  }

  let mut messages = Vec::new();
  for (mid, mdata) in msg_rows {
    let data: Value = serde_json::from_str(&mdata).unwrap_or(Value::Null);
    let role = s(&data, "role").unwrap_or("user");
    let mut msg = Message::new(mid.clone(), role);
    msg.ts = data
      .get("time")
      .and_then(|t| t.get("created"))
      .and_then(Value::as_i64);
    msg.model = s(&data, "modelID").map(String::from);
    if let Some(tk) = data.get("tokens").filter(|t| !t.is_null()) {
      let input = u(tk, "input");
      let output = u(tk, "output");
      let cache = tk.get("cache");
      let cache_read = cache.map(|c| u(c, "read")).unwrap_or(0);
      let cache_write = cache.map(|c| u(c, "write")).unwrap_or(0);
      msg.usage = Some(TokenUsage {
        input,
        output,
        cache_read,
        cache_write,
        reasoning: u(tk, "reasoning"),
        total: input + output + cache_read + cache_write,
      });
    }

    for p in parts_by_msg.get(&mid).map(Vec::as_slice).unwrap_or(&[]) {
      match s(p, "type") {
        Some("text") => {
          if let Some(t) = s(p, "text").filter(|t| !t.trim().is_empty()) {
            msg.parts.push(Part::text("text", t.to_string()));
          }
        }
        Some("reasoning") => {
          if let Some(t) = s(p, "text").filter(|t| !t.trim().is_empty()) {
            msg.parts.push(Part::text("thinking", t.to_string()));
          }
        }
        Some("tool") => {
          let name = s(p, "tool").map(String::from);
          let state = p.get("state").unwrap_or(&Value::Null);
          let input = state
            .get("input")
            .map(|i| serde_json::to_string_pretty(i).unwrap_or_default())
            .unwrap_or_default();
          msg.parts.push(Part {
            kind: "toolCall".into(),
            text: input,
            name: name.clone(),
            call_id: s(p, "callID").map(String::from),
            ..Part::default()
          });
          let output = state.get("output");
          let out_text = match output {
            Some(Value::String(t)) => t.clone(),
            Some(other) => serde_json::to_string(other).unwrap_or_default(),
            None => String::new(),
          };
          if !out_text.trim().is_empty() {
            msg.parts.push(Part {
              kind: "toolResult".into(),
              text: out_text,
              name,
              call_id: s(p, "callID").map(String::from),
              is_error: s(state, "status").map(|st| st == "error"),
              ..Part::default()
            });
          }
        }
        Some("patch") => {
          let files = p
            .get("files")
            .and_then(Value::as_object)
            .map(|o| o.keys().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
          msg.parts.push(Part::text(
            "patch",
            if files.is_empty() {
              "[patch]".into()
            } else {
              files
            },
          ));
        }
        _ => {}
      }
    }
    if !msg.parts.is_empty() {
      messages.push(msg);
    }
  }
  Ok(SessionDetail {
    summary,
    messages,
    tree: None,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A session table with just the columns `OPENCODE_COLS` reads, so the SELECT
  /// under test is the real one rather than a paraphrase of it.
  fn db() -> Connection {
    let c = Connection::open_in_memory().expect("in-memory db");
    c.execute_batch(
      "CREATE TABLE session (
         id TEXT PRIMARY KEY, title TEXT, slug TEXT, directory TEXT, model TEXT, cost REAL,
         tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
         tokens_cache_read INTEGER, tokens_cache_write INTEGER,
         time_created INTEGER, time_updated INTEGER);
       CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT);",
    )
    .expect("schema");
    c
  }

  fn select_one(c: &Connection, id: &str) -> SessionSummary {
    let sql = format!("SELECT {OPENCODE_COLS} FROM session s WHERE s.id = ?1");
    c.query_row(&sql, [id], opencode_row_to_summary)
      .expect("row maps")
  }

  #[test]
  fn maps_a_full_row_into_a_summary() {
    let c = db();
    c.execute(
      "INSERT INTO session VALUES ('s1','Refactor the parser','refactor','/work/app',
        '{\"id\":\"anthropic/claude-opus-4-6\"}', 0.42, 100, 20, 5, 7, 3, 1000, 2000)",
      [],
    )
    .unwrap();
    // Two messages here and one on another session: msg_count is a correlated
    // subquery, so it must not pick up the neighbour's row.
    c.execute(
      "INSERT INTO message VALUES ('m1','s1'),('m2','s1'),('m3','other')",
      [],
    )
    .unwrap();

    let s = select_one(&c, "s1");
    assert_eq!(s.id, "s1");
    assert_eq!(s.source, "opencode");
    assert_eq!(s.title, "Refactor the parser");
    assert_eq!(s.model, "anthropic/claude-opus-4-6");
    assert_eq!(s.project_name, "app");
    // OpenCode is the one source that records real money, so it is passed
    // through rather than estimated from tokens.
    assert_eq!(s.cost, Some(0.42));
    assert_eq!(s.message_count, 2);
    assert_eq!((s.started_at, s.updated_at), (1000, 2000));
  }

  /// `total` is the billable sum: reasoning tokens are already inside `output`,
  /// so adding them again would double-count them.
  #[test]
  fn totals_input_output_and_both_cache_columns() {
    let c = db();
    c.execute(
      "INSERT INTO session VALUES ('s1',NULL,NULL,'/w',NULL,NULL,100,20,9,7,3,0,0)",
      [],
    )
    .unwrap();
    let s = select_one(&c, "s1");
    assert_eq!(s.usage.total, 130);
    assert_eq!(s.usage.reasoning, 9);
  }

  #[test]
  fn falls_back_from_a_blank_title_to_the_slug_then_to_a_placeholder() {
    let c = db();
    c.execute(
      "INSERT INTO session VALUES ('a','   ','the-slug','/w',NULL,NULL,0,0,0,0,0,0,0)",
      [],
    )
    .unwrap();
    c.execute(
      "INSERT INTO session VALUES ('b',NULL,NULL,'/w',NULL,NULL,0,0,0,0,0,0,0)",
      [],
    )
    .unwrap();
    assert_eq!(select_one(&c, "a").title, "the-slug");
    assert_eq!(select_one(&c, "b").title, "Untitled session");
  }

  /// Every numeric column is nullable in practice; a NULL must read as 0, not
  /// abort the whole scan.
  #[test]
  fn treats_null_counters_as_zero_rather_than_failing_the_row() {
    let c = db();
    c.execute(
      "INSERT INTO session VALUES ('s1','t',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)",
      [],
    )
    .unwrap();
    let s = select_one(&c, "s1");
    assert_eq!(s.usage.total, 0);
    assert_eq!(s.cost, None);
    assert_eq!(
      s.project_name, "—",
      "no directory means no project name to show"
    );
    assert_eq!(s.message_count, 0);
  }

  #[test]
  fn leaves_the_model_list_empty_when_the_model_column_is_unreadable() {
    let c = db();
    c.execute(
      "INSERT INTO session VALUES ('s1','t',NULL,'/w','not json',NULL,0,0,0,0,0,0,0)",
      [],
    )
    .unwrap();
    let s = select_one(&c, "s1");
    assert_eq!(s.model, "");
    assert!(s.models.is_empty());
  }

  mod opencode_model_id {
    use super::*;

    #[test]
    fn reads_the_id_out_of_the_stored_json() {
      assert_eq!(
        opencode_model_id(Some(r#"{"id":"anthropic/claude-opus-4-6","x":1}"#.into())),
        "anthropic/claude-opus-4-6"
      );
    }

    #[test]
    fn returns_empty_for_null_malformed_or_id_less_json() {
      assert_eq!(opencode_model_id(None), "");
      assert_eq!(opencode_model_id(Some("not json".into())), "");
      assert_eq!(opencode_model_id(Some(r#"{"name":"x"}"#.into())), "");
    }
  }
}
