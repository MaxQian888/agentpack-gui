//! How a Claude Code transcript reads, block by block.
//!
//! The JSONL is written for the model, not for a reader, and showing it as
//! written put three wire formats on screen:
//!
//! - **Tool input as JSON.** `Bash` is most of the calls, and its command is a
//!   JSON string: a heredoc or a multi-line script became one line of `\n`s.
//!   `Write` / `Edit` content, likewise.
//! - **Images in a tool result dropped.** Only `text` blocks were kept, so a
//!   screenshot tool's result read as empty.
//! - **Claude Code's own records as user messages.** A slash command, its
//!   output, the caveat it attaches for the model, background-task
//!   notifications and `isMeta` notes are all written as `user` records in
//!   tags (`<command-name>`, `<local-command-stdout>`, …) — and rendered as raw
//!   XML the user never typed.
//!
//! Display only: nothing here changes what a summary counts.

use serde_json::Value;

use super::util::s;
use super::Part;

/// A tool call's input as text a person can read.
///
/// `Bash` reads as the shell command it ran, its description as a comment.
/// Anything else lists its fields one per line — one-line fields first — with a
/// multi-line string set out on the lines below its key, so `Write` content and
/// `Edit` strings keep their real line breaks, and any other value as JSON.
pub(super) fn tool_input_text(name: Option<&str>, input: &Value) -> String {
  let Value::Object(fields) = input else {
    return serde_json::to_string_pretty(input).unwrap_or_default();
  };
  if name == Some("Bash") {
    if let Some(command) = fields.get("command").and_then(Value::as_str) {
      let mut out = String::new();
      if let Some(desc) = fields.get("description").and_then(Value::as_str) {
        out.push_str(&format!("# {desc}\n"));
      }
      out.push_str(&format!("$ {command}"));
      for (k, v) in fields {
        if k != "command" && k != "description" {
          out.push_str(&format!("\n# {k}: {}", scalar(v)));
        }
      }
      return out;
    }
  }
  // One-line fields (paths, flags) first, multi-line blocks after them: the
  // map's own order is alphabetical, not the model's, and `content` above
  // `file_path` buried the one line that says what the call touched.
  let mut lines: Vec<String> = fields
    .iter()
    .map(|(k, v)| match v {
      Value::String(t) if t.contains('\n') => format!("{k}:\n{t}"),
      Value::String(t) => format!("{k}: {t}"),
      Value::Object(_) | Value::Array(_) => {
        let json = serde_json::to_string_pretty(v).unwrap_or_default();
        if json.contains('\n') {
          format!("{k}:\n{json}")
        } else {
          format!("{k}: {json}")
        }
      }
      other => format!("{k}: {other}"),
    })
    .collect();
  lines.sort_by_key(|l| l.contains('\n'));
  lines.join("\n")
}

fn scalar(v: &Value) -> String {
  match v {
    Value::String(t) => t.clone(),
    other => other.to_string(),
  }
}

/// A tool result's content: its text blocks joined, an image named rather
/// than dropped.
pub(super) fn tool_result_text(content: Option<&Value>) -> String {
  match content {
    Some(Value::String(t)) => t.clone(),
    Some(Value::Array(blocks)) => blocks
      .iter()
      .filter_map(|b| match s(b, "type") {
        Some("image") => Some("[image]".to_string()),
        _ => s(b, "text").map(String::from),
      })
      .collect::<Vec<_>>()
      .join("\n"),
    _ => String::new(),
  }
}

/// What one piece of a `user` record's text becomes: the user's own words, an
/// event Claude Code recorded, or nothing (context written for the model).
pub(super) fn user_text_part(text: &str, is_meta: bool) -> Option<Part> {
  let t = text.trim_start();
  // `isMeta` is Claude Code's own "not shown to the user" mark; a caveat and a
  // system reminder are context it adds for the model.
  if is_meta || t.starts_with("<local-command-caveat>") || t.starts_with("<system-reminder>") {
    return None;
  }
  if let Some(name) = tag(t, "command-name") {
    let args = tag(t, "command-args").unwrap_or("").trim();
    let line = if args.is_empty() {
      name.trim().to_string()
    } else {
      format!("{} {args}", name.trim())
    };
    return Some(event("slash_command", line));
  }
  if t.starts_with("<local-command-stdout>") || t.starts_with("<local-command-stderr>") {
    let out = tag(t, "local-command-stdout")
      .or_else(|| tag(t, "local-command-stderr"))
      .map(strip_ansi)
      .unwrap_or_default();
    let out = out.trim();
    return (!out.is_empty()).then(|| event("command_output", out.to_string()));
  }
  if t.starts_with("<task-notification>") {
    let summary = tag(t, "summary").or_else(|| tag(t, "status")).unwrap_or("");
    let result = tag(t, "result").unwrap_or("").trim();
    let body = if result.is_empty() {
      summary.trim().to_string()
    } else {
      format!("{}\n\n{result}", summary.trim())
    };
    return Some(event("task_notification", body));
  }
  if let Some(input) = tag(t, "bash-input") {
    let mut body = format!("$ {}", input.trim());
    for stream in ["bash-stdout", "bash-stderr"] {
      if let Some(out) = tag(t, stream).map(strip_ansi) {
        if !out.trim().is_empty() {
          body.push('\n');
          body.push_str(out.trim_end());
        }
      }
    }
    return Some(event("shell", body));
  }
  (!text.trim().is_empty()).then(|| Part::text("text", text.to_string()))
}

fn event(name: &str, text: String) -> Part {
  Part {
    kind: "event".into(),
    text,
    name: Some(name.into()),
    ..Part::default()
  }
}

/// The body of the first `<name>…</name>` in `text`.
fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
  let open = format!("<{name}>");
  let close = format!("</{name}>");
  let start = text.find(&open)? + open.len();
  let end = text[start..].find(&close)? + start;
  Some(&text[start..end])
}

/// Terminal colour codes, which a slash command's output keeps.
fn strip_ansi(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut chars = text.chars().peekable();
  while let Some(c) = chars.next() {
    if c == '\u{1b}' && chars.peek() == Some(&'[') {
      chars.next();
      for c in chars.by_ref() {
        if c.is_ascii_alphabetic() {
          break;
        }
      }
      continue;
    }
    out.push(c);
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn shows_a_bash_call_as_its_command() {
    let input = json!({
      "command": "python3 - <<'PY'\nprint(1)\nPY",
      "description": "Run a script",
      "timeout": 60000
    });
    assert_eq!(
      tool_input_text(Some("Bash"), &input),
      "# Run a script\n$ python3 - <<'PY'\nprint(1)\nPY\n# timeout: 60000"
    );
  }

  #[test]
  fn lays_out_other_inputs_field_by_field_with_real_line_breaks() {
    let input = json!({ "file_path": "/a.ts", "content": "line 1\nline 2", "replace_all": false });
    assert_eq!(
      tool_input_text(Some("Write"), &input),
      "file_path: /a.ts\nreplace_all: false\ncontent:\nline 1\nline 2"
    );
    let nested = json!({ "questions": [{ "q": "x" }] });
    assert!(tool_input_text(Some("AskUserQuestion"), &nested).starts_with("questions:\n[\n"));
    // A Bash call missing its command falls through to the field list.
    assert_eq!(tool_input_text(Some("Bash"), &json!({ "x": 1 })), "x: 1");
    assert_eq!(tool_input_text(None, &json!("raw")), "\"raw\"");
  }

  #[test]
  fn names_an_image_in_a_tool_result() {
    let content =
      json!([{ "type": "text", "text": "shot taken" }, { "type": "image", "source": {} }]);
    assert_eq!(tool_result_text(Some(&content)), "shot taken\n[image]");
    assert_eq!(tool_result_text(Some(&json!("plain"))), "plain");
    assert_eq!(tool_result_text(None), "");
  }

  #[test]
  fn reads_claude_codes_own_records_as_events_or_skips_them() {
    let kind = |p: Option<Part>| p.map(|p| (p.name.unwrap_or_default(), p.text));
    assert_eq!(
      kind(user_text_part(
        "<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>medium</command-args>",
        false
      )),
      Some(("slash_command".into(), "/review medium".into()))
    );
    assert_eq!(
      kind(user_text_part(
        "<local-command-stdout>\u{1b}[2mCompacted\u{1b}[22m </local-command-stdout>",
        false
      )),
      Some(("command_output".into(), "Compacted".into()))
    );
    assert_eq!(
      user_text_part("<local-command-stdout></local-command-stdout>", false).map(|_| ()),
      None
    );
    assert_eq!(
      kind(user_text_part(
        "<task-notification>\n<task-id>a</task-id>\n<status>completed</status>\n<summary>Agent \"x\" finished</summary>\n<result>Found it.</result>\n</task-notification>",
        false
      )),
      Some(("task_notification".into(), "Agent \"x\" finished\n\nFound it.".into()))
    );
    assert_eq!(
      kind(user_text_part(
        "<bash-input>ls</bash-input><bash-stdout>a\nb</bash-stdout><bash-stderr></bash-stderr>",
        false
      )),
      Some(("shell".into(), "$ ls\na\nb".into()))
    );
    assert!(user_text_part(
      "<local-command-caveat>Caveat…</local-command-caveat>",
      false
    )
    .is_none());
    assert!(user_text_part("<system-reminder>x</system-reminder>", false).is_none());
    assert!(user_text_part("[Image: original 2336x1504]", true).is_none());
  }

  #[test]
  fn leaves_what_the_user_typed_alone() {
    let p = user_text_part("fix the <div> alignment", false).unwrap();
    assert_eq!(
      (p.kind.as_str(), p.text.as_str()),
      ("text", "fix the <div> alignment")
    );
    assert!(user_text_part("   ", false).is_none());
  }
}
