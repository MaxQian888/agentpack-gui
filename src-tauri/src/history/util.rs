//! Small JSON, path and time helpers shared by all three history readers.
//!
//! Nothing here knows about a session — these are the primitives the per-source
//! parsers are written in, kept apart so each reader reads as parsing logic
//! rather than string handling.

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
  v.get(key).and_then(Value::as_str)
}
pub(super) fn u(v: &Value, key: &str) -> u64 {
  v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

pub(super) fn basename(p: &str) -> String {
  let norm = p.replace('\\', "/");
  norm
    .trim_end_matches('/')
    .rsplit('/')
    .next()
    .unwrap_or(p)
    .to_string()
}

pub(super) fn truncate_title(s: &str) -> String {
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
pub(super) fn iso_to_epoch_ms(t: &str) -> Option<i64> {
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
/// Used by the *detail* path (a single session, reopened on demand). The *scan*
/// path uses the streaming `*_summary_from_file` readers instead, so it never
/// holds a whole file's parsed tree in memory.
pub(super) fn read_jsonl(path: &Path) -> Result<Vec<Value>, String> {
  let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
  Ok(
    text
      .lines()
      .filter(|l| !l.trim().is_empty())
      .filter_map(|l| serde_json::from_str::<Value>(l).ok())
      .collect(),
  )
}

/// Feed each non-empty JSONL line of `path`, parsed one at a time and dropped
/// immediately, to `push`. Peak memory is a single line's `Value`, not the whole
/// file — the streaming counterpart to `read_jsonl` for summary scanning.
pub(super) fn stream_jsonl<F: FnMut(&Value)>(path: &Path, mut push: F) -> Option<()> {
  let text = fs::read_to_string(path).ok()?;
  for line in text.lines() {
    let line = line.trim();
    if line.is_empty() {
      continue;
    }
    if let Ok(v) = serde_json::from_str::<Value>(line) {
      push(&v);
    }
  }
  Some(())
}

/// Recursively collect every `*.jsonl` under `dir`.
pub(super) fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
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
