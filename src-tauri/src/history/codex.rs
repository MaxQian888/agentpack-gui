//! Codex rollout reader.
//!
//! One JSONL "rollout" per session under
//! `<codexHome>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, every line a
//! `{timestamp,type,payload}` envelope. Token totals arrive in `token_count`
//! events and a sibling `session_index.jsonl` maps ids to thread names.
//!
//! A spawned sub-agent gets a rollout of its own, tagged in `session_meta` with
//! its parent thread and canonical agent path — and the agents talk to each
//! other through `agent_message` records written to the *recipient's* rollout,
//! which is why a sub-agent's own first user message is its parent's prompt.

use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::paths::codex_home;

use super::scan::{file_sig, FileSig};
use super::util::{basename, collect_jsonl, iso_to_epoch_ms, s, stream_jsonl, truncate_title, u};
use super::{
  model_index, pack_event, Message, PackedEvent, ParsedSession, Part,
  SessionDetail, SessionIdentity, SummaryFields, TokenUsage, ToolTally,
};

fn codex_sessions_root() -> Option<PathBuf> {
  let home = dirs::home_dir()?;
  Some(codex_home(&home).join("sessions"))
}

/// Map of session id → thread name from `<codexHome>/session_index.jsonl`.
pub(super) fn codex_titles() -> std::collections::HashMap<String, String> {
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

/// One Codex usage block (`total_token_usage` or `last_token_usage`).
fn codex_usage_block(t: &Value) -> TokenUsage {
  let input = u(t, "input_tokens");
  let output = u(t, "output_tokens");
  TokenUsage {
    input,
    output,
    cache_read: u(t, "cached_input_tokens"),
    cache_write: 0,
    reasoning: u(t, "reasoning_output_tokens"),
    // Codex's input already includes cached, output already includes reasoning,
    // so total is simply its authoritative `total_tokens` (input + output).
    total: t
      .get("total_tokens")
      .and_then(Value::as_u64)
      .unwrap_or(input + output),
  }
}

pub(super) fn codex_token_usage(info: &Value) -> Option<TokenUsage> {
  info.get("total_token_usage").map(codex_usage_block)
}

/// The *delta* a `token_count` event reports — what this turn alone consumed.
/// `total_token_usage` beside it is cumulative and is what the summary keeps.
fn codex_last_usage(info: &Value) -> Option<TokenUsage> {
  info.get("last_token_usage").map(codex_usage_block)
}

/// Sub-agent identity read off a Codex rollout's own `session_meta`.
///
/// Codex records a spawned agent's thread as a rollout file of its own, tagged
/// `thread_source: "subagent"` with a `source.subagent.thread_spawn` block
/// naming the thread that spawned it and the agent's canonical path. Plain
/// forks and resumes carry `parent_thread_id` too, so that field alone must
/// never be read as "this is a sub-agent" — the spawn block (or the
/// `thread_source` tag) is the marker.
struct CodexSubagent {
  parent_id: String,
  /// Canonical agent path, e.g. `/root/pip_i18n`.
  path: Option<String>,
  /// Custom-agent role (`i18n-reviewer`) — absent for the built-in agents.
  role: Option<String>,
  /// Random per-thread nickname Codex assigns (`Euclid`).
  nickname: Option<String>,
}

impl CodexSubagent {
  /// Short label naming this agent in the list. The path's last segment is the
  /// task name the orchestrator chose (`pip_i18n`) and is unique among
  /// siblings, so it beats the role (shared across runs, often absent) and the
  /// nickname (random).
  fn label(&self) -> Option<String> {
    self
      .path
      .as_deref()
      .map(basename)
      .or_else(|| self.role.clone())
      .or_else(|| self.nickname.clone())
      .filter(|l| !l.trim().is_empty())
      .map(|l| truncate_title(&l))
  }
}

/// Read the sub-agent block out of a `session_meta` payload, or `None` for an
/// ordinary (user-started, forked, resumed) thread.
fn codex_subagent(payload: &Value) -> Option<CodexSubagent> {
  let spawn = payload.pointer("/source/subagent/thread_spawn");
  if spawn.is_none() && s(payload, "thread_source") != Some("subagent") {
    return None;
  }
  // Fields live in the spawn block; older rollouts only mirror them at the top
  // level of the payload, so fall back there.
  let pick = |key: &str| -> Option<String> {
    spawn
      .and_then(|v| s(v, key))
      .or_else(|| s(payload, key))
      .filter(|v| !v.is_empty())
      .map(String::from)
  };
  Some(CodexSubagent {
    parent_id: pick("parent_thread_id")?,
    path: pick("agent_path"),
    role: pick("agent_role"),
    nickname: pick("agent_nickname"),
  })
}

/// Streaming fold over a Codex rollout's lines (mirrors `ClaudeAcc`). The
/// session id can be overridden by a `session_meta` record, so `finish` takes
/// the file-stem fallback and resolves the display title against `titles`.
struct CodexAcc {
  meta_id: Option<String>,
  subagent: Option<CodexSubagent>,
  cwd: String,
  models: Vec<String>,
  title: Option<String>,
  usage: TokenUsage,
  started: Option<i64>,
  updated: Option<i64>,
  count: u64,
  /// Index into `models` of the model the current turn runs on, `-1` until the
  /// first `turn_context`.
  model_idx: i64,
  events: Vec<PackedEvent>,
  tools: ToolTally,
}

impl Default for CodexAcc {
  fn default() -> Self {
    CodexAcc {
      meta_id: None,
      subagent: None,
      cwd: String::new(),
      models: Vec::new(),
      title: None,
      usage: TokenUsage::default(),
      started: None,
      updated: None,
      count: 0,
      model_idx: -1,
      events: Vec::new(),
      tools: ToolTally::default(),
    }
  }
}

impl CodexAcc {
  fn push(&mut self, line: &Value) {
    let ty = s(line, "type").unwrap_or("");
    let ts = s(line, "timestamp").and_then(iso_to_epoch_ms);
    if let Some(ms) = ts {
      self.started = Some(self.started.map_or(ms, |v: i64| v.min(ms)));
      self.updated = Some(self.updated.map_or(ms, |v: i64| v.max(ms)));
    }
    let payload = line.get("payload").unwrap_or(&Value::Null);
    match ty {
      // Only the FIRST `session_meta` describes this file. A forked / sub-agent
      // rollout replays the parent thread's history, which carries the parent's
      // own `session_meta` along with it — letting a later record win would
      // stamp every sibling fork with the parent's id and collapse them into
      // one duplicated entry in the list.
      "session_meta" if self.meta_id.is_none() => {
        self.meta_id = s(payload, "id").map(String::from);
        self.subagent = codex_subagent(payload);
        if let Some(c) = s(payload, "cwd") {
          self.cwd = c.to_string();
        }
      }
      // Every later event is attributed to the model this turn runs on.
      "turn_context" if s(payload, "model").is_some() => {
        self.model_idx = model_index(&mut self.models, s(payload, "model"));
      }
      // Codex writes tool output as free text with no failure flag, so calls are
      // counted and errors are left at zero rather than guessed at.
      "response_item" => {
        if matches!(
          s(payload, "type"),
          Some("function_call") | Some("custom_tool_call")
        ) {
          if let Some(name) = s(payload, "name") {
            self.tools.call(name, s(payload, "call_id"));
          }
        }
      }
      "event_msg" => match s(payload, "type") {
        Some("user_message") => {
          self.count += 1;
          if self.title.is_none() {
            if let Some(msg) = s(payload, "message") {
              let msg = msg.trim();
              if !msg.is_empty() && !msg.starts_with('#') && !msg.starts_with('<') {
                self.title = Some(truncate_title(msg));
              }
            }
          }
        }
        Some("agent_message") => self.count += 1,
        Some("token_count") => {
          if let Some(info) = payload.get("info").filter(|i| !i.is_null()) {
            if let Some(us) = codex_token_usage(info) {
              self.usage = us; // total_token_usage is cumulative → keep the latest.
            }
            // The per-turn delta beside it is what the series wants: summing
            // the cumulative field would square the session's token count.
            if let Some(delta) = codex_last_usage(info) {
              if let Some(ev) = pack_event(ts.unwrap_or(0), self.model_idx, &delta) {
                self.events.push(ev);
              }
            }
          }
        }
        _ => {}
      },
      _ => {}
    }
  }

  fn finish(
    self,
    fallback_id: String,
    path: &Path,
    titles: &HashMap<String, String>,
  ) -> ParsedSession {
    let id = self.meta_id.unwrap_or(fallback_id);
    let agent_name = self.subagent.as_ref().and_then(CodexSubagent::label);
    // A sub-agent rollout opens by replaying the parent thread's history, so its
    // first user message is the *parent's* prompt — naming it after the agent
    // keeps siblings apart instead of showing one prompt N times.
    let title = titles
      .get(&id)
      .map(|t| truncate_title(t))
      .or_else(|| agent_name.clone())
      .or(self.title)
      .unwrap_or_else(|| "Untitled session".into());
    let project_name: String = if self.cwd.is_empty() {
      "—".into()
    } else {
      basename(&self.cwd)
    };
    let parent_id = self.subagent.map(|sa| sa.parent_id);
    ParsedSession::assemble(
      SessionIdentity {
        id,
        source: "codex",
        project_name,
        // Codex rollouts record no git branch.
        git_branch: None,
        parent_id,
        models: self.models,
      },
      SummaryFields {
        title,
        cwd: self.cwd,
        message_count: self.count,
        usage: self.usage,
        started_at: self.started.unwrap_or(0),
        updated_at: self.updated.unwrap_or(0),
        path: path.to_string_lossy().into_owned(),
        agent_name,
        // Codex records no per-turn durations.
        duration_ms: None,
      },
      self.events,
      self.tools.finish(),
    )
  }
}

pub(super) fn codex_parse(
  path: &Path,
  lines: &[Value],
  titles: &HashMap<String, String>,
) -> Option<ParsedSession> {
  let fallback_id = path.file_stem()?.to_string_lossy().into_owned();
  let mut acc = CodexAcc::default();
  for line in lines {
    acc.push(line);
  }
  Some(acc.finish(fallback_id, path, titles))
}

/// Streaming parse read straight from disk — the scan path's entry point.
pub(super) fn codex_parse_from_file(path: &Path, titles: &HashMap<String, String>) -> Option<ParsedSession> {
  let fallback_id = path.file_stem()?.to_string_lossy().into_owned();
  let mut acc = CodexAcc::default();
  stream_jsonl(path, |line| acc.push(line))?;
  Some(acc.finish(fallback_id, path, titles))
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

/// Split a Codex inter-agent message into its envelope kind and its body.
///
/// The readable `content` blocks join into a small header — `Message Type: …`,
/// `Task name: …`, `Sender: …`, `Payload:` — followed by the payload itself.
/// (The rest of the message rides along as an `encrypted_content` block, which
/// carries no readable text at all.)
pub(super) fn split_agent_message(text: &str) -> (Option<String>, String) {
  let Some(rest) = text.trim_start().strip_prefix("Message Type: ") else {
    return (None, text.trim().to_string());
  };
  let (kind, after) = rest.split_once('\n').unwrap_or((rest, ""));
  let body = after
    .split_once("Payload:")
    .map_or(after, |(_, payload)| payload);
  (Some(kind.trim().to_string()), body.trim().to_string())
}

/// Codex encrypts the `message` field of its agent-orchestration tool calls
/// (`spawn_agent`, `send_message`, …): a multi-KB Fernet token that would
/// otherwise *be* the visible payload of the call. Swap any such blob for a
/// marker — the readable copy of that same message reaches the recipient's
/// rollout as an `agent_message` record, which is where the transcript shows
/// it. Arguments without a blob are returned byte-for-byte.
pub(super) fn redact_encrypted_args(input: &str) -> String {
  // Fernet tokens base64 a leading 0x80 version byte, hence the fixed prefix.
  if !input.contains("gAAAAA") {
    return input.to_string();
  }
  let Ok(Value::Object(mut map)) = serde_json::from_str::<Value>(input) else {
    return input.to_string();
  };
  let mut redacted = false;
  for v in map.values_mut() {
    if let Value::String(blob) = v {
      if blob.len() > 256 && blob.starts_with("gAAAAA") {
        *v = Value::String(format!("<encrypted, {} bytes>", blob.len()));
        redacted = true;
      }
    }
  }
  if !redacted {
    return input.to_string();
  }
  serde_json::to_string_pretty(&Value::Object(map)).unwrap_or_else(|_| input.to_string())
}

pub(super) fn codex_detail(
  path: &Path,
  lines: &[Value],
  titles: &std::collections::HashMap<String, String>,
) -> SessionDetail {
  let summary = codex_parse(path, lines, titles).unwrap().summary;
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
          .map(|a| {
            a.iter()
              .filter_map(|x| s(x, "text"))
              .collect::<Vec<_>>()
              .join("\n")
          })
          .unwrap_or_default();
        if !text.trim().is_empty() {
          assistant(&mut cur, format!("a{i}"), ts)
            .parts
            .push(Part::text("thinking", text));
        }
      }
      ("response_item", "message") if s(payload, "role") == Some("assistant") => {
        // Assistant output_text turns (some flows use these instead of agent_message).
        let text = codex_content_text(payload.get("content").unwrap_or(&Value::Null));
        if !text.trim().is_empty() {
          assistant(&mut cur, format!("a{i}"), ts)
            .parts
            .push(Part::text("text", text));
        }
      }
      ("response_item", "function_call") | ("response_item", "custom_tool_call") => {
        let name = s(payload, "name").map(String::from);
        let input = redact_encrypted_args(
          s(payload, "arguments")
            .or_else(|| s(payload, "input"))
            .unwrap_or(""),
        );
        assistant(&mut cur, format!("a{i}"), ts).parts.push(Part {
          kind: "toolCall".into(),
          text: input,
          name,
          call_id: s(payload, "call_id").map(String::from),
          ..Part::default()
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
          ..Part::default()
        });
      }
      // Multi-agent traffic. An `agent_message` is written to the *recipient's*
      // rollout, so in a parent transcript these are the sub-agents reporting
      // back — the substance of a delegated run, and invisible anywhere else.
      ("response_item", "agent_message") => {
        let raw = codex_content_text(payload.get("content").unwrap_or(&Value::Null));
        let (envelope, body) = split_agent_message(&raw);
        if envelope.is_some() || !body.is_empty() {
          assistant(&mut cur, format!("a{i}"), ts).parts.push(Part {
            kind: "agentMessage".into(),
            text: body,
            name: envelope,
            agent: s(payload, "author")
              .or_else(|| s(payload, "recipient"))
              .map(String::from),
            ..Part::default()
          });
        }
      }
      // Lifecycle of a spawned agent, which lives in its own rollout file — this
      // is the only trace of it in the thread that started it.
      ("event_msg", "sub_agent_activity") => {
        assistant(&mut cur, format!("a{i}"), ts).parts.push(Part {
          kind: "subagentActivity".into(),
          name: s(payload, "kind").map(String::from),
          agent: s(payload, "agent_path").map(String::from),
          ..Part::default()
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
          ..Part::default()
        });
      }
      _ => {}
    }
  }
  flush(&mut cur, &mut messages);
  SessionDetail { summary, messages }
}

/// Every Codex rollout with its signature, plus the session-index titles the
/// parser needs (read once for the whole scan).
pub(super) fn codex_sigs() -> Result<(Vec<FileSig>, HashMap<String, String>), String> {
  let Some(root) = codex_sessions_root() else {
    return Ok((Vec::new(), HashMap::new()));
  };
  if !root.is_dir() {
    return Ok((Vec::new(), HashMap::new()));
  }
  let mut files = Vec::new();
  collect_jsonl(&root, &mut files);
  Ok((
    files.into_iter().filter_map(file_sig).collect(),
    codex_titles(),
  ))
}

