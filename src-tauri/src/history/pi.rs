use super::scan::{file_sig, FileSig};
use super::util::{basename, collect_jsonl, iso_to_epoch_ms, s, truncate_title, u};
use super::*;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Clone)]
struct PiNode {
  id: String,
  parent_id: Option<String>,
  kind: String,
  label: Option<String>,
  message: Option<Message>,
  ts: i64,
}

struct PiNormalized {
  parsed: ParsedSession,
  messages: Vec<Message>,
  tree: SessionTree,
}

fn timestamp(v: &Value) -> i64 {
  s(v, "timestamp").and_then(iso_to_epoch_ms).unwrap_or(0)
}

fn content_parts(content: &Value) -> Vec<Part> {
  match content {
    Value::String(text) => vec![Part::text("text", text.clone())],
    Value::Array(blocks) => blocks
      .iter()
      .map(|block| {
        let ty = s(block, "type").unwrap_or("text");
        match ty {
          "text" => Part::text("text", s(block, "text").unwrap_or("").to_string()),
          "thinking" => Part::text(
            "thinking",
            s(block, "thinking")
              .or_else(|| s(block, "text"))
              .unwrap_or("")
              .to_string(),
          ),
          "toolCall" | "tool_call" => Part {
            kind: "toolCall".into(),
            text: block
              .get("arguments")
              .or_else(|| block.get("input"))
              .map(Value::to_string)
              .unwrap_or_default(),
            name: s(block, "name").map(str::to_string),
            call_id: s(block, "id")
              .or_else(|| s(block, "toolCallId"))
              .map(str::to_string),
            ..Part::default()
          },
          "image" => Part::text(
            "image",
            s(block, "path")
              .or_else(|| s(block, "url"))
              .unwrap_or("")
              .to_string(),
          ),
          _ => Part {
            kind: "event".into(),
            text: block.to_string(),
            name: Some(ty.to_string()),
            ..Part::default()
          },
        }
      })
      .collect(),
    Value::Null => Vec::new(),
    other => vec![Part::text("event", other.to_string())],
  }
}

fn pi_usage(message: &Value) -> (Option<TokenUsage>, Option<f64>) {
  let Some(usage) = message.get("usage") else {
    return (None, None);
  };
  let input = u(usage, "input");
  let output = u(usage, "output");
  let cache_read = u(usage, "cacheRead");
  let cache_write = u(usage, "cacheWrite");
  let reasoning = u(usage, "reasoning").max(
    usage
      .get("outputDetails")
      .map(|details| u(details, "reasoningTokens"))
      .unwrap_or_default(),
  );
  let total = u(usage, "totalTokens");
  let normalized = TokenUsage {
    input,
    output,
    cache_read,
    cache_write,
    reasoning,
    total: if total > 0 {
      total
    } else {
      input + output + cache_read + cache_write + reasoning
    },
  };
  let cost = usage
    .get("cost")
    .and_then(|v| v.get("total"))
    .and_then(Value::as_f64);
  (Some(normalized), cost)
}

fn pi_message(entry: &Value, id: &str, ts: i64) -> Option<Message> {
  let value = entry.get("message")?;
  let raw_role = s(value, "role")?;
  let role = match raw_role {
    "user" => "user",
    "assistant" => "assistant",
    "toolResult" | "bashExecution" => "tool",
    "custom" | "hookMessage" | "branchSummary" | "compactionSummary" => "system",
    _ => "system",
  };
  let mut message = Message::new(id.to_string(), role);
  message.ts = Some(ts);
  message.model = s(value, "model").map(str::to_string);
  message.parts = if raw_role == "toolResult" {
    content_parts(value.get("content").unwrap_or(&Value::Null))
      .into_iter()
      .map(|mut part| {
        if part.kind == "text" {
          part.kind = "toolResult".into();
        }
        part.name = s(value, "toolName").map(str::to_string);
        part.call_id = s(value, "toolCallId").map(str::to_string);
        part.is_error = value.get("isError").and_then(Value::as_bool);
        part
      })
      .collect()
  } else if raw_role == "bashExecution" {
    vec![Part {
      kind: "toolResult".into(),
      text: value
        .get("output")
        .map(|output| match output {
          Value::String(text) => text.clone(),
          other => other.to_string(),
        })
        .unwrap_or_default(),
      name: Some("bash".into()),
      is_error: value
        .get("exitCode")
        .and_then(Value::as_i64)
        .map(|code| code != 0),
      ..Part::default()
    }]
  } else if matches!(raw_role, "branchSummary" | "compactionSummary") {
    vec![Part::text(
      "event",
      s(value, "summary").unwrap_or("").to_string(),
    )]
  } else {
    content_parts(value.get("content").unwrap_or(&Value::Null))
  };
  if matches!(raw_role, "custom" | "hookMessage") {
    let custom_type = s(value, "customType").unwrap_or(raw_role);
    for part in &mut message.parts {
      part.kind = "event".into();
      part.name = Some(custom_type.to_string());
    }
  }
  message.usage = pi_usage(value).0;
  Some(message)
}

fn event_message(entry: &Value, id: &str, kind: &str, ts: i64) -> Message {
  let mut message = Message::new(id.to_string(), "system");
  message.ts = Some(ts);
  let text = match kind {
    "compaction" | "branch_summary" => s(entry, "summary").unwrap_or("").to_string(),
    "model_change" => match (s(entry, "provider"), s(entry, "modelId")) {
      (Some(provider), Some(model)) => format!("{provider}/{model}"),
      (_, Some(model)) => model.to_string(),
      _ => String::new(),
    },
    "thinking_level_change" => s(entry, "thinkingLevel").unwrap_or("").to_string(),
    "label" => s(entry, "label").unwrap_or("").to_string(),
    "session_info" => s(entry, "name").unwrap_or("").to_string(),
    "custom" => entry.get("data").map(Value::to_string).unwrap_or_default(),
    "custom_message" => entry
      .get("content")
      .map(|content| match content {
        Value::String(text) => text.clone(),
        other => other.to_string(),
      })
      .unwrap_or_default(),
    _ => entry
      .get("data")
      .or_else(|| entry.get("content"))
      .map(Value::to_string)
      .unwrap_or_default(),
  };
  message.parts.push(Part {
    kind: "event".into(),
    text,
    name: Some(s(entry, "customType").unwrap_or(kind).to_string()),
    ..Part::default()
  });
  if kind == "model_change" {
    message.model = s(entry, "modelId").map(str::to_string);
  }
  message
}

fn active_path(nodes: &[PiNode], leaf: &str) -> Vec<String> {
  let by_id: HashMap<&str, &PiNode> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
  let mut out = Vec::new();
  let mut current = Some(leaf);
  let mut seen = HashSet::new();
  while let Some(id) = current {
    if !seen.insert(id.to_string()) {
      break;
    }
    let Some(node) = by_id.get(id) else { break };
    out.push(node.id.clone());
    current = node.parent_id.as_deref();
  }
  out.reverse();
  out
}

fn normalize(path: &Path, lines: &[Value]) -> Option<PiNormalized> {
  let header = lines.iter().find(|v| s(v, "type") == Some("session"))?;
  let session_id = s(header, "id")
    .map(str::to_string)
    .or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()))?;
  let cwd = s(header, "cwd").unwrap_or("").to_string();
  let started = timestamp(header);
  let linear = u(header, "version") <= 1;
  let mut nodes = Vec::new();
  let mut models = Vec::new();
  let mut usage = TokenUsage::default();
  let mut cost = 0.0;
  let mut has_cost = false;
  let mut events = Vec::new();
  let mut tools: HashMap<String, ToolStat> = HashMap::new();
  let mut first_user = None;
  let mut session_name = None;
  let mut previous_id: Option<String> = None;
  let mut usage_seen = HashSet::new();
  let mut node_ids = HashSet::new();
  let mut labels: HashMap<String, Option<String>> = HashMap::new();

  for (index, entry) in lines.iter().enumerate() {
    let kind = s(entry, "type").unwrap_or("");
    if kind == "session" {
      continue;
    }
    let raw_id = s(entry, "id")
      .map(str::to_string)
      .unwrap_or_else(|| format!("line-{index}"));
    let id = if node_ids.insert(raw_id.clone()) {
      raw_id.clone()
    } else {
      let unique = format!("{raw_id}#{index}");
      node_ids.insert(unique.clone());
      unique
    };
    let parent_id = s(entry, "parentId")
      .map(str::to_string)
      .or_else(|| linear.then(|| previous_id.clone()).flatten());
    let ts = timestamp(entry);
    let mut message = if kind == "message" {
      pi_message(entry, &id, ts)
    } else if kind == "custom_message" {
      let mut message = Message::new(id.clone(), "system");
      message.ts = Some(ts);
      message.parts = content_parts(entry.get("content").unwrap_or(&Value::Null));
      for part in &mut message.parts {
        part.kind = "event".into();
        part.name = Some(
          s(entry, "customType")
            .unwrap_or("custom_message")
            .to_string(),
        );
      }
      Some(message)
    } else {
      Some(event_message(entry, &id, kind, ts))
    };
    if kind == "label" {
      if let Some(target) = s(entry, "targetId") {
        labels.insert(target.to_string(), s(entry, "label").map(str::to_string));
      }
    }
    if kind == "session_info" {
      if let Some(name) = s(entry, "name").filter(|n| !n.trim().is_empty()) {
        session_name = Some(name.to_string());
      }
    }
    if let Some(msg) = &message {
      if msg.role == "user" && first_user.is_none() {
        first_user = msg
          .parts
          .iter()
          .find(|p| p.kind == "text")
          .map(|p| p.text.clone());
      }
      if let Some(model) = msg.model.as_deref().filter(|m| !m.is_empty()) {
        if !models.iter().any(|m| m == model) {
          models.push(model.to_string());
        }
      }
      if msg.role == "assistant" && usage_seen.insert(raw_id.clone()) {
        if let Some(u) = &msg.usage {
          usage.add(u);
          let msg_cost = entry.get("message").and_then(|m| pi_usage(m).1);
          if let Some(value) = msg_cost {
            cost += value;
            has_cost = true;
          }
          let model_idx = model_index(&mut models, msg.model.as_deref());
          if let Some(mut event) = pack_event(ts, model_idx, u) {
            event[7] = msg_cost
              .map(|v| (v * 1_000_000.0).round() as i64)
              .unwrap_or(-1);
            events.push(event);
          }
        }
      }
      for part in &msg.parts {
        if part.kind == "toolCall" {
          let name = part.name.clone().unwrap_or_else(|| "tool".into());
          tools
            .entry(name.clone())
            .or_insert(ToolStat {
              name,
              calls: 0,
              errors: 0,
            })
            .calls += 1;
        } else if part.kind == "toolResult" && part.is_error == Some(true) {
          if let Some(name) = &part.name {
            tools
              .entry(name.clone())
              .or_insert(ToolStat {
                name: name.clone(),
                calls: 0,
                errors: 0,
              })
              .errors += 1;
          }
        }
      }
    }
    nodes.push(PiNode {
      id: id.clone(),
      parent_id,
      kind: kind.to_string(),
      label: None,
      message: message.take(),
      ts,
    });
    previous_id = Some(id);
  }
  for node in &mut nodes {
    if let Some(label) = labels.get(&node.id) {
      node.label = label.clone();
    }
  }
  let active_leaf_id = nodes.last()?.id.clone();
  let path_ids = active_path(&nodes, &active_leaf_id);
  let path_set: HashSet<&str> = path_ids.iter().map(String::as_str).collect();
  let messages: Vec<Message> = nodes
    .iter()
    .filter(|n| path_set.contains(n.id.as_str()))
    .filter_map(|n| n.message.clone())
    .collect();
  let message_count = messages
    .iter()
    .filter(|m| m.role == "user" || m.role == "assistant")
    .count() as u64;
  let parents: HashSet<&str> = nodes
    .iter()
    .filter_map(|n| n.parent_id.as_deref())
    .collect();
  let branch_count = nodes
    .iter()
    .filter(|n| !parents.contains(n.id.as_str()))
    .count() as u64;
  let updated = nodes.iter().map(|n| n.ts).max().unwrap_or(started);
  let project_name = basename(&cwd);
  let title = session_name
    .or_else(|| first_user.map(|t| truncate_title(&t)))
    .filter(|t| !t.is_empty())
    .unwrap_or_else(|| {
      if project_name.is_empty() {
        session_id.clone()
      } else {
        project_name.clone()
      }
    });
  let mut tool_list: Vec<ToolStat> = tools.into_values().collect();
  tool_list.sort_by(|a, b| b.calls.cmp(&a.calls).then_with(|| a.name.cmp(&b.name)));
  let cost_basis = has_cost.then(|| "sourceEstimate".to_string());
  let summary = SessionSummary {
    id: session_id.clone(),
    source: "pi".into(),
    title,
    cwd,
    project_name: project_name.clone(),
    model: models.last().cloned().unwrap_or_default(),
    models: models.clone(),
    message_count,
    usage,
    cost: has_cost.then_some(cost),
    cost_basis: cost_basis.clone(),
    branch_count: branch_count.max(1),
    started_at: started,
    updated_at: updated,
    path: path.to_string_lossy().into_owned(),
    git_branch: None,
    parent_id: None,
    agent_name: None,
    duration_ms: None,
  };
  let series = SessionSeries {
    id: session_id,
    source: "pi".into(),
    project_name,
    git_branch: None,
    parent_id: None,
    models,
    events,
    tools: tool_list,
    cost_basis,
  };
  let tree = SessionTree {
    active_leaf_id,
    nodes: nodes
      .into_iter()
      .map(|node| SessionTreeNode {
        id: node.id,
        parent_id: node.parent_id,
        kind: node.kind,
        label: node.label,
        message: node.message,
      })
      .collect(),
  };
  Some(PiNormalized {
    parsed: ParsedSession {
      summary,
      series,
      warnings: Vec::new(),
    },
    messages,
    tree,
  })
}

pub(super) fn pi_parse(path: &Path, lines: &[Value]) -> Option<ParsedSession> {
  normalize(path, lines).map(|n| n.parsed)
}

pub(super) fn pi_parse_from_file(path: &Path) -> Option<ParsedSession> {
  let file = fs::File::open(path).ok()?;
  let mut lines = Vec::new();
  let mut malformed = 0usize;
  for raw in BufReader::new(file).lines() {
    let Ok(raw) = raw else {
      malformed += 1;
      continue;
    };
    let raw = raw.trim();
    if raw.is_empty() {
      continue;
    }
    match serde_json::from_str::<Value>(raw) {
      Ok(value) => lines.push(value),
      Err(_) => malformed += 1,
    }
  }
  let mut parsed = pi_parse(path, &lines)?;
  if malformed > 0 {
    parsed.warnings.push(format!(
      "{}: skipped {malformed} malformed JSONL line(s)",
      path.display()
    ));
  }
  Some(parsed)
}

pub(super) fn pi_detail(path: &Path, lines: &[Value]) -> SessionDetail {
  normalize(path, lines)
    .map(|n| SessionDetail {
      summary: n.parsed.summary,
      messages: n.messages,
      tree: Some(n.tree),
    })
    .unwrap_or_else(|| SessionDetail {
      summary: SessionSummary {
        id: path
          .file_stem()
          .unwrap_or_default()
          .to_string_lossy()
          .into_owned(),
        source: "pi".into(),
        title: path
          .file_name()
          .unwrap_or_default()
          .to_string_lossy()
          .into_owned(),
        cwd: String::new(),
        project_name: String::new(),
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
        parent_id: None,
        agent_name: None,
        duration_ms: None,
      },
      messages: Vec::new(),
      tree: None,
    })
}

fn expand_home(path: &str, home: &Path) -> PathBuf {
  if path == "~" {
    home.to_path_buf()
  } else if let Some(rest) = path.strip_prefix("~/") {
    home.join(rest)
  } else {
    PathBuf::from(path)
  }
}

fn pi_session_roots() -> Result<Vec<PathBuf>, String> {
  let home = dirs::home_dir().ok_or("no home dir")?;
  let agent_dir = crate::paths::pi_home(&home);
  let mut roots = crate::pi_management::extra_session_dirs(&home);
  if let Ok(value) = std::env::var("PI_CODING_AGENT_SESSION_DIR") {
    if !value.trim().is_empty() {
      roots.push(expand_home(value.trim(), &home));
    }
  }
  if let Ok(text) = fs::read_to_string(agent_dir.join("settings.json")) {
    if let Ok(settings) = serde_json::from_str::<Value>(&text) {
      if let Some(dir) = s(&settings, "sessionDir").filter(|v| !v.trim().is_empty()) {
        roots.push(expand_home(dir.trim(), &home));
      }
    }
  }
  roots.push(agent_dir.join("sessions"));
  let mut seen = HashSet::new();
  roots.retain(|root| {
    let normalized = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    seen.insert(normalized.to_string_lossy().into_owned())
  });
  Ok(roots)
}

pub(super) fn pi_sigs() -> Result<Vec<FileSig>, String> {
  let mut files = Vec::new();
  for root in pi_session_roots()? {
    if root.is_dir() {
      collect_jsonl(&root, &mut files);
    }
  }
  let mut unique = HashSet::new();
  files.retain(|path| {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.clone());
    unique.insert(normalized)
  });
  files.sort();
  Ok(files.into_iter().filter_map(file_sig).collect())
}

#[cfg(test)]
mod tests {
  use serde_json::json;

  #[test]
  fn parses_tree_sessions_with_active_path_and_whole_tree_usage() {
    let lines = vec![
      json!({"type":"session","version":3,"id":"sess-1","timestamp":"2026-08-01T00:00:00Z","cwd":"/repo"}),
      json!({"type":"message","id":"u1","parentId":null,"timestamp":"2026-08-01T00:00:01Z","message":{"role":"user","content":"root question"}}),
      json!({"type":"message","id":"a1","parentId":"u1","timestamp":"2026-08-01T00:00:02Z","message":{"role":"assistant","model":"gpt-5","content":[{"type":"text","text":"root answer"}],"usage":{"input":10,"output":5,"cacheRead":2,"cacheWrite":1,"totalTokens":18,"cost":{"total":0.001}}}}),
      json!({"type":"message","id":"u2","parentId":"a1","timestamp":"2026-08-01T00:00:03Z","message":{"role":"user","content":"branch one"}}),
      json!({"type":"message","id":"a2","parentId":"u2","timestamp":"2026-08-01T00:00:04Z","message":{"role":"assistant","model":"gpt-5","content":[{"type":"text","text":"old answer"}],"usage":{"input":20,"output":4,"cacheRead":0,"cacheWrite":0,"totalTokens":24,"cost":{"total":0.002}}}}),
      json!({"type":"message","id":"u3","parentId":"a1","timestamp":"2026-08-01T00:00:05Z","message":{"role":"user","content":"branch two"}}),
      json!({"type":"message","id":"a3","parentId":"u3","timestamp":"2026-08-01T00:00:06Z","message":{"role":"assistant","model":"gpt-5","content":[{"type":"text","text":"current answer"}],"usage":{"input":30,"output":6,"cacheRead":3,"cacheWrite":0,"totalTokens":39,"cost":{"total":0.003}}}}),
      json!({"type":"label","id":"l1","parentId":"a3","targetId":"a3","timestamp":"2026-08-01T00:00:07Z","label":"preferred"}),
      json!({"type":"session_info","id":"i1","parentId":"l1","timestamp":"2026-08-01T00:00:08Z","name":"Named Pi session"}),
    ];

    let parsed =
      super::pi_parse(std::path::Path::new("/tmp/pi.jsonl"), &lines).expect("valid Pi session");
    assert_eq!(parsed.summary.id, "sess-1");
    assert_eq!(parsed.summary.title, "Named Pi session");
    assert_eq!(parsed.summary.message_count, 4);
    assert_eq!(parsed.summary.branch_count, 2);
    assert_eq!(parsed.summary.usage.total, 81);
    assert_eq!(parsed.summary.cost, Some(0.006));
    assert_eq!(parsed.summary.cost_basis.as_deref(), Some("sourceEstimate"));
    assert_eq!(parsed.series.events.len(), 3);
    assert_eq!(parsed.series.events[0][7], 1000);

    let detail = super::pi_detail(std::path::Path::new("/tmp/pi.jsonl"), &lines);
    let texts: Vec<&str> = detail
      .messages
      .iter()
      .flat_map(|m| m.parts.iter().map(|p| p.text.as_str()))
      .collect();
    assert!(texts.contains(&"current answer"));
    assert!(!texts.contains(&"old answer"));
    let tree = detail.tree.expect("Pi detail carries a tree");
    assert_eq!(tree.active_leaf_id, "i1");
    assert_eq!(tree.nodes.len(), 8);
  }

  #[test]
  fn parses_v1_as_one_linear_session_and_skips_duplicate_assistant_usage() {
    let lines = vec![
      json!({"type":"session","version":1,"id":"legacy","timestamp":"2026-08-01T00:00:00Z","cwd":"/legacy"}),
      json!({"type":"message","timestamp":"2026-08-01T00:00:01Z","message":{"role":"user","content":"hello"}}),
      json!({"type":"message","id":"same","timestamp":"2026-08-01T00:00:02Z","message":{"role":"assistant","model":"m","content":"one","usage":{"input":2,"output":3,"totalTokens":5}}}),
      json!({"type":"message","id":"same","timestamp":"2026-08-01T00:00:03Z","message":{"role":"assistant","model":"m","content":"duplicate","usage":{"input":20,"output":30,"totalTokens":50}}}),
    ];
    let detail = super::pi_detail(std::path::Path::new("/tmp/legacy.jsonl"), &lines);
    assert_eq!(detail.summary.message_count, 3);
    assert_eq!(detail.summary.branch_count, 1);
    assert_eq!(detail.summary.usage.total, 5);
    assert_eq!(detail.messages.len(), 3);
  }

  #[test]
  fn preserves_v2_tools_model_changes_compaction_and_custom_events() {
    let lines = vec![
      json!({"type":"session","version":2,"id":"events","timestamp":"2026-08-01T00:00:00Z","cwd":"/events"}),
      json!({"type":"model_change","id":"model","parentId":null,"timestamp":"2026-08-01T00:00:01Z","provider":"openai","modelId":"gpt-5"}),
      json!({"type":"thinking_level_change","id":"thinking","parentId":"model","timestamp":"2026-08-01T00:00:02Z","thinkingLevel":"high"}),
      json!({"type":"message","id":"assistant","parentId":"thinking","timestamp":"2026-08-01T00:00:03Z","message":{"role":"assistant","model":"gpt-5","content":[{"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"a"}}],"usage":{"input":1,"output":1,"reasoning":1,"totalTokens":3}}}),
      json!({"type":"message","id":"tool","parentId":"assistant","timestamp":"2026-08-01T00:00:04Z","message":{"role":"toolResult","toolCallId":"call-1","toolName":"read","content":[{"type":"text","text":"denied"}],"isError":true}}),
      json!({"type":"message","id":"bash","parentId":"tool","timestamp":"2026-08-01T00:00:05Z","message":{"role":"bashExecution","output":"failed","exitCode":1}}),
      json!({"type":"compaction","id":"compact","parentId":"bash","timestamp":"2026-08-01T00:00:06Z","summary":"compacted context","usage":{"input":100,"output":100,"totalTokens":200,"cost":{"total":9.0}}}),
      json!({"type":"branch_summary","id":"summary","parentId":"compact","timestamp":"2026-08-01T00:00:07Z","summary":"branch context"}),
      json!({"type":"custom","id":"custom","parentId":"summary","timestamp":"2026-08-01T00:00:08Z","data":{"name":"extension-event"}}),
      json!({"type":"custom_message","id":"custom-message","parentId":"custom","timestamp":"2026-08-01T00:00:09Z","customType":"demo-extension","content":"injected context","display":true}),
    ];
    let detail = super::pi_detail(std::path::Path::new("/tmp/events.jsonl"), &lines);
    let names: Vec<&str> = detail
      .messages
      .iter()
      .flat_map(|message| message.parts.iter().filter_map(|part| part.name.as_deref()))
      .collect();
    assert!(names.contains(&"model_change"));
    assert!(names.contains(&"thinking_level_change"));
    assert!(names.contains(&"compaction"));
    assert!(names.contains(&"branch_summary"));
    assert!(names.contains(&"custom"));
    assert!(names.contains(&"demo-extension"));
    assert!(detail
      .messages
      .iter()
      .flat_map(|message| &message.parts)
      .any(|part| part.text == "failed"));
    assert!(detail
      .messages
      .iter()
      .flat_map(|message| &message.parts)
      .any(|part| { part.kind == "toolResult" && part.is_error == Some(true) }));
    assert_eq!(detail.summary.models, vec!["gpt-5"]);
    assert_eq!(detail.summary.usage.total, 3);
    assert_eq!(detail.summary.usage.reasoning, 1);
    assert_eq!(detail.summary.cost, None);
  }

  #[test]
  fn skips_blank_corrupt_and_truncated_jsonl_lines_without_losing_the_session() {
    let path =
      std::env::temp_dir().join(format!("agentpack-pi-corrupt-{}.jsonl", std::process::id()));
    std::fs::write(
      &path,
      concat!(
        "{\"type\":\"session\",\"version\":1,\"id\":\"safe\",\"timestamp\":\"2026-08-01T00:00:00Z\",\"cwd\":\"/safe\"}\n",
        "\n",
        "not-json\n",
        "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"kept\"}}\n",
        "{\"type\":\"message\""
      ),
    )
    .unwrap();
    let parsed = super::pi_parse_from_file(&path).expect("valid lines survive corruption");
    assert_eq!(parsed.summary.id, "safe");
    assert_eq!(parsed.summary.message_count, 1);
    assert_eq!(parsed.warnings.len(), 1);
    assert!(parsed.warnings[0].contains("2 malformed JSONL line"));
    let _ = std::fs::remove_file(path);
  }
}
