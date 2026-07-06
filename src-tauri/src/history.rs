//! Chat-history reader for the three agent CLIs. Each tool persists its
//! conversations very differently:
//!
//! * **Claude Code** — one JSONL file per session under
//!   `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Each line is a typed
//!   record (`user`/`assistant`/`system`/`ai-title`/…); assistant lines carry a
//!   `message.usage` block.
//! * **Codex** — one "rollout" JSONL per session under
//!   `<codexHome>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, every line a
//!   `{timestamp,type,payload}` envelope. Token totals arrive in `token_count`
//!   events; a sibling `session_index.jsonl` maps ids → thread names.
//! * **OpenCode** — a single SQLite database (`opencode.db`) with `session` /
//!   `message` / `part` tables and precomputed per-session token + cost columns.
//!
//! This module reads them off the main thread and normalizes each into a common
//! shape (`SessionSummary` for the list, `SessionDetail` for a transcript) so the
//! webview renders one model instead of three. Everything here is read-only.

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use crate::paths::codex_home;

/// Unified token accounting. Component fields are the disjoint parts that make up
/// `total` for a given source (see `finish_total`), so summing `total` across
/// sessions never double-counts. Cached / reasoning subsets are surfaced for
/// context but are already accounted for within the source's own `total`.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
  input: u64,
  output: u64,
  cache_read: u64,
  cache_write: u64,
  reasoning: u64,
  total: u64,
}

impl TokenUsage {
  fn add(&mut self, o: &TokenUsage) {
    self.input += o.input;
    self.output += o.output;
    self.cache_read += o.cache_read;
    self.cache_write += o.cache_write;
    self.reasoning += o.reasoning;
    self.total += o.total;
  }
}

/// Lightweight per-session record for the history list + usage stats. Built by
/// streaming a whole session once (JSONL) or one SQL row (OpenCode).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
  id: String,
  /// "claude" | "codex" | "opencode".
  source: String,
  title: String,
  cwd: String,
  project_name: String,
  /// Primary (last-seen) model.
  model: String,
  /// Every distinct model id seen in the session.
  models: Vec<String>,
  message_count: u64,
  usage: TokenUsage,
  /// Real cost in USD when the source records it (OpenCode); `None` otherwise.
  cost: Option<f64>,
  /// Epoch milliseconds.
  started_at: i64,
  updated_at: i64,
  /// File path (Claude/Codex) or session id (OpenCode) — the handle
  /// `history_get_session` reopens the transcript with.
  path: String,
  git_branch: Option<String>,
}

/// One normalized content block within a message.
///
/// `kind` ∈ text | thinking | toolCall | toolResult | image | patch | webSearch.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Part {
  kind: String,
  /// Main payload: message text, tool input, tool output, patch body, etc.
  text: String,
  /// Tool name for toolCall / toolResult.
  name: Option<String>,
  call_id: Option<String>,
  is_error: Option<bool>,
}

impl Part {
  fn text(kind: &str, text: String) -> Part {
    Part { kind: kind.into(), text, name: None, call_id: None, is_error: None }
  }
}

/// One turn in a transcript. Assistant turns bundle thinking, text and tool
/// activity as ordered `parts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Message {
  id: String,
  /// "user" | "assistant" | "system" | "tool".
  role: String,
  ts: Option<i64>,
  model: Option<String>,
  parts: Vec<Part>,
  usage: Option<TokenUsage>,
}

impl Message {
  fn new(id: String, role: &str) -> Message {
    Message { id, role: role.into(), ts: None, model: None, parts: Vec::new(), usage: None }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
  summary: SessionSummary,
  messages: Vec<Message>,
}

/// A source that couldn't be scanned (missing directory is *not* an error — it's
/// reported as simply absent, i.e. no sessions).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceError {
  source: String,
  message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
  sessions: Vec<SessionSummary>,
  errors: Vec<SourceError>,
}

// ── small JSON / time helpers ────────────────────────────────────────────────

fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
  v.get(key).and_then(Value::as_str)
}
fn u(v: &Value, key: &str) -> u64 {
  v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn basename(p: &str) -> String {
  let norm = p.replace('\\', "/");
  norm
    .trim_end_matches('/')
    .rsplit('/')
    .next()
    .unwrap_or(p)
    .to_string()
}

fn truncate_title(s: &str) -> String {
  let clean = s.trim().replace(['\n', '\r'], " ");
  let clean = clean.trim();
  let mut out: String = clean.chars().take(80).collect();
  if clean.chars().count() > 80 {
    out.push('…');
  }
  out
}

/// Days since the Unix epoch for a proleptic-Gregorian date (Howard Hinnant's
/// algorithm) — avoids pulling in `chrono` just to turn an ISO string into ms.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = (if y >= 0 { y } else { y - 399 }) / 400;
  let yoe = y - era * 400;
  let mp = if m > 2 { m - 3 } else { m + 9 };
  let doy = (153 * mp + 2) / 5 + d - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146097 + doe - 719468
}

/// Parse an ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SS[.fff]Z`) to epoch ms.
fn iso_to_epoch_ms(t: &str) -> Option<i64> {
  if t.len() < 19 {
    return None;
  }
  let year: i64 = t.get(0..4)?.parse().ok()?;
  let month: i64 = t.get(5..7)?.parse().ok()?;
  let day: i64 = t.get(8..10)?.parse().ok()?;
  let hour: i64 = t.get(11..13)?.parse().ok()?;
  let min: i64 = t.get(14..16)?.parse().ok()?;
  let sec: i64 = t.get(17..19)?.parse().ok()?;
  let ms: i64 = if t.len() > 20 && &t[19..20] == "." {
    let frac: String = t[20..].chars().take_while(|c| c.is_ascii_digit()).collect();
    let take = frac.len().min(3);
    format!("{:0<3}", &frac[..take]).parse().unwrap_or(0)
  } else {
    0
  };
  let days = days_from_civil(year, month, day);
  Some((days * 86400 + hour * 3600 + min * 60 + sec) * 1000 + ms)
}

/// Read a JSONL file into parsed values, silently dropping unparsable lines.
fn read_jsonl(path: &Path) -> Result<Vec<Value>, String> {
  let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
  Ok(
    text
      .lines()
      .filter(|l| !l.trim().is_empty())
      .filter_map(|l| serde_json::from_str::<Value>(l).ok())
      .collect(),
  )
}

// ── Claude Code ──────────────────────────────────────────────────────────────

fn claude_root() -> Option<PathBuf> {
  let home = dirs::home_dir()?;
  let root = std::env::var("CLAUDE_CONFIG_DIR")
    .map(PathBuf::from)
    .unwrap_or_else(|_| home.join(".claude"));
  Some(root.join("projects"))
}

/// Pull the four disjoint token components out of a Claude `message.usage`.
fn claude_usage(usage: &Value) -> TokenUsage {
  let input = u(usage, "input_tokens");
  let output = u(usage, "output_tokens");
  let cache_read = u(usage, "cache_read_input_tokens");
  let cache_write = u(usage, "cache_creation_input_tokens");
  TokenUsage {
    input,
    output,
    cache_read,
    cache_write,
    reasoning: 0,
    total: input + output + cache_read + cache_write,
  }
}

/// Text preview of a Claude message content (string or block array).
fn claude_content_text(content: &Value) -> String {
  match content {
    Value::String(s) => s.clone(),
    Value::Array(blocks) => {
      let mut out = String::new();
      for b in blocks {
        if let Some("text") = s(b, "type") {
          if let Some(t) = s(b, "text") {
            out.push_str(t);
            out.push(' ');
          }
        }
      }
      out
    }
    _ => String::new(),
  }
}

fn claude_summary(path: &Path, lines: &[Value]) -> Option<SessionSummary> {
  let id = path.file_stem()?.to_string_lossy().into_owned();
  let mut title: Option<String> = None;
  let mut first_user: Option<String> = None;
  let mut cwd = String::new();
  let mut git_branch: Option<String> = None;
  let mut models: Vec<String> = Vec::new();
  let mut usage = TokenUsage::default();
  let mut started: Option<i64> = None;
  let mut updated: Option<i64> = None;
  let mut count: u64 = 0;

  for line in lines {
    let ty = s(line, "type").unwrap_or("");
    if let Some(t) = s(line, "aiTitle") {
      if !t.trim().is_empty() {
        title = Some(truncate_title(t));
      }
    }
    if ty == "ai-title" {
      continue;
    }
    if cwd.is_empty() {
      if let Some(c) = s(line, "cwd") {
        cwd = c.to_string();
      }
    }
    if git_branch.is_none() {
      if let Some(b) = s(line, "gitBranch").filter(|b| !b.is_empty()) {
        git_branch = Some(b.to_string());
      }
    }
    if let Some(ms) = s(line, "timestamp").and_then(iso_to_epoch_ms) {
      started = Some(started.map_or(ms, |v: i64| v.min(ms)));
      updated = Some(updated.map_or(ms, |v: i64| v.max(ms)));
    }
    if ty == "user" || ty == "assistant" {
      let msg = line.get("message");
      let has_body = msg.map(|m| m.get("content").is_some()).unwrap_or(false);
      if has_body {
        count += 1;
      }
      if ty == "user" && first_user.is_none() {
        if let Some(m) = msg {
          let txt = claude_content_text(m.get("content").unwrap_or(&Value::Null));
          let txt = txt.trim();
          if !txt.is_empty() && !txt.starts_with('<') {
            first_user = Some(truncate_title(txt));
          }
        }
      }
      if ty == "assistant" {
        if let Some(m) = msg {
          // Skip Claude Code's `<synthetic>` marker (hook/injected turns) so the
          // session's primary model and pricing reflect the real model.
          if let Some(model) = s(m, "model").filter(|m| !m.is_empty() && *m != "<synthetic>") {
            if !models.iter().any(|x| x == model) {
              models.push(model.to_string());
            }
          }
          if let Some(us) = m.get("usage") {
            usage.add(&claude_usage(us));
          }
        }
      }
    }
  }

  Some(SessionSummary {
    id,
    source: "claude".into(),
    title: title.or(first_user).unwrap_or_else(|| "Untitled session".into()),
    project_name: if cwd.is_empty() { "—".into() } else { basename(&cwd) },
    cwd,
    model: models.last().cloned().unwrap_or_default(),
    models,
    message_count: count,
    usage,
    cost: None,
    started_at: started.unwrap_or(0),
    updated_at: updated.unwrap_or(0),
    path: path.to_string_lossy().into_owned(),
    git_branch,
  })
}

fn claude_detail(path: &Path, lines: &[Value]) -> SessionDetail {
  let summary = claude_summary(path, lines).unwrap_or_else(|| SessionSummary {
    id: String::new(),
    source: "claude".into(),
    title: "Untitled session".into(),
    cwd: String::new(),
    project_name: "—".into(),
    model: String::new(),
    models: Vec::new(),
    message_count: 0,
    usage: TokenUsage::default(),
    cost: None,
    started_at: 0,
    updated_at: 0,
    path: path.to_string_lossy().into_owned(),
    git_branch: None,
  });

  let mut messages = Vec::new();
  for line in lines {
    let ty = s(line, "type").unwrap_or("");
    if ty != "user" && ty != "assistant" {
      continue;
    }
    let Some(m) = line.get("message") else { continue };
    let Some(content) = m.get("content") else { continue };
    let id = s(line, "uuid").unwrap_or("").to_string();
    let ts = s(line, "timestamp").and_then(iso_to_epoch_ms);
    let mut msg = Message::new(id, ty);
    msg.ts = ts;
    if ty == "assistant" {
      msg.model = s(m, "model").map(String::from);
      if let Some(us) = m.get("usage") {
        msg.usage = Some(claude_usage(us));
      }
    }
    match content {
      Value::String(text) if !text.trim().is_empty() => {
        msg.parts.push(Part::text("text", text.clone()));
      }
      Value::Array(blocks) => {
        for b in blocks {
          match s(b, "type") {
            Some("text") => {
              if let Some(t) = s(b, "text") {
                msg.parts.push(Part::text("text", t.to_string()));
              }
            }
            Some("thinking") => {
              if let Some(t) = s(b, "thinking").filter(|t| !t.is_empty()) {
                msg.parts.push(Part::text("thinking", t.to_string()));
              }
            }
            Some("tool_use") => {
              let name = s(b, "name").map(String::from);
              let input = b
                .get("input")
                .map(|i| serde_json::to_string_pretty(i).unwrap_or_default())
                .unwrap_or_default();
              msg.parts.push(Part {
                kind: "toolCall".into(),
                text: input,
                name,
                call_id: s(b, "id").map(String::from),
                is_error: None,
              });
            }
            Some("tool_result") => {
              let text = match b.get("content") {
                Some(Value::String(t)) => t.clone(),
                Some(Value::Array(arr)) => arr
                  .iter()
                  .filter_map(|x| s(x, "text"))
                  .collect::<Vec<_>>()
                  .join("\n"),
                _ => String::new(),
              };
              msg.parts.push(Part {
                kind: "toolResult".into(),
                text,
                name: None,
                call_id: s(b, "tool_use_id").map(String::from),
                is_error: b.get("is_error").and_then(Value::as_bool),
              });
            }
            Some("image") => msg.parts.push(Part::text("image", "[image]".into())),
            _ => {}
          }
        }
      }
      _ => {}
    }
    if !msg.parts.is_empty() {
      messages.push(msg);
    }
  }
  SessionDetail { summary, messages }
}

fn scan_claude(out: &mut Vec<SessionSummary>) -> Result<(), String> {
  let Some(root) = claude_root() else { return Ok(()) };
  if !root.is_dir() {
    return Ok(());
  }
  for proj in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
    if !proj.path().is_dir() {
      continue;
    }
    for entry in fs::read_dir(proj.path()).map_err(|e| e.to_string())?.flatten() {
      let p = entry.path();
      if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        continue;
      }
      if let Ok(lines) = read_jsonl(&p) {
        if let Some(sum) = claude_summary(&p, &lines) {
          if sum.message_count > 0 {
            out.push(sum);
          }
        }
      }
    }
  }
  Ok(())
}

// ── Codex ────────────────────────────────────────────────────────────────────

fn codex_sessions_root() -> Option<PathBuf> {
  let home = dirs::home_dir()?;
  Some(codex_home(&home).join("sessions"))
}

/// Map of session id → thread name from `<codexHome>/session_index.jsonl`.
fn codex_titles() -> std::collections::HashMap<String, String> {
  let mut map = std::collections::HashMap::new();
  if let Some(home) = dirs::home_dir() {
    let idx = codex_home(&home).join("session_index.jsonl");
    if let Ok(text) = fs::read_to_string(&idx) {
      for line in text.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
          if let (Some(id), Some(name)) = (s(&v, "id"), s(&v, "thread_name")) {
            if !name.trim().is_empty() {
              map.insert(id.to_string(), name.to_string());
            }
          }
        }
      }
    }
  }
  map
}

/// Recursively collect every `*.jsonl` under `dir`.
fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
  let Ok(rd) = fs::read_dir(dir) else { return };
  for entry in rd.flatten() {
    let p = entry.path();
    if p.is_dir() {
      collect_jsonl(&p, out);
    } else if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
      out.push(p);
    }
  }
}

fn codex_token_usage(info: &Value) -> Option<TokenUsage> {
  let t = info.get("total_token_usage")?;
  let input = u(t, "input_tokens");
  let output = u(t, "output_tokens");
  Some(TokenUsage {
    input,
    output,
    cache_read: u(t, "cached_input_tokens"),
    cache_write: 0,
    reasoning: u(t, "reasoning_output_tokens"),
    // Codex's input already includes cached, output already includes reasoning,
    // so total is simply its authoritative `total_tokens` (input + output).
    total: t.get("total_tokens").and_then(Value::as_u64).unwrap_or(input + output),
  })
}

fn codex_summary(path: &Path, lines: &[Value], titles: &std::collections::HashMap<String, String>) -> Option<SessionSummary> {
  let mut id = path.file_stem()?.to_string_lossy().into_owned();
  let mut cwd = String::new();
  let mut models: Vec<String> = Vec::new();
  let mut title: Option<String> = None;
  let mut usage = TokenUsage::default();
  let mut started: Option<i64> = None;
  let mut updated: Option<i64> = None;
  let mut count: u64 = 0;

  for line in lines {
    let ty = s(line, "type").unwrap_or("");
    if let Some(ms) = s(line, "timestamp").and_then(iso_to_epoch_ms) {
      started = Some(started.map_or(ms, |v: i64| v.min(ms)));
      updated = Some(updated.map_or(ms, |v: i64| v.max(ms)));
    }
    let payload = line.get("payload").unwrap_or(&Value::Null);
    match ty {
      "session_meta" => {
        if let Some(mid) = s(payload, "id") {
          id = mid.to_string();
        }
        if let Some(c) = s(payload, "cwd") {
          cwd = c.to_string();
        }
      }
      "turn_context" => {
        if let Some(model) = s(payload, "model") {
          if !models.iter().any(|x| x == model) {
            models.push(model.to_string());
          }
        }
      }
      "event_msg" => match s(payload, "type") {
        Some("user_message") => {
          count += 1;
          if title.is_none() {
            if let Some(msg) = s(payload, "message") {
              let msg = msg.trim();
              if !msg.is_empty() && !msg.starts_with('#') && !msg.starts_with('<') {
                title = Some(truncate_title(msg));
              }
            }
          }
        }
        Some("agent_message") => count += 1,
        Some("token_count") => {
          if let Some(info) = payload.get("info").filter(|i| !i.is_null()) {
            if let Some(us) = codex_token_usage(info) {
              usage = us; // total_token_usage is cumulative → keep the latest.
            }
          }
        }
        _ => {}
      },
      _ => {}
    }
  }

  let title = titles
    .get(&id)
    .map(|t| truncate_title(t))
    .or(title)
    .unwrap_or_else(|| "Untitled session".into());

  Some(SessionSummary {
    id,
    source: "codex".into(),
    title,
    project_name: if cwd.is_empty() { "—".into() } else { basename(&cwd) },
    cwd,
    model: models.last().cloned().unwrap_or_default(),
    models,
    message_count: count,
    usage,
    cost: None,
    started_at: started.unwrap_or(0),
    updated_at: updated.unwrap_or(0),
    path: path.to_string_lossy().into_owned(),
    git_branch: None,
  })
}

/// Flatten a Codex `content` array (input_text / output_text blocks) to text.
fn codex_content_text(content: &Value) -> String {
  content
    .as_array()
    .map(|arr| {
      arr
        .iter()
        .filter_map(|b| s(b, "text"))
        .collect::<Vec<_>>()
        .join("\n")
    })
    .unwrap_or_default()
}

fn codex_detail(path: &Path, lines: &[Value], titles: &std::collections::HashMap<String, String>) -> SessionDetail {
  let summary = codex_summary(path, lines, titles).unwrap();
  let mut messages: Vec<Message> = Vec::new();
  // Group consecutive assistant-side items (reasoning, text, tool calls) into a
  // single assistant turn; a user message flushes the current turn.
  let mut cur: Option<Message> = None;
  fn flush(cur: &mut Option<Message>, messages: &mut Vec<Message>) {
    if let Some(m) = cur.take() {
      if !m.parts.is_empty() {
        messages.push(m);
      }
    }
  }
  fn assistant(cur: &mut Option<Message>, id: String, ts: Option<i64>) -> &mut Message {
    if cur.is_none() {
      let mut m = Message::new(id, "assistant");
      m.ts = ts;
      *cur = Some(m);
    }
    cur.as_mut().unwrap()
  }

  for (i, line) in lines.iter().enumerate() {
    let ty = s(line, "type").unwrap_or("");
    let ts = s(line, "timestamp").and_then(iso_to_epoch_ms);
    let payload = line.get("payload").unwrap_or(&Value::Null);
    let pty = s(payload, "type").unwrap_or("");
    match (ty, pty) {
      ("event_msg", "user_message") => {
        flush(&mut cur, &mut messages);
        if let Some(text) = s(payload, "message") {
          let mut m = Message::new(format!("u{i}"), "user");
          m.ts = ts;
          m.parts.push(Part::text("text", text.to_string()));
          messages.push(m);
        }
      }
      ("event_msg", "agent_message") => {
        if let Some(text) = s(payload, "message").filter(|t| !t.trim().is_empty()) {
          assistant(&mut cur, format!("a{i}"), ts)
            .parts
            .push(Part::text("text", text.to_string()));
        }
      }
      ("response_item", "reasoning") => {
        // Only the summary is human-readable; encrypted content is skipped.
        let text = payload
          .get("summary")
          .and_then(Value::as_array)
          .map(|a| a.iter().filter_map(|x| s(x, "text")).collect::<Vec<_>>().join("\n"))
          .unwrap_or_default();
        if !text.trim().is_empty() {
          assistant(&mut cur, format!("a{i}"), ts).parts.push(Part::text("thinking", text));
        }
      }
      ("response_item", "message") if s(payload, "role") == Some("assistant") => {
        // Assistant output_text turns (some flows use these instead of agent_message).
        let text = codex_content_text(payload.get("content").unwrap_or(&Value::Null));
        if !text.trim().is_empty() {
          assistant(&mut cur, format!("a{i}"), ts).parts.push(Part::text("text", text));
        }
      }
      ("response_item", "function_call") | ("response_item", "custom_tool_call") => {
        let name = s(payload, "name").map(String::from);
        let input = s(payload, "arguments").or_else(|| s(payload, "input")).unwrap_or("").to_string();
        assistant(&mut cur, format!("a{i}"), ts).parts.push(Part {
          kind: "toolCall".into(),
          text: input,
          name,
          call_id: s(payload, "call_id").map(String::from),
          is_error: None,
        });
      }
      ("response_item", "function_call_output") | ("response_item", "custom_tool_call_output") => {
        let text = match payload.get("output") {
          Some(Value::String(t)) => t.clone(),
          Some(other) => serde_json::to_string(other).unwrap_or_default(),
          None => String::new(),
        };
        assistant(&mut cur, format!("a{i}"), ts).parts.push(Part {
          kind: "toolResult".into(),
          text,
          name: None,
          call_id: s(payload, "call_id").map(String::from),
          is_error: None,
        });
      }
      ("response_item", "web_search_call") => {
        let q = payload
          .get("action")
          .and_then(|a| s(a, "query").or_else(|| s(a, "url")))
          .unwrap_or("")
          .to_string();
        assistant(&mut cur, format!("a{i}"), ts).parts.push(Part {
          kind: "webSearch".into(),
          text: q,
          name: None,
          call_id: None,
          is_error: None,
        });
      }
      _ => {}
    }
  }
  flush(&mut cur, &mut messages);
  SessionDetail { summary, messages }
}

fn scan_codex(out: &mut Vec<SessionSummary>) -> Result<(), String> {
  let Some(root) = codex_sessions_root() else { return Ok(()) };
  if !root.is_dir() {
    return Ok(());
  }
  let titles = codex_titles();
  let mut files = Vec::new();
  collect_jsonl(&root, &mut files);
  for p in files {
    if let Ok(lines) = read_jsonl(&p) {
      if let Some(sum) = codex_summary(&p, &lines, &titles) {
        if sum.message_count > 0 {
          out.push(sum);
        }
      }
    }
  }
  Ok(())
}

// ── OpenCode ─────────────────────────────────────────────────────────────────

/// First existing OpenCode data directory across the platform-specific
/// candidates. OpenCode follows XDG on all platforms, but honors overrides.
fn opencode_db() -> Option<PathBuf> {
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

fn scan_opencode(out: &mut Vec<SessionSummary>) -> Result<(), String> {
  if opencode_db().is_none() {
    return Ok(()); // Not installed → absent, not an error.
  }
  let conn = opencode_conn()?;
  let mut stmt = conn
    .prepare(
      "SELECT s.id, s.title, s.slug, s.directory, s.model, s.cost, \
       s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read, \
       s.tokens_cache_write, s.time_created, s.time_updated, \
       (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS msg_count \
       FROM session s ORDER BY s.time_updated DESC",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |r| {
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
        project_name: if directory.is_empty() { "—".into() } else { basename(&directory) },
        cwd: directory,
        models: if model.is_empty() { Vec::new() } else { vec![model.clone()] },
        model,
        message_count: r.get::<_, Option<i64>>(13)?.unwrap_or(0) as u64,
        usage,
        cost: r.get::<_, Option<f64>>(5)?,
        started_at: r.get::<_, Option<i64>>(11)?.unwrap_or(0),
        updated_at: r.get::<_, Option<i64>>(12)?.unwrap_or(0),
        path: r.get(0)?,
        git_branch: None,
      })
    })
    .map_err(|e| e.to_string())?;
  for sum in rows.flatten() {
    out.push(sum);
  }
  Ok(())
}

fn opencode_detail(id: &str) -> Result<SessionDetail, String> {
  let conn = opencode_conn()?;
  let mut summaries = Vec::new();
  scan_opencode(&mut summaries).ok();
  let summary = summaries
    .into_iter()
    .find(|s| s.id == id)
    .ok_or("session not found")?;

  let mut stmt = conn
    .prepare("SELECT id, data FROM message WHERE session_id = ?1 ORDER BY time_created")
    .map_err(|e| e.to_string())?;
  let msg_rows: Vec<(String, String)> = stmt
    .query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
    .map_err(|e| e.to_string())?
    .filter_map(Result::ok)
    .collect();

  let mut part_stmt = conn
    .prepare("SELECT data FROM part WHERE message_id = ?1 ORDER BY time_created")
    .map_err(|e| e.to_string())?;

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

    let parts: Vec<Value> = part_stmt
      .query_map([&mid], |r| r.get::<_, String>(0))
      .map_err(|e| e.to_string())?
      .filter_map(Result::ok)
      .filter_map(|d| serde_json::from_str::<Value>(&d).ok())
      .collect();
    for p in &parts {
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
            is_error: None,
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
            });
          }
        }
        Some("patch") => {
          let files = p
            .get("files")
            .and_then(Value::as_object)
            .map(|o| o.keys().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
          msg.parts.push(Part::text("patch", if files.is_empty() { "[patch]".into() } else { files }));
        }
        _ => {}
      }
    }
    if !msg.parts.is_empty() {
      messages.push(msg);
    }
  }
  Ok(SessionDetail { summary, messages })
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Scan every installed source and return normalized session summaries plus any
/// per-source read errors (a *missing* source is silently absent, not an error).
#[tauri::command(async)]
pub fn history_list_sessions() -> ListResult {
  let mut sessions = Vec::new();
  let mut errors = Vec::new();
  if let Err(e) = scan_claude(&mut sessions) {
    errors.push(SourceError { source: "claude".into(), message: e });
  }
  if let Err(e) = scan_codex(&mut sessions) {
    errors.push(SourceError { source: "codex".into(), message: e });
  }
  if let Err(e) = scan_opencode(&mut sessions) {
    errors.push(SourceError { source: "opencode".into(), message: e });
  }
  sessions.sort_by_key(|b| std::cmp::Reverse(b.updated_at));
  ListResult { sessions, errors }
}

/// Load one session's full transcript. `path` is the file path (Claude/Codex) or
/// the session id (OpenCode), exactly as carried on the summary's `path`.
#[tauri::command(async)]
pub fn history_get_session(source: String, path: String) -> Result<SessionDetail, String> {
  match source.as_str() {
    "claude" => {
      let p = PathBuf::from(&path);
      let lines = read_jsonl(&p)?;
      Ok(claude_detail(&p, &lines))
    }
    "codex" => {
      let p = PathBuf::from(&path);
      let lines = read_jsonl(&p)?;
      Ok(codex_detail(&p, &lines, &codex_titles()))
    }
    "opencode" => opencode_detail(&path),
    other => Err(format!("unknown history source: {other}")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn iso_to_epoch_ms_matches_known_instants() {
    assert_eq!(iso_to_epoch_ms("1970-01-01T00:00:00.000Z"), Some(0));
    assert_eq!(iso_to_epoch_ms("1970-01-01T00:00:01Z"), Some(1000));
    // 2026-06-15T05:45:41.325Z — verified against a reference epoch.
    assert_eq!(iso_to_epoch_ms("2026-06-15T05:45:41.325Z"), Some(1781502341325));
  }

  #[test]
  fn basename_handles_both_separators() {
    assert_eq!(basename("D:\\Project\\Cognia"), "Cognia");
    assert_eq!(basename("/home/u/proj"), "proj");
    assert_eq!(basename("/home/u/proj/"), "proj");
  }

  #[test]
  fn truncate_title_collapses_and_caps() {
    assert_eq!(truncate_title("  hi\nthere  "), "hi there");
    let long = "x".repeat(200);
    let t = truncate_title(&long);
    assert_eq!(t.chars().count(), 81); // 80 + ellipsis
  }

  #[test]
  fn claude_usage_sums_disjoint_components() {
    let v: Value = serde_json::from_str(
      r#"{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":5,"cache_creation_input_tokens":3}"#,
    )
    .unwrap();
    let u = claude_usage(&v);
    assert_eq!(u.total, 38);
    assert_eq!(u.cache_read, 5);
    assert_eq!(u.cache_write, 3);
  }

  #[test]
  fn codex_token_usage_uses_authoritative_total() {
    let v: Value = serde_json::from_str(
      r#"{"total_token_usage":{"input_tokens":9634,"cached_input_tokens":7296,"output_tokens":581,"reasoning_output_tokens":408,"total_tokens":10215}}"#,
    )
    .unwrap();
    let u = codex_token_usage(&v).unwrap();
    assert_eq!(u.total, 10215);
    assert_eq!(u.cache_read, 7296);
    assert_eq!(u.reasoning, 408);
  }

  #[test]
  fn claude_detail_normalizes_blocks() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hello"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"assistant","uuid":"a1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"hi"},{"type":"tool_use","id":"t1","name":"Read","input":{"file":"x"}}],"usage":{"input_tokens":1,"output_tokens":2}}}"#).unwrap(),
    ];
    let d = claude_detail(Path::new("s.jsonl"), &lines);
    assert_eq!(d.messages.len(), 2);
    assert_eq!(d.messages[0].role, "user");
    assert_eq!(d.messages[1].parts.len(), 3);
    assert_eq!(d.messages[1].parts[2].kind, "toolCall");
    assert_eq!(d.messages[1].model.as_deref(), Some("claude-opus-4-8"));
  }

  #[test]
  fn claude_summary_skips_synthetic_model() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","cwd":"/proj","message":{"role":"user","content":"hi"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"assistant","timestamp":"2026-01-01T00:00:01Z","message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"assistant","timestamp":"2026-01-01T00:00:02Z","message":{"role":"assistant","model":"<synthetic>","content":[{"type":"text","text":"hook"}]}}"#).unwrap(),
    ];
    let sum = claude_summary(Path::new("s.jsonl"), &lines).unwrap();
    // The real model wins over the trailing `<synthetic>` marker.
    assert_eq!(sum.model, "claude-opus-4-8");
    assert_eq!(sum.models, vec!["claude-opus-4-8".to_string()]);
  }

  #[test]
  fn codex_detail_groups_assistant_turn() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"sess1","cwd":"/proj"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:01Z","payload":{"type":"user_message","message":"do it"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"response_item","timestamp":"2026-01-01T00:00:02Z","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"planning"}]}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:03Z","payload":{"type":"agent_message","message":"done"}}"#).unwrap(),
    ];
    let d = codex_detail(Path::new("r.jsonl"), &lines, &std::collections::HashMap::new());
    assert_eq!(d.messages.len(), 2);
    assert_eq!(d.messages[0].role, "user");
    assert_eq!(d.messages[1].role, "assistant");
    assert_eq!(d.messages[1].parts.len(), 2); // thinking + text
  }
}
