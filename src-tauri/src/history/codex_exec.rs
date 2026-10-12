//! Reading the scripts Codex's `exec` tool runs.
//!
//! Current Codex calls its tools from a small JavaScript program rather than
//! one call at a time — `text(await tools.exec_command({cmd:"…"}))`, often
//! several, sometimes inside `Promise.allSettled` with code around them. Shown
//! as written, every command sits inside a JS string literal: a heredoc'd
//! Python script is one line of `\n`s, and the thing a reader wants — which
//! commands ran — is the hardest part to see.
//!
//! So a transcript shows the commands first, decoded, one `$ command` each,
//! and keeps the script itself only when it holds something beyond those
//! calls (about six in ten do: `allSettled`, filters, variables). A script
//! with no `exec_command` at all is left as it was.
//!
//! This is a reader for display, not a JavaScript parser: it understands
//! string literals well enough to find the end of a call and decode a `cmd`,
//! and when anything doesn't fit, the caller falls back to the raw script.

/// What a transcript shows for one `exec` call: the decoded commands, and the
/// original script when it says more than the commands do.
pub(super) fn exec_view(script: &str) -> (String, Option<String>) {
  let calls = exec_calls(script);
  let commands: Vec<&str> = calls.iter().filter_map(|c| c.cmd.as_deref()).collect();
  if commands.is_empty() {
    return (script.to_string(), None);
  }
  let text = commands
    .iter()
    .map(|c| format!("$ {}", c.trim_end()))
    .collect::<Vec<_>>()
    .join("\n\n");
  let rest = without_calls(script, &calls);
  (text, (!rest.trim().is_empty()).then(|| script.to_string()))
}

struct Call {
  /// Byte range of `tools.exec_command( … )`, closing paren included.
  start: usize,
  end: usize,
  cmd: Option<String>,
}

const CALL: &str = "tools.exec_command(";

fn exec_calls(src: &str) -> Vec<Call> {
  let mut out = Vec::new();
  let mut from = 0;
  while let Some(off) = src[from..].find(CALL) {
    let start = from + off;
    let args = start + CALL.len();
    let Some(end) = closing_paren(src, args) else {
      break;
    };
    out.push(Call {
      start,
      end,
      cmd: cmd_literal(&src[args..end - 1]),
    });
    from = end;
  }
  out
}

/// The index just past the `)` that closes a call whose arguments start at
/// `from`, skipping over anything inside string literals. None when the call
/// never closes (a script cut short), which leaves the caller on the raw text.
fn closing_paren(src: &str, from: usize) -> Option<usize> {
  let bytes = src.as_bytes();
  let mut depth = 1usize;
  let mut i = from;
  while i < bytes.len() {
    match bytes[i] {
      b'"' | b'\'' | b'`' => i = skip_string(bytes, i)?,
      b'(' | b'{' | b'[' => {
        depth += 1;
        i += 1;
      }
      b')' | b'}' | b']' => {
        depth -= 1;
        i += 1;
        if depth == 0 {
          return (bytes[i - 1] == b')').then_some(i);
        }
      }
      _ => i += 1,
    }
  }
  None
}

/// The index just past the string literal opening at `at`.
fn skip_string(bytes: &[u8], at: usize) -> Option<usize> {
  let quote = bytes[at];
  let mut i = at + 1;
  while i < bytes.len() {
    match bytes[i] {
      b'\\' => i += 2,
      b if b == quote => return Some(i + 1),
      _ => i += 1,
    }
  }
  None
}

/// The decoded `cmd` property of an `exec_command` argument object, written
/// `cmd:` or `"cmd":`, with a string literal value.
fn cmd_literal(args: &str) -> Option<String> {
  let bytes = args.as_bytes();
  let mut i = 0;
  while i < bytes.len() {
    match bytes[i] {
      b'"' | b'\'' | b'`' => {
        let end = skip_string(bytes, i)?;
        // A quoted key: `"cmd":`.
        if &args[i + 1..end - 1] == "cmd" {
          if let Some(v) = value_after_colon(args, end) {
            return Some(v);
          }
        }
        i = end;
      }
      b'c'
        if args[i..].starts_with("cmd")
          && (i == 0 || !is_ident(bytes[i - 1]))
          && !bytes.get(i + 3).is_some_and(|b| is_ident(*b)) =>
      {
        if let Some(v) = value_after_colon(args, i + 3) {
          return Some(v);
        }
        i += 3;
      }
      _ => i += 1,
    }
  }
  None
}

fn is_ident(b: u8) -> bool {
  b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn value_after_colon(args: &str, from: usize) -> Option<String> {
  let rest = args[from..].trim_start();
  let rest = rest.strip_prefix(':')?.trim_start();
  let quote = *rest.as_bytes().first()?;
  if !matches!(quote, b'"' | b'\'' | b'`') {
    return None;
  }
  let end = skip_string(rest.as_bytes(), 0)?;
  Some(unescape(&rest[1..end - 1]))
}

/// Decode a JS string literal's body: the common escapes, `\uXXXX` / `\u{…}`,
/// `\xXX`, and a line continuation. A template literal's `${…}` is left as
/// written — it names a value the transcript never saw.
fn unescape(body: &str) -> String {
  let mut out = String::with_capacity(body.len());
  let mut chars = body.chars().peekable();
  while let Some(c) = chars.next() {
    if c != '\\' {
      out.push(c);
      continue;
    }
    match chars.next() {
      Some('n') => out.push('\n'),
      Some('t') => out.push('\t'),
      Some('r') => out.push('\r'),
      Some('0') => out.push('\0'),
      Some('\n') => {}
      Some('u') => {
        let hex: String = if chars.peek() == Some(&'{') {
          chars.next();
          chars.by_ref().take_while(|c| *c != '}').collect()
        } else {
          chars.by_ref().take(4).collect()
        };
        match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
          Some(ch) => out.push(ch),
          None => out.push_str(&format!("\\u{hex}")),
        }
      }
      Some('x') => {
        let hex: String = chars.by_ref().take(2).collect();
        match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
          Some(ch) => out.push(ch),
          None => out.push_str(&format!("\\x{hex}")),
        }
      }
      Some(other) => out.push(other),
      None => out.push('\\'),
    }
  }
  out
}

/// The script with every call — and the `text(await …);` wrapped round it —
/// taken out. Empty (or whitespace) means the script was only those calls.
fn without_calls(src: &str, calls: &[Call]) -> String {
  let mut rest = String::new();
  let mut at = 0;
  for c in calls {
    rest.push_str(&src[at..c.start]);
    at = c.end;
  }
  rest.push_str(&src[at..]);
  rest
    .replace("text(await )", "")
    .replace("text(await)", "")
    .split(|ch: char| ch == ';' || ch.is_whitespace())
    .filter(|s| !s.is_empty())
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn shows_a_list_of_commands_as_commands_and_drops_the_plumbing() {
    let script = "text(await tools.exec_command({cmd:\"rtk proxy python3 - <<'PY'\\nimport json\\nprint(1)\\nPY\",max_output_tokens:6000}));\ntext(await tools.exec_command({cmd:\"rtk git rev-parse origin/dev\",max_output_tokens:1000}));";
    let (text, script_kept) = exec_view(script);
    assert_eq!(
      text,
      "$ rtk proxy python3 - <<'PY'\nimport json\nprint(1)\nPY\n\n$ rtk git rev-parse origin/dev"
    );
    assert_eq!(script_kept, None);
  }

  #[test]
  fn keeps_the_script_when_it_does_more_than_call() {
    let script = "const results=await Promise.allSettled([\ntools.exec_command({cmd:\"rtk read a.ts\",\"max_output_tokens\":6000}),\ntools.exec_command({\"cmd\":\"rtk read b.ts\"})\n]);results.forEach((r,i)=>text({i,...r}));";
    let (text, script_kept) = exec_view(script);
    assert_eq!(text, "$ rtk read a.ts\n\n$ rtk read b.ts");
    assert_eq!(script_kept.as_deref(), Some(script));
  }

  #[test]
  fn sees_past_quotes_and_brackets_inside_a_command() {
    let script = r#"text(await tools.exec_command({cmd:"node -e 'const fs=require(\"node:fs\"); console.log({a:[1,2]})'"}));"#;
    let (text, kept) = exec_view(script);
    assert_eq!(
      text,
      r#"$ node -e 'const fs=require("node:fs"); console.log({a:[1,2]})'"#
    );
    assert_eq!(kept, None);
  }

  #[test]
  fn decodes_single_quoted_template_and_unicode_literals() {
    assert_eq!(
      exec_view("text(await tools.exec_command({cmd:'echo \\u4f60\\u597d'}));").0,
      "$ echo 你好"
    );
    assert_eq!(
      exec_view("text(await tools.exec_command({cmd:`ls ${dir}`}));").0,
      "$ ls ${dir}"
    );
  }

  #[test]
  fn leaves_a_script_without_commands_or_one_cut_short_as_it_was() {
    let other = "text(await tools.write_stdin({session_id:3,chars:\"y\\n\"}));";
    assert_eq!(exec_view(other), (other.to_string(), None));
    let cut = "text(await tools.exec_command({cmd:\"ls";
    assert_eq!(exec_view(cut), (cut.to_string(), None));
  }

  #[test]
  fn does_not_mistake_a_longer_key_for_cmd() {
    let script = "text(await tools.exec_command({cmdline:\"no\",cmd:\"yes\"}));";
    assert_eq!(exec_view(script).0, "$ yes");
  }
}
