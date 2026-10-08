//! OpenCode history reader.
//!
//! Unlike the two JSONL sources, OpenCode keeps everything in one SQLite
//! database. Detect v1 (`session` / `message` / `part`) and v2 (`session_v2` /
//! `session_message`) from the schema. Session rollups are read directly when
//! available; early v1 databases aggregate them from assistant messages.
//!
//! Opened **read-only** on purpose: OpenCode may be running against the same
//! file, and this app is never the writer.

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
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

#[derive(Clone, Copy, PartialEq)]
enum OpenCodeSchema {
  V1,
  V2,
}

impl OpenCodeSchema {
  fn session_table(self) -> &'static str {
    match self {
      Self::V1 => "session",
      Self::V2 => "session_v2",
    }
  }
}

/// Detect the persisted layout rather than the installed CLI's version. During
/// migration both layouts can exist; v2 owns any session id present in both.
fn opencode_schemas(conn: &Connection) -> Result<Vec<OpenCodeSchema>, String> {
  let mut stmt = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .map_err(|e| e.to_string())?;
  let tables = stmt
    .query_map([], |r| r.get::<_, String>(0))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
  let has = |name: &str| tables.iter().any(|t| t == name);
  let mut schemas = Vec::new();
  if has("session_v2") && has("session_message") {
    schemas.push(OpenCodeSchema::V2);
  }
  if has("session") && has("message") && has("part") {
    schemas.push(OpenCodeSchema::V1);
  }
  if schemas.is_empty() {
    return Err("unsupported OpenCode history schema (expected v1 or v2 tables)".into());
  }
  Ok(schemas)
}

fn session_columns(conn: &Connection, schema: OpenCodeSchema) -> Result<HashSet<String>, String> {
  let mut stmt = conn
    .prepare(&format!("PRAGMA table_info({})", schema.session_table()))
    .map_err(|e| e.to_string())?;
  let columns = stmt
    .query_map([], |r| r.get::<_, String>(1))
    .map_err(|e| e.to_string())?
    .collect::<Result<HashSet<_>, _>>()
    .map_err(|e| e.to_string())?;
  Ok(columns)
}

/// Both scan and detail use the same column order. Early v1 databases have no
/// session rollups: aggregate their assistant messages once, not once per field.
fn summary_query(
  conn: &Connection,
  schema: OpenCodeSchema,
  single: bool,
) -> Result<String, String> {
  let columns = session_columns(conn, schema)?;
  let counters = [
    ("cost", "$.cost"),
    ("tokens_input", "$.tokens.input"),
    ("tokens_output", "$.tokens.output"),
    ("tokens_reasoning", "$.tokens.reasoning"),
    ("tokens_cache_read", "$.tokens.cache.read"),
    ("tokens_cache_write", "$.tokens.cache.write"),
  ];
  let aggregate =
    schema == OpenCodeSchema::V1 && counters.iter().any(|(name, _)| !columns.contains(*name));
  let mut fields: Vec<String> = ["id", "title", "slug", "directory"]
    .iter()
    .map(|name| format!("s.{name}"))
    .collect();
  fields.push(if columns.contains("model") {
    "s.model".into()
  } else if schema == OpenCodeSchema::V1 {
    "(SELECT json_object('id', json_extract(m.data, '$.modelID')) FROM message m \
      WHERE m.session_id = s.id AND json_valid(m.data) AND json_extract(m.data, '$.modelID') IS NOT NULL \
      ORDER BY m.time_created DESC, m.id DESC LIMIT 1)".into()
  } else { "NULL".into() });
  for (name, _) in counters {
    fields.push(if columns.contains(name) {
      format!("s.{name}")
    } else if aggregate {
      format!("a.{name}")
    } else {
      "NULL".into()
    });
  }
  fields.extend(["s.time_created".into(), "s.time_updated".into()]);
  fields.push(match schema {
    OpenCodeSchema::V1 => "(SELECT COUNT(*) FROM message m WHERE m.session_id = s.id)".into(),
    OpenCodeSchema::V2 => "(SELECT COUNT(*) FROM session_message m WHERE m.session_id = s.id AND m.type IN ('user','assistant'))".into(),
  });
  for name in ["parent_id", "agent"] {
    fields.push(if columns.contains(name) {
      format!("s.{name}")
    } else {
      "NULL".into()
    });
  }
  let prefix = if aggregate {
    let sums = counters
      .iter()
      .map(|(name, path)| format!("SUM(json_extract(data, '{path}')) AS {name}"))
      .collect::<Vec<_>>()
      .join(", ");
    let filter = if single { " AND session_id = ?1" } else { "" };
    format!("WITH usage AS (SELECT session_id, {sums} FROM message WHERE json_valid(data) AND json_extract(data, '$.role') = 'assistant'{filter} GROUP BY session_id) ")
  } else {
    String::new()
  };
  let join = if aggregate {
    " LEFT JOIN usage a ON a.session_id = s.id"
  } else {
    ""
  };
  let suffix = if single {
    " WHERE s.id = ?1"
  } else {
    " ORDER BY s.time_updated DESC"
  };
  Ok(format!(
    "{prefix}SELECT {} FROM {} s{join}{suffix}",
    fields.join(", "),
    schema.session_table()
  ))
}

/// Map one row from `summary_query` for either persisted layout.
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
    parent_id: r.get(14)?,
    agent_name: r.get(15)?,
    duration_ms: None,
  })
}

pub(super) fn scan_opencode(out: &mut Vec<SessionSummary>) -> Result<(), String> {
  if opencode_db().is_none() {
    return Ok(()); // Not installed → absent, not an error.
  }
  let conn = opencode_conn()?;
  scan_opencode_conn(&conn, out)
}

fn scan_opencode_conn(conn: &Connection, out: &mut Vec<SessionSummary>) -> Result<(), String> {
  let mut seen = HashSet::new();
  for schema in opencode_schemas(conn)? {
    let mut stmt = conn
      .prepare(&summary_query(conn, schema, false)?)
      .map_err(|e| e.to_string())?;
    let rows = stmt
      .query_map([], opencode_row_to_summary)
      .map_err(|e| e.to_string())?;
    for row in rows {
      let sum = row.map_err(|e| e.to_string())?;
      if seen.insert(sum.id.clone()) {
        out.push(sum);
      }
    }
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
  opencode_series_conn(&conn, out)
}

fn opencode_series_conn(conn: &Connection, out: &mut Vec<SessionSeries>) -> Result<(), String> {
  let mut seen = HashSet::new();
  for schema in opencode_schemas(conn)? {
    opencode_series_schema(conn, schema, &mut seen, out)?;
  }
  Ok(())
}

fn opencode_series_schema(
  conn: &Connection,
  schema: OpenCodeSchema,
  seen: &mut HashSet<String>,
  out: &mut Vec<SessionSeries>,
) -> Result<(), String> {
  let mut series: HashMap<String, SessionSeries> = HashMap::new();
  let mut tools: HashMap<String, ToolTally> = HashMap::new();

  let columns = session_columns(conn, schema)?;
  let parent_column = if columns.contains("parent_id") {
    "parent_id"
  } else {
    "NULL"
  };
  let mut sessions = conn
    .prepare(&format!(
      "SELECT id, directory, {parent_column} FROM {}",
      schema.session_table()
    ))
    .map_err(|e| e.to_string())?;
  for row in sessions
    .query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, Option<String>>(1)?,
        r.get::<_, Option<String>>(2)?,
      ))
    })
    .map_err(|e| e.to_string())?
    .flatten()
  {
    if !seen.insert(row.0.clone()) {
      continue;
    }
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
        parent_id: row.2,
        models: Vec::new(),
        events: Vec::new(),
        tools: Vec::new(),
        cost_basis: Some("billed".into()),
      },
    );
  }

  if series.is_empty() {
    return Ok(());
  }

  let mut messages = conn
    .prepare(match schema {
      OpenCodeSchema::V1 => {
        "SELECT session_id, time_created, data FROM message ORDER BY time_created, id"
      }
      OpenCodeSchema::V2 => {
        "SELECT session_id, time_created, data FROM session_message ORDER BY session_id, seq"
      }
    })
    .map_err(|e| e.to_string())?;
  for (sid, created, data) in messages
    .query_map([], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, i64>(1)?,
        r.get::<_, String>(2)?,
      ))
    })
    .map_err(|e| e.to_string())?
    .flatten()
  {
    let Some(entry) = series.get_mut(&sid) else {
      continue;
    };
    let Ok(data) = serde_json::from_str::<Value>(&data) else {
      continue;
    };
    if schema == OpenCodeSchema::V2 {
      if let Some(content) = data.get("content").and_then(Value::as_array) {
        for part in content {
          if s(part, "type") == Some("tool") {
            if let Some(name) = s(part, "name") {
              tools.entry(sid.clone()).or_default().call_with_outcome(
                name,
                part.get("state").and_then(|state| s(state, "status")) == Some("error"),
              );
            }
          }
        }
      }
    }
    let Some(usage) = opencode_usage(&data) else {
      continue;
    };
    let ts = data
      .get("time")
      .and_then(|t| t.get("created"))
      .and_then(Value::as_i64)
      .unwrap_or(created);
    let model = match schema {
      OpenCodeSchema::V1 => s(&data, "modelID"),
      OpenCodeSchema::V2 => data.get("model").and_then(|m| s(m, "id")),
    };
    let idx = model_index(&mut entry.models, model);
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
  if schema == OpenCodeSchema::V1 {
    let mut parts = conn
      .prepare(
        "SELECT m.session_id, p.data FROM part p \
       JOIN message m ON p.message_id = m.id \
       WHERE json_valid(p.data) AND json_extract(p.data, '$.type') = 'tool'",
      )
      .map_err(|e| e.to_string())?;
    for (sid, data) in parts
      .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
      .map_err(|e| e.to_string())?
      .flatten()
    {
      if !series.contains_key(&sid) {
        continue;
      }
      let Ok(p) = serde_json::from_str::<Value>(&data) else {
        continue;
      };
      let Some(name) = s(&p, "tool") else { continue };
      let state = p.get("state").unwrap_or(&Value::Null);
      tools
        .entry(sid)
        .or_default()
        .call_with_outcome(name, s(state, "status") == Some("error"));
    }
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
  opencode_detail_conn(&conn, id)
}

fn opencode_detail_conn(conn: &Connection, id: &str) -> Result<SessionDetail, String> {
  for schema in opencode_schemas(conn)? {
    let summary = conn
      .query_row(
        &summary_query(conn, schema, true)?,
        [id],
        opencode_row_to_summary,
      )
      .optional()
      .map_err(|e| e.to_string())?;
    if let Some(summary) = summary {
      return match schema {
        OpenCodeSchema::V1 => opencode_detail_v1(conn, summary),
        OpenCodeSchema::V2 => opencode_detail_v2(conn, summary),
      };
    }
  }
  Err("session not found".into())
}

fn opencode_detail_v1(conn: &Connection, summary: SessionSummary) -> Result<SessionDetail, String> {
  let id = summary.id.as_str();
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
    msg.usage = opencode_usage(&data);

    for p in parts_by_msg.get(&mid).map(Vec::as_slice).unwrap_or(&[]) {
      append_opencode_part(&mut msg, p, OpenCodeSchema::V1);
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

fn value_text(value: Option<&Value>) -> String {
  match value {
    Some(Value::String(text)) => text.clone(),
    Some(Value::Null) | None => String::new(),
    Some(value) => serde_json::to_string_pretty(value).unwrap_or_default(),
  }
}

fn opencode_usage(data: &Value) -> Option<TokenUsage> {
  let tk = data.get("tokens").filter(|t| !t.is_null())?;
  let input = u(tk, "input");
  let output = u(tk, "output");
  let cache = tk.get("cache");
  let cache_read = cache.map(|c| u(c, "read")).unwrap_or(0);
  let cache_write = cache.map(|c| u(c, "write")).unwrap_or(0);
  Some(TokenUsage {
    input,
    output,
    cache_read,
    cache_write,
    reasoning: u(tk, "reasoning"),
    total: input + output + cache_read + cache_write,
  })
}

fn append_opencode_part(msg: &mut Message, p: &Value, schema: OpenCodeSchema) {
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
      let name = s(
        p,
        if schema == OpenCodeSchema::V1 {
          "tool"
        } else {
          "name"
        },
      )
      .map(String::from);
      let call_id = s(
        p,
        if schema == OpenCodeSchema::V1 {
          "callID"
        } else {
          "id"
        },
      )
      .map(String::from);
      let state = p.get("state").unwrap_or(&Value::Null);
      let input = state
        .get("input")
        .map(|i| serde_json::to_string_pretty(i).unwrap_or_default())
        .unwrap_or_default();
      msg.parts.push(Part {
        kind: "toolCall".into(),
        text: input,
        name: name.clone(),
        call_id: call_id.clone(),
        ..Part::default()
      });
      let out_text = if schema == OpenCodeSchema::V1 {
        value_text(state.get("output"))
      } else {
        state
          .get("content")
          .and_then(Value::as_array)
          .map(|parts| {
            parts
              .iter()
              .map(|p| {
                s(p, "text")
                  .map(String::from)
                  .unwrap_or_else(|| value_text(Some(p)))
              })
              .collect::<Vec<_>>()
              .join("\n")
          })
          .unwrap_or_default()
      };
      let out_text = if s(state, "status") == Some("error") {
        let error = state.get("error");
        let error_text = error
          .and_then(|e| s(e, "message"))
          .map(String::from)
          .unwrap_or_else(|| value_text(error));
        [out_text, error_text]
          .into_iter()
          .filter(|s| !s.trim().is_empty())
          .collect::<Vec<_>>()
          .join("\n")
      } else {
        out_text
      };
      if !out_text.trim().is_empty() {
        msg.parts.push(Part {
          kind: "toolResult".into(),
          text: out_text,
          name,
          call_id,
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

fn opencode_detail_v2(conn: &Connection, summary: SessionSummary) -> Result<SessionDetail, String> {
  let mut stmt = conn
    .prepare(
      "SELECT id, type, time_created, data FROM session_message WHERE session_id = ?1 ORDER BY seq",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([&summary.id], |r| {
      Ok((
        r.get::<_, String>(0)?,
        r.get::<_, String>(1)?,
        r.get::<_, i64>(2)?,
        r.get::<_, String>(3)?,
      ))
    })
    .map_err(|e| e.to_string())?;
  let mut messages = Vec::new();
  for row in rows {
    let (id, kind, ts, raw) = row.map_err(|e| e.to_string())?;
    let data: Value =
      serde_json::from_str(&raw).map_err(|e| format!("OpenCode message {id}: {e}"))?;
    let role = match kind.as_str() {
      "user" => "user",
      "assistant" => "assistant",
      _ => "system",
    };
    let mut msg = Message::new(id, role);
    msg.ts = Some(
      data
        .get("time")
        .and_then(|t| t.get("created"))
        .and_then(Value::as_i64)
        .unwrap_or(ts),
    );
    msg.model = data.get("model").and_then(|m| s(m, "id")).map(String::from);
    msg.usage = opencode_usage(&data);
    match kind.as_str() {
      "assistant" => {
        if let Some(content) = data.get("content").and_then(Value::as_array) {
          for part in content {
            append_opencode_part(&mut msg, part, OpenCodeSchema::V2);
          }
        }
        if let Some(files) = data
          .get("snapshot")
          .and_then(|s| s.get("files"))
          .and_then(Value::as_array)
        {
          msg.parts.push(Part::text(
            "patch",
            files
              .iter()
              .filter_map(Value::as_str)
              .collect::<Vec<_>>()
              .join("\n"),
          ));
        }
        if let Some(error) = data.get("error") {
          msg.parts.push(Part::text("event", value_text(Some(error))));
        }
      }
      "user" | "synthetic" | "system" | "skill" => {
        if let Some(text) = s(&data, "text").filter(|t| !t.trim().is_empty()) {
          msg.parts.push(Part::text("text", text.to_string()));
        }
        for key in ["files", "agents", "skills"] {
          if let Some(items) = data.get(key).and_then(Value::as_array) {
            for item in items {
              msg.parts.push(Part::text("event", value_text(Some(item))));
            }
          }
        }
      }
      "compaction" => {
        for key in ["summary", "recent", "error"] {
          if let Some(value) = data.get(key) {
            msg.parts.push(Part::text("event", value_text(Some(value))));
          }
        }
      }
      "shell" => {
        if let Some(command) = s(&data, "command") {
          msg.parts.push(Part::text("toolCall", command.into()));
        }
        if let Some(output) = data.get("output") {
          msg
            .parts
            .push(Part::text("toolResult", value_text(Some(output))));
        }
      }
      _ => msg.parts.push(Part {
        kind: "event".into(),
        name: Some(kind),
        text: value_text(Some(&data)),
        ..Part::default()
      }),
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

  fn v2_db() -> Connection {
    let c = db();
    c.execute_batch(
      "ALTER TABLE session RENAME TO session_v2;
       DROP TABLE message;
       DROP TABLE part;
       CREATE TABLE session_message (
         id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
         time_created INTEGER, time_updated INTEGER, data TEXT);
       INSERT INTO session_v2 VALUES ('s1','V2 conversation','v2','/work/app',
         '{\"id\":\"deepseek-flash\",\"providerID\":\"deepseek\"}',
         0.42,100,20,5,7,3,1000,2000);",
    )
    .unwrap();
    for (id, kind, seq, data) in [
      (
        "switch",
        "model-switched",
        0,
        serde_json::json!({"model":{"id":"deepseek-flash"}}),
      ),
      (
        "u1",
        "user",
        1,
        serde_json::json!({"time":{"created":1000},"text":"Hello"}),
      ),
      (
        "a1",
        "assistant",
        2,
        serde_json::json!({
          "time":{"created":1100},"model":{"id":"deepseek-flash","providerID":"deepseek"},
          "content":[{"type":"reasoning","text":"Thinking"},{"type":"text","text":"Hi"}],
          "tokens":{"input":100,"output":20,"reasoning":5,"cache":{"read":7,"write":3}},"cost":0.42
        }),
      ),
    ] {
      c.execute(
        "INSERT INTO session_message VALUES (?1,'s1',?2,?3,1000,1000,?4)",
        rusqlite::params![id, kind, seq, data.to_string()],
      )
      .unwrap();
    }
    c
  }

  #[test]
  fn scans_v2_without_legacy_tables_and_counts_conversation_messages() {
    let c = v2_db();
    let mut out = Vec::new();
    scan_opencode_conn(&c, &mut out).expect("v2 scan");
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].title, "V2 conversation");
    assert_eq!(
      out[0].message_count, 2,
      "switch events are not chat messages"
    );
    assert_eq!(out[0].model, "deepseek-flash");
    assert_eq!(out[0].usage.total, 130);
    assert_eq!(out[0].cost, Some(0.42));
  }

  #[test]
  fn reads_v2_transcript_in_sequence_order_with_thinking_and_tool_results() {
    let c = v2_db();
    let content = serde_json::json!([
      {"type":"reasoning","text":"Thinking"},
      {"type":"text","text":"Hi"},
      {"type":"tool","id":"call1","name":"read","state":{
        "status":"completed","input":{"path":"a.txt"},
        "content":[{"type":"text","text":"File contents"}]
      }},
      {"type":"tool","id":"call2","name":"bash","state":{
        "status":"error","input":{"command":"false"},"error":{"message":"Command failed"}
      }}
    ]);
    c.execute(
      "UPDATE session_message SET data=json_set(data,'$.content',json(?1)),time_created=0 WHERE id='a1'",
      [content.to_string()],
    )
    .unwrap();
    let d = opencode_detail_conn(&c, "s1").expect("v2 detail");
    let chat: Vec<_> = d.messages.iter().filter(|m| m.role != "system").collect();
    assert_eq!(chat.len(), 2);
    assert_eq!(chat[0].id, "u1", "seq wins over the stored timestamp");
    assert_eq!(chat[0].parts[0].text, "Hello");
    let a = chat[1];
    assert_eq!(a.role, "assistant");
    assert_eq!(a.model.as_deref(), Some("deepseek-flash"));
    assert_eq!(a.usage.as_ref().unwrap().total, 130);
    assert_eq!(a.parts[0].kind, "thinking");
    assert_eq!(a.parts[1].text, "Hi");
    assert_eq!(a.parts[2].name.as_deref(), Some("read"));
    assert_eq!(a.parts[3].call_id.as_deref(), Some("call1"));
    assert_eq!(a.parts[3].text, "File contents");
    assert_eq!(a.parts[5].is_error, Some(true));
    assert_eq!(a.parts[5].text, "Command failed");
    assert!(d.messages.iter().any(|m| m.role == "system"));
  }

  #[test]
  fn reads_v2_usage_and_tools_even_when_a_tool_message_has_no_tokens() {
    let c = v2_db();
    let data = serde_json::json!({"content":[
      {"type":"tool","id":"call1","name":"read","state":{"status":"completed"}},
      {"type":"tool","id":"call2","name":"read","state":{"status":"error"}}
    ]});
    c.execute(
      "INSERT INTO session_message VALUES ('tools','s1','assistant',3,1200,1200,?1)",
      [data.to_string()],
    )
    .unwrap();
    let mut out = Vec::new();
    opencode_series_conn(&c, &mut out).expect("v2 usage");
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].models, ["deepseek-flash"]);
    assert_eq!(out[0].events, [[1100, 0, 100, 20, 7, 3, 5, 420000]]);
    assert_eq!(out[0].tools.len(), 1);
    assert_eq!(out[0].tools[0].name, "read");
    assert_eq!(out[0].tools[0].calls, 2);
    assert_eq!(out[0].tools[0].errors, 1);
  }

  fn legacy_db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    insert_legacy_fixture(&c);
    c
  }

  fn insert_legacy_fixture(c: &Connection) {
    c.execute_batch(
      "CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, slug TEXT, directory TEXT,
         parent_id TEXT, time_created INTEGER, time_updated INTEGER);
       CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
       CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);
       INSERT INTO session VALUES ('old','Legacy conversation','old','/work/app',NULL,1000,2000);",
    )
    .unwrap();
    for (id, data) in [
      (
        "u1",
        serde_json::json!({"role":"user","time":{"created":1000}}),
      ),
      (
        "a1",
        serde_json::json!({"role":"assistant","modelID":"claude-opus","time":{"created":1100},
        "tokens":{"input":100,"output":20,"reasoning":5,"cache":{"read":7,"write":3}},"cost":0.42}),
      ),
    ] {
      c.execute(
        "INSERT INTO message VALUES (?1,'old',1000,?2)",
        rusqlite::params![id, data.to_string()],
      )
      .unwrap();
    }
    for (id, mid, data) in [
      (
        "p1",
        "u1",
        serde_json::json!({"type":"text","text":"Hello"}),
      ),
      ("p2", "a1", serde_json::json!({"type":"text","text":"Hi"})),
      (
        "p3",
        "a1",
        serde_json::json!({"type":"tool","tool":"read","callID":"call1",
        "state":{"status":"completed","input":{},"output":"File contents"}}),
      ),
    ] {
      // Whitespace in JSON must not hide tool calls from the usage statistics.
      c.execute(
        "INSERT INTO part VALUES (?1,?2,1000,?3)",
        rusqlite::params![id, mid, serde_json::to_string_pretty(&data).unwrap()],
      )
      .unwrap();
    }
  }

  #[test]
  fn reads_v1_without_precomputed_session_usage_columns() {
    let c = legacy_db();
    let mut out = Vec::new();
    scan_opencode_conn(&c, &mut out).expect("legacy scan");
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].model, "claude-opus");
    assert_eq!(out[0].message_count, 2);
    assert_eq!(out[0].usage.total, 130);
    assert_eq!(out[0].cost, Some(0.42));
    let d = opencode_detail_conn(&c, "old").expect("legacy detail");
    assert_eq!(d.messages.len(), 2);
    assert_eq!(d.messages[0].parts[0].text, "Hello");
    assert_eq!(d.messages[1].parts[2].text, "File contents");
    let mut series = Vec::new();
    opencode_series_conn(&c, &mut series).expect("legacy usage");
    assert_eq!(series[0].events, [[1100, 0, 100, 20, 7, 3, 5, 420000]]);
    assert_eq!(series[0].tools[0].calls, 1);
  }

  #[test]
  fn combines_both_schemas_without_double_counting_migrated_sessions() {
    let c = v2_db();
    insert_legacy_fixture(&c);
    c.execute("INSERT INTO session SELECT 's1','Stale copy',slug,directory,parent_id,time_created,time_updated FROM session WHERE id='old'", []).unwrap();
    c.execute(
      "INSERT INTO message SELECT 'duplicate', 's1', time_created, data FROM message WHERE id='a1'",
      [],
    )
    .unwrap();
    let mut out = Vec::new();
    scan_opencode_conn(&c, &mut out).unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(
      out.iter().find(|s| s.id == "s1").unwrap().title,
      "V2 conversation"
    );
    assert_eq!(
      opencode_detail_conn(&c, "s1").unwrap().summary.title,
      "V2 conversation"
    );
    assert_eq!(opencode_detail_conn(&c, "old").unwrap().messages.len(), 2);
    let mut series = Vec::new();
    opencode_series_conn(&c, &mut series).unwrap();
    assert_eq!(series.len(), 2);
    assert_eq!(series.iter().map(|s| s.events.len()).sum::<usize>(), 2);

    // An empty v2 session must still suppress its stale v1 usage.
    c.execute("DELETE FROM session_message WHERE session_id='s1'", [])
      .unwrap();
    let mut series = Vec::new();
    opencode_series_conn(&c, &mut series).unwrap();
    assert_eq!(series.len(), 1);
    assert_eq!(series[0].id, "old");
  }

  #[test]
  fn preserves_parent_identity_in_summaries_and_usage() {
    let c = v2_db();
    c.execute_batch(
      "ALTER TABLE session_v2 ADD COLUMN parent_id TEXT; UPDATE session_v2 SET parent_id='parent';",
    )
    .unwrap();
    let mut summaries = Vec::new();
    scan_opencode_conn(&c, &mut summaries).unwrap();
    let mut series = Vec::new();
    opencode_series_conn(&c, &mut series).unwrap();
    assert_eq!(summaries[0].parent_id.as_deref(), Some("parent"));
    assert_eq!(series[0].parent_id.as_deref(), Some("parent"));
  }

  #[test]
  fn reports_unknown_schema_and_missing_sessions() {
    let c = Connection::open_in_memory().unwrap();
    assert!(scan_opencode_conn(&c, &mut Vec::new())
      .unwrap_err()
      .contains("unsupported OpenCode history schema"));
    assert!(opencode_series_conn(&c, &mut Vec::new())
      .unwrap_err()
      .contains("unsupported OpenCode history schema"));
    assert_eq!(
      opencode_detail_conn(&v2_db(), "missing").err().as_deref(),
      Some("session not found")
    );
  }

  /// Explicitly opt in to a real database; ordinary tests never read user data.
  #[test]
  #[ignore = "requires AGENTPACK_OPENCODE_SMOKE_DB"]
  fn reads_real_database_read_only() {
    let path = std::env::var("AGENTPACK_OPENCODE_SMOKE_DB").expect("explicit database path");
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut summaries = Vec::new();
    scan_opencode_conn(&conn, &mut summaries).unwrap();
    assert!(!summaries.is_empty());
    let mut rendered = 0;
    let mut chat_messages = 0;
    for summary in &summaries {
      let detail = opencode_detail_conn(&conn, &summary.id).unwrap();
      assert_eq!(detail.summary.id, summary.id);
      assert_eq!(detail.summary.message_count, summary.message_count);
      rendered += detail.messages.len();
      chat_messages += detail
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .count();
    }
    let mut series = Vec::new();
    opencode_series_conn(&conn, &mut series).unwrap();
    println!("Read-only smoke: {} sessions, {rendered} transcript entries, {chat_messages} chat messages, {} usage events", summaries.len(), series.iter().map(|s| s.events.len()).sum::<usize>());
  }

  /// A session table with precomputed rollups, so the SELECT
  /// under test is the real one rather than a paraphrase of it.
  fn db() -> Connection {
    let c = Connection::open_in_memory().expect("in-memory db");
    c.execute_batch(
      "CREATE TABLE session (
         id TEXT PRIMARY KEY, title TEXT, slug TEXT, directory TEXT, model TEXT, cost REAL,
         tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
         tokens_cache_read INTEGER, tokens_cache_write INTEGER,
         time_created INTEGER, time_updated INTEGER);
       CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT);
       CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER, data TEXT);",
    )
    .expect("schema");
    c
  }

  fn select_one(c: &Connection, id: &str) -> SessionSummary {
    let sql = summary_query(c, OpenCodeSchema::V1, true).unwrap();
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
