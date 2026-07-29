//! Persistent, mtime-keyed cache for chat-history *summaries*.
//!
//! Scanning Claude/Codex history means reading and JSON-parsing every session's
//! whole JSONL file — expensive, and paid again on every app launch and every
//! Rescan. This cache remembers each file's [`SessionSummary`] keyed by its
//! absolute path plus a `(mtime, size)` signature, so an unchanged file is
//! reused verbatim and only new or grown files are re-parsed. The on-disk form
//! lives under the OS cache dir (overridable via `AGENTPACK_HISTORY_CACHE` for
//! tests), is versioned, and is treated as a pure optimization: any read or
//! parse failure silently falls back to a full rescan.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::history::{SessionSeries, SessionSummary};

/// Bump when the cached shape *or* the parsed values change; a mismatch
/// discards the whole file.
/// v2 added `parentId` / `agentName` / `durationMs` to the cached summary.
/// v3 fixed Codex fork ids (a fork used to inherit its parent's `id`) — the
/// files themselves didn't change, so only a version bump can evict them.
/// v4 gave Codex sub-agent rollouts their `parentId` / `agentName` / label —
/// same story, unchanged files holding stale (null) values.
/// v5 deduped Claude assistant turns by `(message.id, requestId)`; every cached
/// Claude summary before it over-counted tokens and messages by roughly 2.4×.
pub const CACHE_VERSION: u32 = 5;

/// Bump when the *series* shape or its extracted values change. Versioned
/// separately from [`CACHE_VERSION`] so a change to one doesn't throw away the
/// other — they are rebuilt from the same pass but stored apart.
pub const SERIES_VERSION: u32 = 1;

/// One cached file: the signature we validate against plus its parsed summary.
#[derive(Serialize, Deserialize, Clone)]
pub struct CachedEntry {
  /// File modification time in epoch milliseconds.
  pub mtime_ms: i64,
  /// File size in bytes — pairs with `mtime_ms` to detect any change.
  pub size: u64,
  pub summary: SessionSummary,
}

/// The whole cache: version tag + `absolute path → entry`.
#[derive(Serialize, Deserialize)]
pub struct SummaryCache {
  pub version: u32,
  pub entries: HashMap<String, CachedEntry>,
}

impl Default for SummaryCache {
  fn default() -> Self {
    SummaryCache {
      version: CACHE_VERSION,
      entries: HashMap::new(),
    }
  }
}

/// Same signature, the other half of a parse: the per-message usage series.
#[derive(Serialize, Deserialize, Clone)]
pub struct CachedSeries {
  pub mtime_ms: i64,
  pub size: u64,
  pub series: SessionSeries,
}

/// The usage-series cache. Kept in its own file because it is one to two orders
/// of magnitude larger than the summary cache (a real history holds ~200k
/// events, ~9 MB against ~2.6 MB): the session list must not pay to parse it at
/// startup, and the usage dashboard loads it only when it is opened.
#[derive(Serialize, Deserialize)]
pub struct UsageCache {
  pub version: u32,
  pub entries: HashMap<String, CachedSeries>,
}

impl Default for UsageCache {
  fn default() -> Self {
    UsageCache {
      version: SERIES_VERSION,
      entries: HashMap::new(),
    }
  }
}

/// Both halves of a scan's cache, read and rewritten together. One pass over a
/// transcript fills both, so they always share a file's `(mtime, size)`.
#[derive(Default)]
pub struct ScanCache {
  pub summaries: SummaryCache,
  pub series: UsageCache,
}

impl ScanCache {
  /// Both halves of one file's cached parse, or `None` if either is absent or
  /// stale against the file's current `(mtime, size)`.
  ///
  /// A half-hit is deliberately a miss. One pass over a transcript fills both
  /// halves, so a stale half means the file must be re-read regardless — and
  /// serving a stale summary beside a fresh series is exactly how the two
  /// silently drift apart. Keeping the freshness test here, rather than at the
  /// call site, is what stops the two comparisons from being written twice and
  /// then diverging.
  pub fn hit(&self, key: &str, mtime_ms: i64, size: u64) -> Option<(&CachedEntry, &CachedSeries)> {
    let summary = self.summaries.entries.get(key)?;
    let series = self.series.entries.get(key)?;
    let current = |m: i64, s: u64| m == mtime_ms && s == size;
    if current(summary.mtime_ms, summary.size) && current(series.mtime_ms, series.size) {
      Some((summary, series))
    } else {
      None
    }
  }

  /// Record both halves of one file's parse under the same key.
  pub fn insert(&mut self, key: String, summary: CachedEntry, series: CachedSeries) {
    self.summaries.entries.insert(key.clone(), summary);
    self.series.entries.insert(key, series);
  }
}

/// Where the cache file lives — `AGENTPACK_HISTORY_CACHE` wins (test hook,
/// mirroring `AGENTPACK_CCSWITCH_DB`), else `<cache dir>/agentpack-gui/…`.
fn cache_path() -> Option<PathBuf> {
  if let Ok(p) = std::env::var("AGENTPACK_HISTORY_CACHE") {
    if !p.is_empty() {
      return Some(PathBuf::from(p));
    }
  }
  dirs::cache_dir().map(|d| d.join("agentpack-gui").join("history-cache.json"))
}

/// Where the series cache lives — a sibling of the summary cache, so the test
/// hook and the real cache directory relocate both at once.
fn series_path() -> Option<PathBuf> {
  cache_path().map(|p| p.with_extension("series.json"))
}

/// Load the cache, or an empty one on any read / parse / version problem — a
/// stale or corrupt cache must never break scanning, only slow it once.
pub fn load() -> SummaryCache {
  let Some(path) = cache_path() else {
    return SummaryCache::default();
  };
  let Ok(text) = fs::read_to_string(&path) else {
    return SummaryCache::default();
  };
  match serde_json::from_str::<SummaryCache>(&text) {
    Ok(c) if c.version == CACHE_VERSION => c,
    _ => SummaryCache::default(),
  }
}

/// The series half, same rules. Loaded separately from [`load`] so the session
/// list never pays for it.
pub fn load_series() -> UsageCache {
  let Some(path) = series_path() else {
    return UsageCache::default();
  };
  let Ok(text) = fs::read_to_string(&path) else {
    return UsageCache::default();
  };
  match serde_json::from_str::<UsageCache>(&text) {
    Ok(c) if c.version == SERIES_VERSION => c,
    _ => UsageCache::default(),
  }
}

/// Both halves at once, for a scan that is about to rewrite them.
pub fn load_scan() -> ScanCache {
  ScanCache {
    summaries: load(),
    series: load_series(),
  }
}

/// Write `text` to `path` best-effort: a sibling `.tmp` first, then a rename
/// over the target, so a crash mid-write can't leave a half-written file.
fn write_atomic(path: &PathBuf, text: &str) {
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  let tmp = path.with_extension("json.tmp");
  if fs::write(&tmp, text).is_ok() {
    let _ = fs::rename(&tmp, path);
  }
}

/// Persist the summary cache.
pub fn save(cache: &SummaryCache) {
  let Some(path) = cache_path() else { return };
  let Ok(text) = serde_json::to_string(cache) else {
    return;
  };
  write_atomic(&path, &text);
}

/// Persist the series cache.
pub fn save_series(cache: &UsageCache) {
  let Some(path) = series_path() else { return };
  let Ok(text) = serde_json::to_string(cache) else {
    return;
  };
  write_atomic(&path, &text);
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::history::TokenUsage;
  use std::sync::atomic::{AtomicU32, Ordering};

  static COUNTER: AtomicU32 = AtomicU32::new(0);

  /// A unique temp path for a test cache file (no rand/clock needed).
  fn temp_cache_path() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
      "agentpack-hist-cache-{}-{n}.json",
      std::process::id()
    ))
  }

  fn sample_summary(id: &str) -> SessionSummary {
    serde_json::from_value(serde_json::json!({
      "id": id,
      "source": "claude",
      "title": "t",
      "cwd": "/p",
      "projectName": "p",
      "model": "m",
      "models": ["m"],
      "messageCount": 3,
      "usage": TokenUsage::default(),
      "cost": null,
      "startedAt": 1,
      "updatedAt": 2,
      "path": id,
      "gitBranch": null,
    }))
    .unwrap()
  }

  #[test]
  fn save_then_load_round_trips() {
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let path = temp_cache_path();
    std::env::set_var("AGENTPACK_HISTORY_CACHE", &path);

    let mut cache = SummaryCache::default();
    cache.entries.insert(
      "a.jsonl".into(),
      CachedEntry {
        mtime_ms: 111,
        size: 222,
        summary: sample_summary("a"),
      },
    );
    save(&cache);

    let loaded = load();
    assert_eq!(loaded.version, CACHE_VERSION);
    let e = loaded.entries.get("a.jsonl").expect("entry present");
    assert_eq!(e.mtime_ms, 111);
    assert_eq!(e.size, 222);
    // `SessionSummary` fields are private; check the round-tripped value via serde.
    let v = serde_json::to_value(&e.summary).unwrap();
    assert_eq!(v["model"], "m");
    assert_eq!(v["messageCount"], 3);

    std::env::remove_var("AGENTPACK_HISTORY_CACHE");
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn version_mismatch_is_discarded() {
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let path = temp_cache_path();
    std::env::set_var("AGENTPACK_HISTORY_CACHE", &path);

    // Hand-write a cache stamped with a future version.
    fs::write(
      &path,
      r#"{"version":999,"entries":{"a.jsonl":{"mtime_ms":1,"size":2,"summary":{}}}}"#,
    )
    .unwrap();
    let loaded = load();
    assert_eq!(loaded.version, CACHE_VERSION);
    assert!(loaded.entries.is_empty());

    std::env::remove_var("AGENTPACK_HISTORY_CACHE");
    let _ = fs::remove_file(&path);
  }

  #[test]
  fn missing_file_loads_empty() {
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let path = temp_cache_path();
    std::env::set_var("AGENTPACK_HISTORY_CACHE", &path);
    let _ = fs::remove_file(&path); // ensure absent
    let loaded = load();
    assert_eq!(loaded.version, CACHE_VERSION);
    assert!(loaded.entries.is_empty());
    std::env::remove_var("AGENTPACK_HISTORY_CACHE");
  }
}
