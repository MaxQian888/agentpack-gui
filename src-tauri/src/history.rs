//! Chat-history reader for the three agent CLIs. Each tool persists its
//! conversations very differently:
//!
//! * **Claude Code** — one JSONL file per session under
//!   `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Each line is a typed
//!   record (`user`/`assistant`/`system`/`ai-title`/…); assistant lines carry a
//!   `message.usage` block. Sub-agent runs get their own transcripts one level
//!   deeper, in `<session-id>/subagents/agent-<hash>.jsonl`, and oversized tool
//!   outputs are externalized to `<session-id>/tool-results/<id>.txt` with only
//!   a `<persisted-output>` stub left inline.
//! * **Codex** — one "rollout" JSONL per session under
//!   `<codexHome>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, every line a
//!   `{timestamp,type,payload}` envelope. Token totals arrive in `token_count`
//!   events; a sibling `session_index.jsonl` maps ids → thread names. A spawned
//!   sub-agent gets a rollout of its own, tagged in `session_meta` with its
//!   parent thread and its canonical agent path (`/root/<task>`); the agents
//!   talk to each other through `agent_message` records written to the
//!   *recipient's* rollout.
//! * **OpenCode** — a single SQLite database (`opencode.db`) with `session` /
//!   `message` / `part` tables and precomputed per-session token + cost columns.
//!
//! This module reads them off the main thread and normalizes each into a common
//! shape (`SessionSummary` for the list, `SessionDetail` for a transcript) so the
//! webview renders one model instead of three. Everything here is read-only.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::Channel;

use crate::history_cache::ScanCache;

/// Unified token accounting. Component fields are the disjoint parts that make up
/// `total` for a given source (see `finish_total`), so summing `total` across
/// sessions never double-counts. Cached / reasoning subsets are surfaced for
/// context but are already accounted for within the source's own `total`.
#[derive(Serialize, Deserialize, Default, Clone)]
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
#[derive(Serialize, Deserialize, Clone)]
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
  /// Set on a sub-agent transcript: the id of the session that spawned it, so
  /// the list can nest it under its parent instead of listing it as a peer.
  #[serde(default)]
  parent_id: Option<String>,
  /// Sub-agent label from Claude's `agent-name` record.
  #[serde(default)]
  agent_name: Option<String>,
  /// Wall-clock time actually spent, summed from Claude's
  /// `system`/`turn_duration` records. `None` for sources that don't record it —
  /// left absent rather than zeroed so the dashboard can tell the two apart.
  #[serde(default)]
  duration_ms: Option<i64>,
}

/// One priced unit of work inside a session, packed as
/// `[ts, modelIndex, input, output, cacheRead, cacheWrite, reasoning]`.
///
/// `ts` is epoch ms; `modelIndex` indexes [`SessionSeries::models`], or is `-1`
/// when the record didn't name a model. Packed as a fixed array rather than a
/// struct because a real history holds ~200k of these — field names would
/// roughly triple both the cache file and the IPC payload while carrying no
/// extra information.
pub type PackedEvent = [i64; 7];

/// How often one tool was called in a session, and how often it failed.
///
/// `errors` is only populated for sources that mark failure explicitly (Claude's
/// `is_error` on a `tool_result`, OpenCode's `state.status`). Codex writes tool
/// output as free text with no failure flag, so its `errors` stay 0 — absent
/// data rather than a claim of success.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolStat {
  pub name: String,
  pub calls: u64,
  pub errors: u64,
}

/// The per-message detail behind a session, split out of [`SessionSummary`].
///
/// Everything that needs message-level resolution lives here: 5-hour billing
/// windows and burn rate need real timestamps, per-model cost attribution needs
/// which model spent which tokens, and the tool profile needs call counts. The
/// split is what lets the session list stay cheap while the usage dashboard
/// still gets the raw material.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSeries {
  pub id: String,
  pub source: String,
  pub project_name: String,
  pub git_branch: Option<String>,
  pub parent_id: Option<String>,
  /// Model ids referenced by `events[i][1]`, in first-seen order.
  pub models: Vec<String>,
  pub events: Vec<PackedEvent>,
  pub tools: Vec<ToolStat>,
}

/// A file parsed once, feeding both caches.
pub struct ParsedSession {
  pub summary: SessionSummary,
  pub series: SessionSeries,
}

/// The identity a finished parse stamps onto **both** halves.
///
/// [`SessionSummary`] and [`SessionSeries`] each carry the id, source, project,
/// branch, parent and model list. Spelling them out twice per source is what
/// invites drift: a `parent_id` set on the summary but left `None` on the series
/// would make the session list and the usage dashboard disagree about which runs
/// are sub-agents — and that single flag drives the "only top-level ones count
/// as sessions" rule. Naming the shared part once makes them agree by
/// construction.
struct SessionIdentity {
  id: String,
  source: &'static str,
  project_name: String,
  git_branch: Option<String>,
  parent_id: Option<String>,
  models: Vec<String>,
}

/// The rest of the summary — the parts the series deliberately drops.
struct SummaryFields {
  title: String,
  cwd: String,
  message_count: u64,
  usage: TokenUsage,
  started_at: i64,
  updated_at: i64,
  path: String,
  agent_name: Option<String>,
  duration_ms: Option<i64>,
}

impl ParsedSession {
  /// Build both halves from one description of the session.
  ///
  /// `cost` is always `None` here: only OpenCode records a real figure, and it
  /// builds its summary straight from SQL without going through a parse.
  fn assemble(
    identity: SessionIdentity,
    fields: SummaryFields,
    events: Vec<PackedEvent>,
    tools: Vec<ToolStat>,
  ) -> ParsedSession {
    let SessionIdentity {
      id,
      source,
      project_name,
      git_branch,
      parent_id,
      models,
    } = identity;
    ParsedSession {
      series: SessionSeries {
        id: id.clone(),
        source: source.into(),
        project_name: project_name.clone(),
        git_branch: git_branch.clone(),
        parent_id: parent_id.clone(),
        models: models.clone(),
        events,
        tools,
      },
      summary: SessionSummary {
        id,
        source: source.into(),
        title: fields.title,
        cwd: fields.cwd,
        project_name,
        // Primary model is the last one seen, matching what the series' own
        // model table ends on.
        model: models.last().cloned().unwrap_or_default(),
        models,
        message_count: fields.message_count,
        usage: fields.usage,
        cost: None,
        started_at: fields.started_at,
        updated_at: fields.updated_at,
        path: fields.path,
        git_branch,
        parent_id,
        agent_name: fields.agent_name,
        duration_ms: fields.duration_ms,
      },
    }
  }
}

/// Running tool tallies, kept name-keyed while folding and flattened on finish.
#[derive(Default)]
struct ToolTally {
  counts: HashMap<String, (u64, u64)>,
  /// `tool_use_id` → tool name, so a later `tool_result` can attribute its
  /// error to the tool that produced it.
  call_names: HashMap<String, String>,
}

impl ToolTally {
  fn call(&mut self, name: &str, call_id: Option<&str>) {
    self.counts.entry(name.to_string()).or_default().0 += 1;
    if let Some(id) = call_id {
      self.call_names.insert(id.to_string(), name.to_string());
    }
  }

  fn error(&mut self, call_id: Option<&str>) {
    let Some(name) = call_id.and_then(|id| self.call_names.get(id)).cloned() else {
      return;
    };
    self.counts.entry(name).or_default().1 += 1;
  }

  /// Record a call whose outcome is already known — OpenCode reports the status
  /// on the very part that names the tool, so it needs no call-id round trip.
  fn call_with_outcome(&mut self, name: &str, failed: bool) {
    let e = self.counts.entry(name.to_string()).or_default();
    e.0 += 1;
    if failed {
      e.1 += 1;
    }
  }

  /// Flattened, most-called first, so the UI's "top tools" needs no re-sort.
  fn finish(self) -> Vec<ToolStat> {
    let mut out: Vec<ToolStat> = self
      .counts
      .into_iter()
      .map(|(name, (calls, errors))| ToolStat {
        name,
        calls,
        errors,
      })
      .collect();
    out.sort_by(|a, b| b.calls.cmp(&a.calls).then_with(|| a.name.cmp(&b.name)));
    out
  }
}

/// Index of `model` in `models`, appending it when new; `-1` for an unnamed one.
fn model_index(models: &mut Vec<String>, model: Option<&str>) -> i64 {
  let Some(model) = model.filter(|m| !m.is_empty() && *m != "<synthetic>") else {
    return -1;
  };
  match models.iter().position(|m| m == model) {
    Some(i) => i as i64,
    None => {
      models.push(model.to_string());
      (models.len() - 1) as i64
    }
  }
}

/// Pack one usage record; `None` when it carries no tokens at all (nothing to
/// aggregate, and 200k empty rows is pure payload).
fn pack_event(ts: i64, model_idx: i64, u: &TokenUsage) -> Option<PackedEvent> {
  if u.total == 0 {
    return None;
  }
  Some([
    ts,
    model_idx,
    u.input as i64,
    u.output as i64,
    u.cache_read as i64,
    u.cache_write as i64,
    u.reasoning as i64,
  ])
}

/// One normalized content block within a message.
///
/// `kind` ∈ text | thinking | toolCall | toolResult | image | patch | webSearch
/// | event | agentMessage | subagentActivity.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Part {
  kind: String,
  /// Main payload: message text, tool input, tool output, patch body, etc.
  /// Capped at [`PART_INLINE_LIMIT`] — see `truncated`.
  text: String,
  /// Tool name for toolCall / toolResult; attachment subtype for `event`;
  /// envelope kind for agentMessage (`FINAL_ANSWER`, …) and subagentActivity
  /// (`started`, …).
  name: Option<String>,
  /// The *other* agent a multi-agent part concerns, as its canonical Codex path
  /// (`/root/pip_i18n`): who sent an agentMessage, whom a subagentActivity is
  /// about. `None` for every single-agent part kind.
  #[serde(default)]
  agent: Option<String>,
  call_id: Option<String>,
  is_error: Option<bool>,
  /// `true` when `text` is only a prefix of the real payload.
  truncated: Option<bool>,
  /// Byte length of the full payload when `truncated`.
  full_bytes: Option<u64>,
  /// How `history_get_part_text` finds the full payload: `file:<abs path>` for
  /// an externalized tool result, or `part:<message id>:<part index>` to
  /// re-read it from the transcript.
  #[serde(rename = "ref")]
  full_ref: Option<String>,
}

impl Part {
  fn text(kind: &str, text: String) -> Part {
    Part {
      kind: kind.into(),
      text,
      ..Part::default()
    }
  }
}

/// Cap on inline part text handed to the webview. Tool inputs/outputs are
/// collapsed by default in the transcript, so shipping them whole is pure waste
/// — measured on real sessions, 88% of a large transcript's bytes are tool
/// payloads. Anything longer is truncated here and refetched on expand via
/// `history_get_part_text`.
const PART_INLINE_LIMIT: usize = 4096;

/// Truncate `part.text` to [`PART_INLINE_LIMIT`] (on a char boundary), recording
/// the full length and a locator to fetch it back. A part already carrying an
/// explicit `full_ref` (externalized output) keeps it; otherwise the part is
/// addressed by its position in the transcript. No-op for short text.
fn cap_part(mut part: Part, msg_id: &str, index: usize) -> Part {
  if part.full_ref.is_some() {
    // Externalized output: `text` is the inline preview, never the whole thing.
    return part;
  }
  if part.text.len() <= PART_INLINE_LIMIT {
    return part;
  }
  let mut cut = PART_INLINE_LIMIT;
  while cut > 0 && !part.text.is_char_boundary(cut) {
    cut -= 1;
  }
  part.full_bytes = Some(part.text.len() as u64);
  part.truncated = Some(true);
  part.full_ref = Some(format!("part:{msg_id}:{index}"));
  part.text.truncate(cut);
  part
}

/// Cap every part of a message in place, addressing each by its index.
fn cap_message(msg: &mut Message) {
  let id = msg.id.clone();
  let parts = std::mem::take(&mut msg.parts);
  msg.parts = parts
    .into_iter()
    .enumerate()
    .map(|(i, p)| cap_part(p, &id, i))
    .collect();
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
    Message {
      id,
      role: role.into(),
      ts: None,
      model: None,
      parts: Vec::new(),
      usage: None,
    }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSeriesResult {
  sessions: Vec<SessionSeries>,
  errors: Vec<SourceError>,
}

mod util;

use util::read_jsonl;

mod scan;

use scan::{scan_files, Progress, ScanProgressEvent};

mod claude;

use claude::{claude_detail, claude_parse_from_file, claude_root, claude_sigs};

mod opencode;

use opencode::{opencode_detail, opencode_series, scan_opencode};

mod codex;

use codex::{codex_detail, codex_parse_from_file, codex_sigs, codex_titles};

// ── Tauri commands ───────────────────────────────────────────────────────────

/// One pass over every installed source, filling both caches.
///
/// Both history commands go through here. After a scan the caches are warm, so
/// the second command is a few thousand `stat` calls rather than a second read
/// of the same gigabytes — which is the whole reason the series is collected
/// during the summary scan instead of on demand.
fn scan_all(
  progress: Channel<ScanProgressEvent>,
) -> (Vec<SessionSummary>, Vec<SourceError>, ScanCache) {
  // Load the persisted caches; unchanged Claude/Codex files are reused from
  // them and only new/grown ones are re-parsed (in parallel). `new_cache`
  // collects exactly the files seen this scan, so vanished files are pruned.
  let cache = crate::history_cache::load_scan();
  let mut new_cache = ScanCache::default();
  let mut sessions = Vec::new();
  let mut errors = Vec::new();

  let claude = claude_sigs().map_err(|e| SourceError {
    source: "claude".into(),
    message: e,
  });
  let codex = codex_sigs().map_err(|e| SourceError {
    source: "codex".into(),
    message: e,
  });
  let total =
    claude.as_ref().map(Vec::len).unwrap_or(0) + codex.as_ref().map(|(s, _)| s.len()).unwrap_or(0);
  let reporter = Progress::new(Some(progress), total);

  match claude {
    Ok(sigs) => scan_files(
      &cache,
      &mut new_cache,
      &mut sessions,
      sigs,
      &reporter,
      claude_parse_from_file,
    ),
    Err(e) => errors.push(e),
  }
  match codex {
    Ok((sigs, titles)) => scan_files(
      &cache,
      &mut new_cache,
      &mut sessions,
      sigs,
      &reporter,
      |p| codex_parse_from_file(p, &titles),
    ),
    Err(e) => errors.push(e),
  }
  if let Err(e) = scan_opencode(&mut sessions) {
    errors.push(SourceError {
      source: "opencode".into(),
      message: e,
    });
  }

  // Persist only when the file-based cache actually changed — a pure all-hit
  // rescan (same set, same signatures) writes nothing.
  if cache_changed(&cache, &new_cache) {
    crate::history_cache::save(&new_cache.summaries);
    crate::history_cache::save_series(&new_cache.series);
  }
  sessions.sort_by_key(|b| std::cmp::Reverse(b.updated_at));
  (sessions, errors, new_cache)
}

/// Scan every installed source and return normalized session summaries plus any
/// per-source read errors (a *missing* source is silently absent, not an error).
#[tauri::command(async)]
pub fn history_list_sessions(progress: Channel<ScanProgressEvent>) -> ListResult {
  let (sessions, errors, _) = scan_all(progress);
  ListResult { sessions, errors }
}

/// The per-message usage series behind those sessions — the raw material for
/// 5-hour billing windows, burn rate, per-model attribution and tool profiles.
///
/// Split from `history_list_sessions` because it is one to two orders of
/// magnitude larger: the session list must not carry it, and it is fetched only
/// when the usage dashboard is opened.
#[tauri::command(async)]
pub fn history_usage_series(progress: Channel<ScanProgressEvent>) -> UsageSeriesResult {
  let (_, mut errors, cache) = scan_all(progress);
  let mut sessions: Vec<SessionSeries> = cache
    .series
    .entries
    .into_values()
    .map(|e| e.series)
    .filter(|s| !s.events.is_empty() || !s.tools.is_empty())
    .collect();
  if let Err(e) = opencode_series(&mut sessions) {
    errors.push(SourceError {
      source: "opencode".into(),
      message: e,
    });
  }
  UsageSeriesResult { sessions, errors }
}

/// Whether `new_cache` differs from `old` in its set of files or any file's
/// signature (an addition, a prune, or a re-parsed change). Checked on the
/// summary half; the series half is written from the very same pass.
fn cache_changed(old: &ScanCache, new_cache: &ScanCache) -> bool {
  new_cache.summaries.entries.len() != old.summaries.entries.len()
    || old.series.entries.len() != new_cache.series.entries.len()
    || new_cache.summaries.entries.iter().any(|(k, e)| {
      old.summaries.entries.get(k).map_or(true, |prev| {
        prev.mtime_ms != e.mtime_ms || prev.size != e.size
      })
    })
}

/// Parse one session's transcript at full fidelity, no size caps. Shared by the
/// two commands below: one caps parts before shipping them, the other reads a
/// single part back out at full length.
fn session_detail(source: &str, path: &str) -> Result<SessionDetail, String> {
  match source {
    "claude" => {
      let p = PathBuf::from(path);
      let lines = read_jsonl(&p)?;
      Ok(claude_detail(&p, &lines))
    }
    "codex" => {
      let p = PathBuf::from(path);
      let lines = read_jsonl(&p)?;
      Ok(codex_detail(&p, &lines, &codex_titles()))
    }
    "opencode" => opencode_detail(path),
    other => Err(format!("unknown history source: {other}")),
  }
}

/// Load one session's transcript. `path` is the file path (Claude/Codex) or the
/// session id (OpenCode), exactly as carried on the summary's `path`.
///
/// Oversized parts are capped here rather than in the parsers, so the caps are
/// a property of what crosses the IPC boundary and `history_get_part_text` can
/// reuse the very same parse to serve the full text back.
#[tauri::command(async)]
pub fn history_get_session(source: String, path: String) -> Result<SessionDetail, String> {
  let mut detail = session_detail(&source, &path)?;
  for msg in &mut detail.messages {
    cap_message(msg);
  }
  Ok(detail)
}

/// Fetch the full text behind a truncated part, addressed by the part's `ref`:
/// `file:<abs path>` for an externalized tool result, or `part:<msg id>:<index>`
/// to re-read it from the transcript.
#[tauri::command(async)]
pub fn history_get_part_text(
  source: String,
  path: String,
  r#ref: String,
) -> Result<String, String> {
  if let Some(file) = r#ref.strip_prefix("file:") {
    let p = PathBuf::from(file);
    // The ref crosses the IPC boundary, so treat it as untrusted: only files
    // Claude actually externalizes tool output into are readable through here.
    if !is_under_claude_root(&p) {
      return Err("refusing to read outside the Claude history root".into());
    }
    return fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()));
  }
  let rest = r#ref
    .strip_prefix("part:")
    .ok_or_else(|| format!("bad part ref: {ref_}", ref_ = r#ref))?;
  let (msg_id, index) = rest
    .rsplit_once(':')
    .ok_or_else(|| format!("bad part ref: {rest}"))?;
  let index: usize = index
    .parse()
    .map_err(|_| format!("bad part index: {index}"))?;
  let detail = session_detail(&source, &path)?;
  detail
    .messages
    .into_iter()
    .find(|m| m.id == msg_id)
    .and_then(|m| m.parts.into_iter().nth(index))
    .map(|p| p.text)
    .ok_or_else(|| format!("part not found: {msg_id}:{index}"))
}

/// Whether `p` resolves inside `~/.claude/projects`. Both sides are canonicalized
/// so `..` segments and symlinks can't escape the root.
fn is_under_claude_root(p: &Path) -> bool {
  let (Some(root), Ok(target)) = (claude_root(), p.canonicalize()) else {
    return false;
  };
  match root.canonicalize() {
    Ok(root) => target.starts_with(root),
    Err(_) => false,
  }
}

#[cfg(test)]
mod tests {
  use super::scan::{file_sig, parallel_map};
  use super::util::{basename, iso_to_epoch_ms, truncate_title};
  use super::*;
  use crate::history_cache::{CachedEntry, CachedSeries};
  use serde_json::Value;

  // Parser internals the tests reach into directly.
  use super::claude::{
    claude_attachment_part, claude_parent_id, claude_parse, claude_usage, persisted_output_path,
    strip_persisted_stub,
  };
  use super::codex::{codex_parse, codex_token_usage, redact_encrypted_args, split_agent_message};

  // The parsers return a summary *and* a usage series; most assertions here
  // only care about the summary, so unwrap that half once instead of at every
  // call site.
  fn claude_summary(path: &Path, lines: &[Value]) -> Option<SessionSummary> {
    claude_parse(path, lines).map(|p| p.summary)
  }
  fn claude_summary_from_file(path: &Path) -> Option<SessionSummary> {
    claude_parse_from_file(path).map(|p| p.summary)
  }
  fn codex_summary(
    path: &Path,
    lines: &[Value],
    titles: &HashMap<String, String>,
  ) -> Option<SessionSummary> {
    codex_parse(path, lines, titles).map(|p| p.summary)
  }
  fn codex_summary_from_file(
    path: &Path,
    titles: &HashMap<String, String>,
  ) -> Option<SessionSummary> {
    codex_parse_from_file(path, titles).map(|p| p.summary)
  }

  #[test]
  fn iso_to_epoch_ms_matches_known_instants() {
    assert_eq!(iso_to_epoch_ms("1970-01-01T00:00:00.000Z"), Some(0));
    assert_eq!(iso_to_epoch_ms("1970-01-01T00:00:01Z"), Some(1000));
    // 2026-06-15T05:45:41.325Z — verified against a reference epoch.
    assert_eq!(
      iso_to_epoch_ms("2026-06-15T05:45:41.325Z"),
      Some(1781502341325)
    );
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

  /// One streamed assistant turn arrives as several lines — one per content
  /// block — all repeating the same ids and the same whole-turn `usage`.
  fn claude_assistant_line(
    uuid: &str,
    msg_id: &str,
    req: &str,
    block: &str,
    sidechain: bool,
  ) -> Value {
    serde_json::from_str(&format!(
      r#"{{"type":"assistant","uuid":"{uuid}","requestId":"{req}","isSidechain":{sidechain},
          "timestamp":"2026-01-01T00:00:01Z",
          "message":{{"id":"{msg_id}","role":"assistant","model":"claude-opus-4-8",
            "content":[{block}],
            "usage":{{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}}}}"#
    ))
    .unwrap()
  }

  #[test]
  fn claude_counts_a_streamed_turn_once_not_once_per_block() {
    let lines = vec![
      serde_json::from_str::<Value>(
        r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"go"}}"#,
      )
      .unwrap(),
      claude_assistant_line("a1", "msg_1", "req_1", r#"{"type":"thinking","thinking":"hmm"}"#, false),
      claude_assistant_line("a2", "msg_1", "req_1", r#"{"type":"text","text":"hi"}"#, false),
      claude_assistant_line("a3", "msg_1", "req_1", r#"{"type":"tool_use","id":"t1","name":"Read","input":{}}"#, false),
    ];
    let sum = claude_summary(Path::new("s.jsonl"), &lines).unwrap();
    assert_eq!(
      sum.usage.total, 120,
      "three blocks of one turn must count once"
    );
    assert_eq!(sum.usage.input, 100);
    assert_eq!(sum.message_count, 2, "one user turn + one assistant turn");
  }

  #[test]
  fn claude_counts_a_retry_but_drops_a_sidechain_replay() {
    let lines = vec![
      claude_assistant_line(
        "a1",
        "msg_1",
        "req_1",
        r#"{"type":"text","text":"hi"}"#,
        false,
      ),
      // Same message id under a NEW requestId and not a sidechain: a real retry,
      // really billed, so it counts.
      claude_assistant_line(
        "a2",
        "msg_1",
        "req_2",
        r#"{"type":"text","text":"hi"}"#,
        false,
      ),
      // Same message id replayed into a sidechain: already paid for, dropped.
      claude_assistant_line(
        "a3",
        "msg_1",
        "req_3",
        r#"{"type":"text","text":"hi"}"#,
        true,
      ),
    ];
    let sum = claude_summary(Path::new("s.jsonl"), &lines).unwrap();
    assert_eq!(sum.usage.total, 240);
    assert_eq!(sum.message_count, 2);
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
  fn codex_fork_keeps_its_own_id_not_the_parents() {
    // A sub-agent / forked rollout opens with its own `session_meta`, then
    // replays the parent thread's history — parent `session_meta` included.
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"fork-1","session_id":"root-1","forked_from_id":"root-1","parent_thread_id":"root-1","cwd":"/proj/fork"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:01Z","payload":{"id":"root-1","session_id":"root-1","cwd":"/proj"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:02Z","payload":{"type":"user_message","message":"hi"}}"#).unwrap(),
    ];
    let titles = HashMap::from([("root-1".to_string(), "parent title".to_string())]);
    let sum = codex_summary(Path::new("rollout-fork-1.jsonl"), &lines, &titles).unwrap();
    assert_eq!(sum.id, "fork-1");
    assert_eq!(sum.cwd, "/proj/fork");
    // …so it doesn't borrow the parent's session-index title either.
    assert_eq!(sum.title, "hi");
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

  // ── sub-agents, truncation, externalized output, extra record types ────────

  #[test]
  fn claude_parent_id_reads_subagent_layout() {
    // `<project>/<parent-session>/subagents/agent-<hash>.jsonl` is a sub-agent…
    assert_eq!(
      claude_parent_id(Path::new("/p/-proj/parent-1/subagents/agent-abc.jsonl")).as_deref(),
      Some("parent-1")
    );
    // Workflow runs nest one more level under `subagents/`.
    assert_eq!(
      claude_parent_id(Path::new(
        "/p/-proj/parent-1/subagents/workflows/wf_ab/agent-x.jsonl"
      ))
      .as_deref(),
      Some("parent-1")
    );
    // …while a file directly under the project dir is a top-level session.
    assert_eq!(claude_parent_id(Path::new("/p/-proj/sess.jsonl")), None);
    // A sibling directory that isn't `subagents` must not be mistaken for one.
    assert_eq!(
      claude_parent_id(Path::new("/p/-proj/parent-1/tool-results/x.jsonl")),
      None
    );
  }

  #[test]
  fn cap_part_truncates_on_a_char_boundary() {
    // 4095 ASCII bytes then multi-byte chars, so the cap lands mid-character.
    let text = format!("{}{}", "a".repeat(PART_INLINE_LIMIT - 1), "中".repeat(10));
    let capped = cap_part(Part::text("toolResult", text.clone()), "m1", 3);
    assert_eq!(capped.truncated, Some(true));
    assert_eq!(capped.full_bytes, Some(text.len() as u64));
    assert_eq!(capped.full_ref.as_deref(), Some("part:m1:3"));
    // Backed off to the boundary rather than splitting the character.
    assert_eq!(capped.text.len(), PART_INLINE_LIMIT - 1);
    assert!(capped.text.chars().all(|c| c == 'a'));
  }

  #[test]
  fn cap_part_leaves_short_text_and_external_refs_alone() {
    let short = cap_part(Part::text("text", "hi".into()), "m1", 0);
    assert_eq!(short.truncated, None);
    assert_eq!(short.full_ref, None);

    // An externalized result already carries its own ref; `text` is the preview
    // and must not be re-pointed at the transcript.
    let external = Part {
      kind: "toolResult".into(),
      text: "x".repeat(PART_INLINE_LIMIT * 2),
      truncated: Some(true),
      full_ref: Some("file:/tmp/out.txt".into()),
      ..Part::default()
    };
    let capped = cap_part(external, "m1", 0);
    assert_eq!(capped.full_ref.as_deref(), Some("file:/tmp/out.txt"));
    assert_eq!(capped.text.len(), PART_INLINE_LIMIT * 2);
  }

  #[test]
  fn persisted_output_path_reads_stub_and_sidecar() {
    let stub = "<persisted-output>\nOutput too large (80.4KB). Full output saved to: /tmp/tr/a.txt\n\nPreview (first 2KB):\nhello\n";
    assert_eq!(
      persisted_output_path(stub, None).as_deref(),
      Some("/tmp/tr/a.txt")
    );
    // The `toolUseResult` sidecar wins when present.
    let sidecar: Value =
      serde_json::from_str(r#"{"persistedOutputPath":"/tmp/tr/b.txt"}"#).unwrap();
    assert_eq!(
      persisted_output_path(stub, Some(&sidecar)).as_deref(),
      Some("/tmp/tr/b.txt")
    );
    // Ordinary inline output is not externalized.
    assert_eq!(persisted_output_path("just output", None), None);
  }

  #[test]
  fn strip_persisted_stub_keeps_only_the_preview_body() {
    let stub = "<persisted-output>\nOutput too large (80.4KB). Full output saved to: /tmp/a.txt\n\nPreview (first 2KB):\nreal body\n";
    assert_eq!(strip_persisted_stub(stub), "real body\n");
    assert_eq!(strip_persisted_stub("plain"), "plain");
  }

  #[test]
  fn claude_detail_carries_externalized_tool_result() {
    let lines: Vec<Value> = vec![serde_json::from_str(
      r#"{"type":"user","uuid":"u1","timestamp":"2026-01-01T00:00:00Z","toolUseResult":{"persistedOutputPath":"/tmp/tr/a.txt"},"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"<persisted-output>\nOutput too large (80.4KB). Full output saved to: /tmp/tr/a.txt\n\nPreview (first 2KB):\nbody\n"}]}}"#,
    )
    .unwrap()];
    let d = claude_detail(Path::new("s.jsonl"), &lines);
    let part = &d.messages[0].parts[0];
    assert_eq!(part.kind, "toolResult");
    assert_eq!(part.full_ref.as_deref(), Some("file:/tmp/tr/a.txt"));
    assert_eq!(part.truncated, Some(true));
    // The reader sees the preview, not the absolute path wrapper.
    assert_eq!(part.text, "body\n");
  }

  #[test]
  fn claude_attachment_part_keeps_only_whitelisted_subtypes() {
    let hook: Value = serde_json::from_str(
      r#"{"type":"hook_success","hookName":"PostToolUse:Write","stdout":"ok\n","stderr":""}"#,
    )
    .unwrap();
    let p = claude_attachment_part(Some(&hook)).unwrap();
    assert_eq!(p.kind, "event");
    assert_eq!(p.name.as_deref(), Some("hook_success"));
    assert_eq!(p.text, "PostToolUse:Write\nok");

    let file: Value =
      serde_json::from_str(r#"{"type":"opened_file_in_ide","filename":"/a/b.yaml"}"#).unwrap();
    assert_eq!(
      claude_attachment_part(Some(&file)).unwrap().text,
      "/a/b.yaml"
    );

    // Injected machinery is noise — dropped, not rendered and not an error.
    let noise: Value =
      serde_json::from_str(r#"{"type":"task_reminder","content":"remember"}"#).unwrap();
    assert!(claude_attachment_part(Some(&noise)).is_none());
    assert!(claude_attachment_part(None).is_none());
  }

  #[test]
  fn claude_summary_sums_turn_duration_and_titles_by_agent_name() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"agent-name","agentName":"audit-panel","sessionId":"s"}"#).unwrap(),
      serde_json::from_str(r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","cwd":"/proj","message":{"role":"user","content":"hi"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"system","subtype":"turn_duration","durationMs":1500,"timestamp":"2026-01-01T00:00:05Z"}"#).unwrap(),
      serde_json::from_str(r#"{"type":"system","subtype":"turn_duration","durationMs":2500,"timestamp":"2026-01-01T00:00:09Z"}"#).unwrap(),
      serde_json::from_str(r#"{"type":"system","subtype":"away_summary","timestamp":"2026-01-01T00:00:10Z"}"#).unwrap(),
    ];
    let sum = claude_summary(Path::new("s.jsonl"), &lines).unwrap();
    assert_eq!(sum.duration_ms, Some(4000));
    assert_eq!(sum.agent_name.as_deref(), Some("audit-panel"));
    // No `aiTitle`, so the sub-agent's name names the session.
    assert_eq!(sum.title, "audit-panel");
    // The `system` records still widen the session's time range.
    assert_eq!(
      sum.updated_at,
      iso_to_epoch_ms("2026-01-01T00:00:10Z").unwrap()
    );
  }

  #[test]
  fn codex_detail_groups_assistant_turn() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"sess1","cwd":"/proj"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:01Z","payload":{"type":"user_message","message":"do it"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"response_item","timestamp":"2026-01-01T00:00:02Z","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"planning"}]}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:03Z","payload":{"type":"agent_message","message":"done"}}"#).unwrap(),
    ];
    let d = codex_detail(
      Path::new("r.jsonl"),
      &lines,
      &std::collections::HashMap::new(),
    );
    assert_eq!(d.messages.len(), 2);
    assert_eq!(d.messages[0].role, "user");
    assert_eq!(d.messages[1].role, "assistant");
    assert_eq!(d.messages[1].parts.len(), 2); // thinking + text
  }

  // ── Codex multi-agent ──────────────────────────────────────────────────────

  /// A spawned agent's rollout, whose `session_meta` names its parent thread and
  /// its canonical agent path.
  fn codex_subagent_meta(spawn: &str) -> Value {
    serde_json::from_str(&format!(
      r#"{{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{{"id":"agent-1","session_id":"root-1","forked_from_id":"root-1","parent_thread_id":"root-1","cwd":"/proj","thread_source":"subagent","source":{{"subagent":{{"thread_spawn":{spawn}}}}}}}}}"#
    ))
    .unwrap()
  }

  #[test]
  fn codex_subagent_meta_links_parent_and_names_the_agent() {
    let lines = vec![
      codex_subagent_meta(
        r#"{"parent_thread_id":"root-1","depth":1,"agent_path":"/root/pip_i18n","agent_nickname":"Euclid","agent_role":"i18n-reviewer"}"#,
      ),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:01Z","payload":{"type":"user_message","message":"the parent's own prompt"}}"#).unwrap(),
    ];
    let sum = codex_summary(Path::new("rollout-agent-1.jsonl"), &lines, &HashMap::new()).unwrap();
    assert_eq!(sum.parent_id.as_deref(), Some("root-1"));
    // The path's last segment names the agent — unique among siblings, unlike
    // the role, and meaningful, unlike the nickname.
    assert_eq!(sum.agent_name.as_deref(), Some("pip_i18n"));
    // A sub-agent replays the parent's history, so its first user message is the
    // parent's prompt; the agent's own name must win the title instead.
    assert_eq!(sum.title, "pip_i18n");
  }

  #[test]
  fn codex_subagent_label_falls_back_to_role_then_nickname() {
    let role_only = vec![codex_subagent_meta(
      r#"{"parent_thread_id":"root-1","depth":1,"agent_role":"explorer","agent_nickname":"Gauss"}"#,
    )];
    let sum = codex_summary(
      Path::new("rollout-agent-1.jsonl"),
      &role_only,
      &HashMap::new(),
    )
    .unwrap();
    assert_eq!(sum.agent_name.as_deref(), Some("explorer"));

    let nickname_only = vec![codex_subagent_meta(
      r#"{"parent_thread_id":"root-1","depth":1,"agent_nickname":"Gauss"}"#,
    )];
    let sum = codex_summary(
      Path::new("rollout-agent-1.jsonl"),
      &nickname_only,
      &HashMap::new(),
    )
    .unwrap();
    assert_eq!(sum.agent_name.as_deref(), Some("Gauss"));
  }

  #[test]
  fn codex_plain_fork_is_not_treated_as_a_subagent() {
    // A resumed / forked thread carries `parent_thread_id` too. Nesting it under
    // that parent would hide a real session, so only a spawn block counts.
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"fork-1","session_id":"root-1","forked_from_id":"root-1","parent_thread_id":"root-1","cwd":"/proj","source":"vscode"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:01Z","payload":{"type":"user_message","message":"hi"}}"#).unwrap(),
    ];
    let sum = codex_summary(Path::new("rollout-fork-1.jsonl"), &lines, &HashMap::new()).unwrap();
    assert_eq!(sum.parent_id, None);
    assert_eq!(sum.agent_name, None);
    assert_eq!(sum.title, "hi");
  }

  #[test]
  fn codex_detail_renders_inter_agent_traffic() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"root-1","cwd":"/proj"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:01Z","payload":{"type":"sub_agent_activity","kind":"started","agent_thread_id":"agent-1","agent_path":"/root/pip_i18n"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"response_item","timestamp":"2026-01-01T00:00:02Z","payload":{"type":"agent_message","author":"/root/pip_i18n","recipient":"/root","content":[{"type":"input_text","text":"Message Type: FINAL_ANSWER\nTask name: /root/pip_i18n\nSender: /root/pip_i18n\nPayload:\n"},{"type":"input_text","text":"Found 3 missing keys."},{"type":"encrypted_content","encrypted_content":"gAAAAAB..."}]}}"#).unwrap(),
    ];
    let d = codex_detail(Path::new("r.jsonl"), &lines, &HashMap::new());
    let parts = &d.messages[0].parts;
    assert_eq!(parts[0].kind, "subagentActivity");
    assert_eq!(parts[0].name.as_deref(), Some("started"));
    assert_eq!(parts[0].agent.as_deref(), Some("/root/pip_i18n"));
    assert_eq!(parts[1].kind, "agentMessage");
    assert_eq!(parts[1].name.as_deref(), Some("FINAL_ANSWER"));
    // Written to the recipient's rollout, so the author is the other agent.
    assert_eq!(parts[1].agent.as_deref(), Some("/root/pip_i18n"));
    // Envelope header stripped, encrypted block dropped, body kept.
    assert_eq!(parts[1].text, "Found 3 missing keys.");
  }

  #[test]
  fn split_agent_message_handles_a_headerless_body() {
    let (kind, body) = split_agent_message("just some text");
    assert_eq!(kind, None);
    assert_eq!(body, "just some text");
    // A task hand-off whose payload is entirely encrypted still names itself.
    let (kind, body) = split_agent_message("Message Type: NEW_TASK\nSender: /root\nPayload:\n");
    assert_eq!(kind.as_deref(), Some("NEW_TASK"));
    assert_eq!(body, "");
  }

  #[test]
  fn redact_encrypted_args_replaces_only_the_blob() {
    let blob = "gAAAAA".to_string() + &"x".repeat(300);
    let args = format!(r#"{{"agent_type":"explorer","message":"{blob}"}}"#);
    let out = redact_encrypted_args(&args);
    assert!(!out.contains(&blob));
    assert!(out.contains("<encrypted, 306 bytes>"));
    assert!(out.contains("explorer"));
    // Ordinary tool arguments are passed through untouched.
    let plain = r#"{"command":["ls","-la"]}"#;
    assert_eq!(redact_encrypted_args(plain), plain);
    // …as is a short string that merely starts like a token.
    let short = r#"{"message":"gAAAAAshort"}"#;
    assert_eq!(redact_encrypted_args(short), short);
  }

  // ── scan machinery: streaming, parallelism, cache ──────────────────────────

  use std::sync::atomic::{AtomicU32, Ordering};

  static TMP_COUNTER: AtomicU32 = AtomicU32::new(0);

  /// Write `contents` to a uniquely-named temp `.jsonl` and return its path.
  fn write_temp(tag: &str, contents: &str) -> PathBuf {
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let p = std::env::temp_dir().join(format!(
      "agentpack-hist-{tag}-{}-{n}.jsonl",
      std::process::id()
    ));
    fs::write(&p, contents).unwrap();
    p
  }

  /// A minimal `SessionSummary` for cache-plumbing tests (fields are private, so
  /// build it through serde like the reader does off the wire).
  fn sample_summary(path: &str) -> SessionSummary {
    serde_json::from_value(serde_json::json!({
      "id": "s", "source": "claude", "title": "t", "cwd": "/p", "projectName": "p",
      "model": "m", "models": ["m"], "messageCount": 5,
      "usage": serde_json::to_value(TokenUsage::default()).unwrap(),
      "cost": null, "startedAt": 0, "updatedAt": 0, "path": path, "gitBranch": null,
    }))
    .unwrap()
  }

  fn sample_series(id: &str) -> SessionSeries {
    SessionSeries {
      id: id.into(),
      source: "claude".into(),
      project_name: "p".into(),
      git_branch: None,
      parent_id: None,
      models: vec!["m".into()],
      events: vec![[1, 0, 1, 1, 0, 0, 0]],
      tools: Vec::new(),
    }
  }

  #[test]
  fn parallel_map_matches_serial() {
    // Empty and single-element inputs take the serial fallback.
    assert_eq!(parallel_map(Vec::<u32>::new(), |x| *x), Vec::<u32>::new());
    assert_eq!(parallel_map(vec![5u32], |x| x + 1), vec![6]);
    // A large input fans out across chunks; result set must match serial map.
    let items: Vec<u32> = (0..1000).collect();
    let mut out = parallel_map(items.clone(), |x| x * 2);
    out.sort_unstable();
    let expected: Vec<u32> = items.iter().map(|x| x * 2).collect();
    assert_eq!(out, expected);
  }

  #[test]
  fn claude_summary_from_file_matches_in_memory() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","cwd":"/proj","gitBranch":"main","message":{"role":"user","content":"hello there"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"assistant","timestamp":"2026-01-01T00:00:01Z","message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":3,"output_tokens":4}}}"#).unwrap(),
    ];
    let text = lines
      .iter()
      .map(|v| v.to_string())
      .collect::<Vec<_>>()
      .join("\n");
    let path = write_temp("claude-parity", &text);
    let streamed = claude_summary_from_file(&path).unwrap();
    let in_mem = claude_summary(&path, &lines).unwrap();
    assert_eq!(
      serde_json::to_value(&streamed).unwrap(),
      serde_json::to_value(&in_mem).unwrap()
    );
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn codex_summary_from_file_matches_in_memory() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"sess1","cwd":"/proj"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"turn_context","timestamp":"2026-01-01T00:00:00Z","payload":{"model":"gpt-5-codex"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:01Z","payload":{"type":"user_message","message":"do it"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}}"#).unwrap(),
    ];
    let titles = std::collections::HashMap::new();
    let text = lines
      .iter()
      .map(|v| v.to_string())
      .collect::<Vec<_>>()
      .join("\n");
    let path = write_temp("codex-parity", &text);
    let streamed = codex_summary_from_file(&path, &titles).unwrap();
    let in_mem = codex_summary(&path, &lines, &titles).unwrap();
    assert_eq!(
      serde_json::to_value(&streamed).unwrap(),
      serde_json::to_value(&in_mem).unwrap()
    );
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn scan_files_reuses_cache_on_matching_signature() {
    let path = write_temp("cachehit", "{}\n");
    let key = path.to_string_lossy().into_owned();
    let sig = file_sig(path.clone()).unwrap();

    // Pre-seed both caches with this file's current signature and a marker
    // summary that a re-parse of `{}` could never produce.
    let mut cache = ScanCache::default();
    cache.summaries.entries.insert(
      key.clone(),
      CachedEntry {
        mtime_ms: sig.mtime_ms,
        size: sig.size,
        summary: sample_summary(&key),
      },
    );
    cache.series.entries.insert(
      key.clone(),
      CachedSeries {
        mtime_ms: sig.mtime_ms,
        size: sig.size,
        series: sample_series(&key),
      },
    );

    let mut new_cache = ScanCache::default();
    let mut out = Vec::new();
    scan_files(
      &cache,
      &mut new_cache,
      &mut out,
      vec![sig],
      &Progress::default(),
      |_p: &Path| -> Option<ParsedSession> { panic!("parse must not run on a cache hit") },
    );

    assert_eq!(out.len(), 1);
    // The cached (marker) summary was reused, not a fresh parse.
    assert_eq!(serde_json::to_value(&out[0]).unwrap()["title"], "t");
    assert!(new_cache.summaries.entries.contains_key(&key));
    assert!(new_cache.series.entries.contains_key(&key));
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn scan_files_reparses_when_only_the_summary_half_is_warm() {
    let text = concat!(
      r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","cwd":"/proj","message":{"role":"user","content":"hi"}}"#,
      "\n",
      r#"{"type":"assistant","uuid":"a1","requestId":"r1","timestamp":"2026-01-01T00:00:01Z","message":{"id":"m1","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}}"#,
    );
    let path = write_temp("halfwarm", text);
    let key = path.to_string_lossy().into_owned();
    let sig = file_sig(path.clone()).unwrap();

    // Summary cached, series missing — the state after upgrading into a build
    // that collects series. Reusing the summary alone would leave the dashboard
    // with no events until something else touched the file.
    let mut cache = ScanCache::default();
    cache.summaries.entries.insert(
      key.clone(),
      CachedEntry {
        mtime_ms: sig.mtime_ms,
        size: sig.size,
        summary: sample_summary(&key),
      },
    );

    let mut new_cache = ScanCache::default();
    let mut out = Vec::new();
    scan_files(
      &cache,
      &mut new_cache,
      &mut out,
      vec![sig],
      &Progress::default(),
      claude_parse_from_file,
    );

    assert_eq!(new_cache.series.entries[&key].series.events.len(), 1);
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn scan_files_parses_on_miss_and_fills_new_cache() {
    let text = concat!(
      r#"{"type":"user","timestamp":"2026-01-01T00:00:00Z","cwd":"/proj","message":{"role":"user","content":"hi"}}"#,
      "\n",
      r#"{"type":"assistant","timestamp":"2026-01-01T00:00:01Z","message":{"role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}}"#,
    );
    let path = write_temp("miss", text);
    let key = path.to_string_lossy().into_owned();
    let sig = file_sig(path.clone()).unwrap();

    let cache = ScanCache::default(); // empty → guaranteed miss
    let mut new_cache = ScanCache::default();
    let mut out = Vec::new();
    scan_files(
      &cache,
      &mut new_cache,
      &mut out,
      vec![sig],
      &Progress::default(),
      claude_parse_from_file,
    );

    assert_eq!(out.len(), 1);
    assert!(new_cache.summaries.entries.contains_key(&key));
    assert!(new_cache.series.entries.contains_key(&key));
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn cache_changed_detects_add_edit_and_prune() {
    let entry = |m: i64, s: u64| CachedEntry {
      mtime_ms: m,
      size: s,
      summary: sample_summary("k"),
    };
    let mut a = ScanCache::default();
    let mut b = ScanCache::default();
    assert!(!cache_changed(&a, &b)); // both empty

    b.summaries.entries.insert("k".into(), entry(1, 2));
    assert!(cache_changed(&a, &b)); // addition

    a.summaries.entries.insert("k".into(), entry(1, 2));
    assert!(!cache_changed(&a, &b)); // identical set + signatures

    b.summaries.entries.get_mut("k").unwrap().mtime_ms = 9;
    assert!(cache_changed(&a, &b)); // same key, changed signature

    b.summaries.entries.clear();
    assert!(cache_changed(&a, &b)); // prune
  }

  #[test]
  fn cache_changed_notices_a_cold_series_half() {
    // Same summaries on both sides, but the old cache has no series: the scan
    // just rebuilt them and must persist, or the next launch rebuilds again.
    let entry = |m: i64, s: u64| CachedEntry {
      mtime_ms: m,
      size: s,
      summary: sample_summary("k"),
    };
    let mut old = ScanCache::default();
    let mut fresh = ScanCache::default();
    old.summaries.entries.insert("k".into(), entry(1, 2));
    fresh.summaries.entries.insert("k".into(), entry(1, 2));
    fresh.series.entries.insert(
      "k".into(),
      CachedSeries {
        mtime_ms: 1,
        size: 2,
        series: sample_series("k"),
      },
    );
    assert!(cache_changed(&old, &fresh));
  }

  #[test]
  fn claude_collects_events_and_tool_calls() {
    let lines = vec![
      claude_assistant_line("a1", "msg_1", "req_1", r#"{"type":"thinking","thinking":"hmm"}"#, false),
      // Same turn, second line: its `usage` is a repeat, but the tool_use block
      // is its own and must still be counted.
      claude_assistant_line("a2", "msg_1", "req_1", r#"{"type":"tool_use","id":"t1","name":"Read","input":{}}"#, false),
      serde_json::from_str::<Value>(
        r#"{"type":"user","uuid":"u2","timestamp":"2026-01-01T00:00:02Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"boom"}]}}"#,
      )
      .unwrap(),
    ];
    let parsed = claude_parse(Path::new("s.jsonl"), &lines).unwrap();
    assert_eq!(parsed.series.events.len(), 1, "one turn → one event");
    let ev = parsed.series.events[0];
    assert_eq!(ev[1], 0, "model index into series.models");
    assert_eq!(ev[2], 100); // input
    assert_eq!(ev[3], 20); // output
    assert_eq!(parsed.series.models, vec!["claude-opus-4-8"]);
    assert_eq!(parsed.series.tools.len(), 1);
    assert_eq!(parsed.series.tools[0].name, "Read");
    assert_eq!(parsed.series.tools[0].calls, 1);
    assert_eq!(parsed.series.tools[0].errors, 1);
  }

  #[test]
  fn codex_series_uses_the_per_turn_delta_not_the_running_total() {
    let lines: Vec<Value> = vec![
      serde_json::from_str(r#"{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"t1","cwd":"/proj"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"turn_context","timestamp":"2026-01-01T00:00:01Z","payload":{"model":"gpt-5.3-codex"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"response_item","timestamp":"2026-01-01T00:00:02Z","payload":{"type":"function_call","name":"shell","call_id":"c1","arguments":"{}"}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:03Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110},"last_token_usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110}}}}"#).unwrap(),
      serde_json::from_str(r#"{"type":"event_msg","timestamp":"2026-01-01T00:00:04Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"output_tokens":25,"total_tokens":325},"last_token_usage":{"input_tokens":200,"output_tokens":15,"total_tokens":215}}}}"#).unwrap(),
    ];
    let parsed = codex_parse(Path::new("rollout-t1.jsonl"), &lines, &HashMap::new()).unwrap();
    // Summary keeps the cumulative figure…
    assert_eq!(parsed.summary.usage.total, 325);
    // …while the series carries the two deltas, which sum back to it.
    let totals: i64 = parsed.series.events.iter().map(|e| e[2] + e[3]).sum();
    assert_eq!(parsed.series.events.len(), 2);
    assert_eq!(totals, 325);
    assert_eq!(parsed.series.tools[0].name, "shell");
    assert_eq!(parsed.series.tools[0].errors, 0, "Codex marks no failures");
  }
}
