//! Claude Code transcript reader.
//!
//! One JSONL file per session under
//! `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, each line a typed
//! record (`user`/`assistant`/`system`/`ai-title`/…) with assistant lines
//! carrying a `message.usage` block. Sub-agent runs get their own transcripts a
//! level deeper in `<session-id>/subagents/`, and oversized tool outputs are
//! externalized to `<session-id>/tool-results/<id>.txt`, leaving only a
//! `<persisted-output>` stub inline.
//!
//! The load-bearing subtlety lives in [`ClaudeAcc`]: Claude writes **one line
//! per content block** of a streamed turn, each repeating the same whole-turn
//! `usage`, so usage is counted once per `(message.id, requestId)`. Without that
//! gate the token totals read about 2.4x high.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use super::scan::{file_sig, FileSig};
use super::util::{basename, collect_jsonl, iso_to_epoch_ms, s, stream_jsonl, truncate_title, u};
use super::{
  model_index, pack_event, Message, PackedEvent, ParsedSession, Part, SessionDetail,
  SessionIdentity, SessionSummary, SummaryFields, TokenUsage, ToolTally,
};

pub(super) fn claude_root() -> Option<PathBuf> {
  let home = dirs::home_dir()?;
  let root = std::env::var("CLAUDE_CONFIG_DIR")
    .map(PathBuf::from)
    .unwrap_or_else(|_| home.join(".claude"));
  Some(root.join("projects"))
}

/// Pull the four disjoint token components out of a Claude `message.usage`.
pub(super) fn claude_usage(usage: &Value) -> TokenUsage {
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

/// Streaming fold over a Claude session's lines. `push` absorbs one record at a
/// time so a summary can be built without materializing the whole file; `finish`
/// turns the accumulated state into a `SessionSummary`.
#[derive(Default)]
struct ClaudeAcc {
  title: Option<String>,
  first_user: Option<String>,
  cwd: String,
  git_branch: Option<String>,
  models: Vec<String>,
  usage: TokenUsage,
  started: Option<i64>,
  updated: Option<i64>,
  count: u64,
  agent_name: Option<String>,
  duration_ms: Option<i64>,
  /// Assistant usage keys already counted, as `(message.id, requestId)`.
  ///
  /// Claude Code writes **one JSONL line per content block** of a streamed
  /// assistant turn — a `thinking` line, a `text` line, one line per `tool_use`
  /// — and every one of them repeats the same `message.id`, the same
  /// `requestId` and the same (whole-turn) `usage` object. Summing them
  /// inflates both tokens and message count by the number of blocks: measured
  /// across real transcripts that is ~2.4×, with 1511 assistant lines carrying
  /// only 626 distinct message ids. Counting a turn once, keyed the way ccusage
  /// keys it, is what makes the usage dashboard's numbers mean anything.
  seen_usage: std::collections::HashSet<(String, String)>,
  /// Every `message.id` counted so far. A sidechain replays a parent turn under
  /// a *new* `requestId`, which the exact key above would let through — so a
  /// sidechain line whose id is already counted is dropped too. A non-sidechain
  /// line with a new `requestId` is a genuine retry and still counts.
  seen_ids: std::collections::HashSet<String>,
  events: Vec<PackedEvent>,
  tools: ToolTally,
}

/// What one assistant line may contribute.
///
/// The two verdicts differ because Claude splits a turn's content blocks
/// *across* its lines while repeating the turn's `usage` on every one of them:
/// only the first line carries a new bill, but each line carries content
/// nothing else has.
struct TurnGate {
  usage: bool,
  content: bool,
}

impl ClaudeAcc {
  fn push(&mut self, line: &Value) {
    let ty = s(line, "type").unwrap_or("");
    if let Some(t) = s(line, "aiTitle") {
      if !t.trim().is_empty() {
        self.title = Some(truncate_title(t));
      }
    }
    if ty == "ai-title" {
      return;
    }
    if ty == "agent-name" {
      if let Some(n) = s(line, "agentName").filter(|n| !n.trim().is_empty()) {
        self.agent_name = Some(truncate_title(n));
      }
      return;
    }
    // `turn_duration` reports the wall-clock time of one completed turn; summing
    // them gives the session's real working time, which token counts don't show.
    // Falls through so the record's timestamp still widens the session range.
    if ty == "system" && s(line, "subtype") == Some("turn_duration") {
      if let Some(ms) = line.get("durationMs").and_then(Value::as_i64) {
        self.duration_ms = Some(self.duration_ms.unwrap_or(0) + ms);
      }
    }
    if self.cwd.is_empty() {
      if let Some(c) = s(line, "cwd") {
        self.cwd = c.to_string();
      }
    }
    if self.git_branch.is_none() {
      if let Some(b) = s(line, "gitBranch").filter(|b| !b.is_empty()) {
        self.git_branch = Some(b.to_string());
      }
    }
    let ts = s(line, "timestamp").and_then(iso_to_epoch_ms);
    if let Some(ms) = ts {
      self.started = Some(self.started.map_or(ms, |v: i64| v.min(ms)));
      self.updated = Some(self.updated.map_or(ms, |v: i64| v.max(ms)));
    }
    if ty == "user" || ty == "assistant" {
      let msg = line.get("message");
      let has_body = msg.map(|m| m.get("content").is_some()).unwrap_or(false);
      // Assistant turns are counted once per distinct message below, where the
      // dedup verdict is known; user turns arrive as one line each already.
      if has_body && ty == "user" {
        self.count += 1;
      }
      if ty == "user" && self.first_user.is_none() {
        if let Some(m) = msg {
          let txt = claude_content_text(m.get("content").unwrap_or(&Value::Null));
          let txt = txt.trim();
          if !txt.is_empty() && !txt.starts_with('<') {
            self.first_user = Some(truncate_title(txt));
          }
        }
      }
      // A `tool_result` rides on the *user* line that answers the tool call, so
      // failures are attributed back through the call id recorded above.
      if ty == "user" {
        if let Some(Value::Array(blocks)) = msg.and_then(|m| m.get("content")) {
          for b in blocks {
            if s(b, "type") == Some("tool_result")
              && b.get("is_error").and_then(Value::as_bool) == Some(true)
            {
              self.tools.error(s(b, "tool_use_id"));
            }
          }
        }
      }
      if ty == "assistant" {
        if let Some(m) = msg {
          // `model_index` also collects the session's distinct models in
          // first-seen order, skipping Claude Code's `<synthetic>` marker
          // (hook/injected turns) so pricing reflects the real model.
          let model_idx = model_index(&mut self.models, s(m, "model"));
          let gate = self.turn_gate(line, m);
          if gate.usage {
            if let Some(us) = m.get("usage") {
              let usage = claude_usage(us);
              self.count += 1;
              if let Some(ev) = pack_event(ts.unwrap_or(0), model_idx, &usage) {
                self.events.push(ev);
              }
              self.usage.add(&usage);
            }
          }
          if gate.content {
            if let Some(Value::Array(blocks)) = m.get("content") {
              for b in blocks {
                if s(b, "type") == Some("tool_use") {
                  if let Some(name) = s(b, "name") {
                    self.tools.call(name, s(b, "id"));
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /// What this assistant line may contribute, per the dedup rules documented on
  /// `seen_usage` / `seen_ids`. Falls back to the line's `uuid` when
  /// `message.id` is missing, so unidentifiable turns stay distinct instead of
  /// collapsing into one.
  fn turn_gate(&mut self, line: &Value, message: &Value) -> TurnGate {
    let Some(id) = s(message, "id")
      .or_else(|| s(line, "uuid"))
      .filter(|i| !i.is_empty())
    else {
      return TurnGate {
        usage: true,
        content: true,
      };
    };
    // A sidechain replays a turn that was already recorded: neither its bill nor
    // its tool calls happened a second time.
    let sidechain = line
      .get("isSidechain")
      .and_then(Value::as_bool)
      .unwrap_or(false);
    if sidechain && self.seen_ids.contains(id) {
      return TurnGate {
        usage: false,
        content: false,
      };
    }
    let req = s(line, "requestId").unwrap_or_default().to_string();
    let first = self.seen_usage.insert((id.to_string(), req));
    if first {
      self.seen_ids.insert(id.to_string());
    }
    TurnGate {
      usage: first,
      content: true,
    }
  }

  fn finish(self, id: String, path: &Path) -> ParsedSession {
    let parent_id = claude_parent_id(path);
    let title = self
      .title
      .or_else(|| self.agent_name.clone())
      .or(self.first_user)
      .unwrap_or_else(|| "Untitled session".into());
    let project_name = if self.cwd.is_empty() {
      "—".into()
    } else {
      basename(&self.cwd)
    };
    ParsedSession::assemble(
      SessionIdentity {
        id,
        source: "claude",
        project_name,
        git_branch: self.git_branch,
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
        agent_name: self.agent_name,
        duration_ms: self.duration_ms,
      },
      self.events,
      self.tools.finish(),
    )
  }
}

/// Parent session id for a sub-agent transcript, from its position on disk:
/// `<project>/<parent-session-id>/subagents/…/agent-<hash>.jsonl`. The `…` is
/// usually empty but workflow runs nest one more level (`workflows/<wf-id>/`),
/// so walk up to the `subagents` directory rather than assuming a fixed depth.
/// `None` for a top-level session, which lives directly under the project dir.
pub(super) fn claude_parent_id(path: &Path) -> Option<String> {
  let mut dir = path.parent()?;
  while dir.file_name()? != "subagents" {
    dir = dir.parent()?;
  }
  Some(dir.parent()?.file_name()?.to_string_lossy().into_owned())
}

pub(super) fn claude_parse(path: &Path, lines: &[Value]) -> Option<ParsedSession> {
  let id = path.file_stem()?.to_string_lossy().into_owned();
  let mut acc = ClaudeAcc::default();
  for line in lines {
    acc.push(line);
  }
  Some(acc.finish(id, path))
}

/// Streaming parse read straight from disk — the scan path's entry point.
pub(super) fn claude_parse_from_file(path: &Path) -> Option<ParsedSession> {
  let id = path.file_stem()?.to_string_lossy().into_owned();
  let mut acc = ClaudeAcc::default();
  stream_jsonl(path, |line| acc.push(line))?;
  Some(acc.finish(id, path))
}

pub(super) fn claude_detail(path: &Path, lines: &[Value]) -> SessionDetail {
  let summary = claude_parse(path, lines)
    .map(|p| p.summary)
    .unwrap_or_else(|| SessionSummary {
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
      cost_basis: None,
      branch_count: 1,
      started_at: 0,
      updated_at: 0,
      path: path.to_string_lossy().into_owned(),
      git_branch: None,
      parent_id: claude_parent_id(path),
      agent_name: None,
      duration_ms: None,
    });

  let mut messages = Vec::new();
  for line in lines {
    let ty = s(line, "type").unwrap_or("");
    if ty == "attachment" {
      if let Some(part) = claude_attachment_part(line.get("attachment")) {
        let mut msg = Message::new(s(line, "uuid").unwrap_or("").to_string(), "system");
        msg.ts = s(line, "timestamp").and_then(iso_to_epoch_ms);
        msg.parts.push(part);
        messages.push(msg);
      }
      continue;
    }
    if ty != "user" && ty != "assistant" {
      continue;
    }
    let Some(m) = line.get("message") else {
      continue;
    };
    let Some(content) = m.get("content") else {
      continue;
    };
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
                ..Part::default()
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
              // Oversized outputs live in a sibling `tool-results/` file; the
              // inline text is only a preview plus the path. Carry the path as a
              // `file:` ref so the UI can fetch the real output on expand
              // instead of showing the reader an absolute path as "content".
              let external = persisted_output_path(&text, line.get("toolUseResult"));
              let full_bytes = external
                .as_ref()
                .and_then(|p| fs::metadata(p).ok())
                .map(|m| m.len());
              msg.parts.push(Part {
                kind: "toolResult".into(),
                text: strip_persisted_stub(&text),
                name: None,
                agent: None,
                call_id: s(b, "tool_use_id").map(String::from),
                is_error: b.get("is_error").and_then(Value::as_bool),
                truncated: external.as_ref().map(|_| true),
                full_bytes,
                full_ref: external.map(|p| format!("file:{p}")),
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
  SessionDetail {
    summary,
    messages,
    tree: None,
  }
}

/// Absolute path of an externalized tool result, from either the
/// `<persisted-output>` stub Claude leaves inline or the `toolUseResult`
/// sidecar field on the same record. `None` when the output was inline.
pub(super) fn persisted_output_path(text: &str, tool_use_result: Option<&Value>) -> Option<String> {
  if let Some(p) = tool_use_result.and_then(|r| s(r, "persistedOutputPath")) {
    return Some(p.to_string());
  }
  if !text.starts_with("<persisted-output>") {
    return None;
  }
  let rest = text.split("Full output saved to:").nth(1)?;
  let p = rest.lines().next()?.trim();
  (!p.is_empty()).then(|| p.to_string())
}

/// Drop the `<persisted-output>` envelope, keeping just the preview body — the
/// wrapper's absolute path is carried structurally on the part instead.
pub(super) fn strip_persisted_stub(text: &str) -> String {
  if !text.starts_with("<persisted-output>") {
    return text.to_string();
  }
  match text.split_once("Preview (first ") {
    Some((_, rest)) => rest
      .split_once("):")
      .map(|(_, body)| body.trim_start())
      .unwrap_or(rest)
      .into(),
    None => text.into(),
  }
}

/// Whitelisted `attachment` records rendered as a timeline `event` part.
///
/// Claude writes ~20 attachment subtypes, most of them injected machinery
/// (tool/skill listings, reminders) that would only add noise. Only the ones a
/// reader would actually want in the transcript are kept; anything else — now
/// or in a future Claude version — is ignored rather than treated as an error.
pub(super) fn claude_attachment_part(att: Option<&Value>) -> Option<Part> {
  let att = att?;
  let subtype = s(att, "type")?;
  let text = match subtype {
    "hook_success" => {
      let hook = s(att, "hookName").unwrap_or("hook");
      let out = [s(att, "stdout"), s(att, "stderr")]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
      if out.is_empty() {
        hook.to_string()
      } else {
        format!("{hook}\n{out}")
      }
    }
    "hook_blocking_error" | "hook_non_blocking_error" | "hook_cancelled" => {
      let hook = s(att, "hookName").unwrap_or("hook");
      let err = att
        .get("blockingError")
        .and_then(|e| {
          s(e, "blockingError")
            .map(String::from)
            .or_else(|| e.as_str().map(String::from))
        })
        .unwrap_or_default();
      if err.is_empty() {
        hook.to_string()
      } else {
        format!("{hook}\n{err}")
      }
    }
    "plan_mode" => format!("→ {}", s(att, "planFilePath").unwrap_or("plan mode")),
    "plan_mode_exit" => format!("← {}", s(att, "planFilePath").unwrap_or("plan mode")),
    "edited_text_file" => s(att, "filename")?.to_string(),
    "opened_file_in_ide" => s(att, "filename")?.to_string(),
    "queued_command" => s(att, "prompt")?.trim().to_string(),
    _ => return None,
  };
  Some(Part {
    kind: "event".into(),
    text,
    name: Some(subtype.into()),
    ..Part::default()
  })
}

/// Every Claude transcript on disk with its change signature — collected before
/// parsing so the progress total is known up front.
pub(super) fn claude_sigs() -> Result<Vec<FileSig>, String> {
  let Some(root) = claude_root() else {
    return Ok(Vec::new());
  };
  if !root.is_dir() {
    return Ok(Vec::new());
  }
  let mut sigs = Vec::new();
  for proj in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
    if !proj.path().is_dir() {
      continue;
    }
    for entry in fs::read_dir(proj.path())
      .map_err(|e| e.to_string())?
      .flatten()
    {
      let p = entry.path();
      // A session directory sits beside its `<session-id>.jsonl` and holds the
      // sub-agent transcripts (plus `tool-results/`, which isn't JSONL).
      // Recurse: workflow runs nest another level, as
      // `subagents/workflows/<workflow-id>/agent-<hash>.jsonl`.
      if p.is_dir() {
        let mut nested = Vec::new();
        collect_jsonl(&p.join("subagents"), &mut nested);
        sigs.extend(nested.into_iter().filter_map(file_sig));
        continue;
      }
      if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        continue;
      }
      if let Some(sig) = file_sig(p) {
        sigs.push(sig);
      }
    }
  }
  Ok(sigs)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;
  use std::path::Path;

  /// Parse a session from in-memory lines, as `claude_parse` does on a cache miss.
  fn parse(lines: Vec<Value>) -> ParsedSession {
    claude_parse(Path::new("/p/sess-1.jsonl"), &lines).expect("parses")
  }

  /// One line of a streamed assistant turn. Claude writes one of these **per
  /// content block**, each repeating the same id, requestId and whole-turn usage.
  fn assistant_line(id: &str, req: &str, block: Value, usage: Value) -> Value {
    json!({
      "type": "assistant",
      "timestamp": "2026-01-01T00:00:00.000Z",
      "requestId": req,
      "message": { "id": id, "model": "claude-opus-4-6", "content": [block], "usage": usage },
    })
  }

  fn usage(input: u64, output: u64) -> Value {
    json!({ "input_tokens": input, "output_tokens": output })
  }

  fn text(t: &str) -> Value {
    json!({ "type": "text", "text": t })
  }

  fn tool_use(id: &str, name: &str) -> Value {
    json!({ "type": "tool_use", "id": id, "name": name })
  }

  /// The rule the whole usage dashboard rests on. Without the dedup, real
  /// transcripts read ~2.4× high — 1511 assistant lines carrying only 626
  /// distinct message ids.
  #[test]
  fn counts_a_split_assistant_turn_once() {
    let p = parse(vec![
      assistant_line("msg_1", "req_1", text("thinking"), usage(100, 20)),
      assistant_line("msg_1", "req_1", text("answer"), usage(100, 20)),
      assistant_line("msg_1", "req_1", tool_use("t1", "Read"), usage(100, 20)),
    ]);
    assert_eq!(
      p.summary.usage.input, 100,
      "usage must not be summed per block"
    );
    assert_eq!(p.summary.usage.output, 20);
    assert_eq!(p.summary.message_count, 1, "three lines are one turn");
  }

  /// Content blocks are NOT duplicated across those lines, so tool counting has
  /// to sit outside the usage gate — one call each, not one for the whole turn.
  #[test]
  fn still_counts_every_tool_call_in_a_split_turn() {
    let p = parse(vec![
      assistant_line("msg_1", "req_1", tool_use("t1", "Read"), usage(10, 1)),
      assistant_line("msg_1", "req_1", tool_use("t2", "Edit"), usage(10, 1)),
      assistant_line("msg_1", "req_1", tool_use("t3", "Read"), usage(10, 1)),
    ]);
    let mut tools: Vec<(String, u64)> = p
      .series
      .tools
      .iter()
      .map(|t| (t.name.clone(), t.calls))
      .collect();
    tools.sort();
    assert_eq!(tools, vec![("Edit".into(), 1), ("Read".into(), 2)]);
    assert_eq!(
      p.summary.usage.input, 10,
      "and the bill is still counted once"
    );
  }

  /// A genuine retry gets a new requestId and is a second, real bill.
  #[test]
  fn counts_a_retry_of_the_same_message_again() {
    let p = parse(vec![
      assistant_line("msg_1", "req_1", text("a"), usage(100, 20)),
      assistant_line("msg_1", "req_2", text("a"), usage(100, 20)),
    ]);
    assert_eq!(p.summary.usage.input, 200);
    assert_eq!(p.summary.message_count, 2);
  }

  /// …unless it's a sidechain, which replays a turn already recorded under a new
  /// requestId. The exact (id, requestId) key alone would let that through.
  #[test]
  fn does_not_count_a_sidechain_replay_of_a_counted_turn() {
    let mut replay = assistant_line("msg_1", "req_2", tool_use("t1", "Read"), usage(100, 20));
    replay["isSidechain"] = json!(true);
    let p = parse(vec![
      assistant_line("msg_1", "req_1", text("a"), usage(100, 20)),
      replay,
    ]);
    assert_eq!(p.summary.usage.input, 100);
    assert_eq!(p.summary.message_count, 1);
    // Neither its bill nor its tool calls happened a second time.
    assert!(p.series.tools.is_empty());
  }

  /// A sidechain whose id has NOT been seen is a real sub-turn and does count.
  #[test]
  fn counts_a_sidechain_whose_turn_was_never_recorded() {
    let mut only = assistant_line("msg_9", "req_9", text("a"), usage(100, 20));
    only["isSidechain"] = json!(true);
    assert_eq!(parse(vec![only]).summary.usage.input, 100);
  }

  #[test]
  fn counts_each_user_line_as_its_own_message() {
    let p = parse(vec![
      json!({ "type": "user", "timestamp": "2026-01-01T00:00:00.000Z",
              "message": { "content": "hello" } }),
      json!({ "type": "user", "timestamp": "2026-01-01T00:01:00.000Z",
              "message": { "content": "again" } }),
    ]);
    assert_eq!(p.summary.message_count, 2);
    assert_eq!(
      p.summary.title, "hello",
      "the first real user line titles it"
    );
  }

  /// A leading `<...>` line is machine-injected context, not something the user
  /// typed, so it must not become the session's title.
  #[test]
  fn skips_an_injected_block_when_picking_a_title() {
    let p = parse(vec![
      json!({ "type": "user", "message": { "content": "<system-reminder>x</system-reminder>" } }),
      json!({ "type": "user", "message": { "content": "the real question" } }),
    ]);
    assert_eq!(p.summary.title, "the real question");
  }

  #[test]
  fn takes_the_session_range_from_the_earliest_and_latest_timestamps() {
    let p = parse(vec![
      json!({ "type": "user", "timestamp": "2026-01-01T10:00:00.000Z",
              "message": { "content": "b" } }),
      json!({ "type": "user", "timestamp": "2026-01-01T09:00:00.000Z",
              "message": { "content": "a" } }),
    ]);
    assert!(p.summary.started_at < p.summary.updated_at);
  }

  /// `<synthetic>` marks a hook/injected turn, not a model the user paid for.
  #[test]
  fn leaves_the_synthetic_marker_out_of_the_model_list() {
    let mut synthetic = assistant_line("msg_2", "req_2", text("x"), usage(1, 1));
    synthetic["message"]["model"] = json!("<synthetic>");
    let p = parse(vec![
      assistant_line("msg_1", "req_1", text("a"), usage(1, 1)),
      synthetic,
    ]);
    assert_eq!(p.summary.models, vec!["claude-opus-4-6".to_string()]);
  }

  /// A failed tool_result rides on the *user* line answering the call, and is
  /// attributed back through the call id.
  #[test]
  fn attributes_a_tool_failure_back_to_the_call_that_made_it() {
    let p = parse(vec![
      assistant_line("msg_1", "req_1", tool_use("t1", "Bash"), usage(1, 1)),
      json!({ "type": "user", "message": { "content": [
        { "type": "tool_result", "tool_use_id": "t1", "is_error": true }
      ]}}),
    ]);
    let bash = p
      .series
      .tools
      .iter()
      .find(|t| t.name == "Bash")
      .expect("Bash counted");
    assert_eq!((bash.calls, bash.errors), (1, 1));
  }

  /// Lines with no message id at all can't be deduped, so they must be let
  /// through rather than silently collapsed into one.
  #[test]
  fn counts_every_line_that_carries_no_id_to_dedup_on() {
    let mut a = assistant_line("", "", text("a"), usage(5, 1));
    a["message"]["id"] = json!(null);
    let p = parse(vec![a.clone(), a]);
    assert_eq!(p.summary.usage.input, 10);
  }

  #[test]
  fn sums_turn_durations_into_the_session_s_working_time() {
    let p = parse(vec![
      json!({ "type": "system", "subtype": "turn_duration", "durationMs": 1500 }),
      json!({ "type": "system", "subtype": "turn_duration", "durationMs": 2500 }),
    ]);
    assert_eq!(p.summary.duration_ms, Some(4000));
  }

  /// A sub-agent transcript lives under `<parent>/subagents/...`; the id of the
  /// session that spawned it is what lets the list nest it instead of listing it
  /// as a peer.
  #[test]
  fn reads_a_sub_agent_s_parent_out_of_its_path() {
    assert_eq!(
      claude_parent_id(Path::new(
        "/h/.claude/projects/p/parent-1/subagents/a/sub.jsonl"
      )),
      Some("parent-1".to_string())
    );
    assert_eq!(
      claude_parent_id(Path::new("/h/.claude/projects/p/top.jsonl")),
      None
    );
  }
}
