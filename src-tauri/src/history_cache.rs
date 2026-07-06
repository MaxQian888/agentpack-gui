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

use crate::history::SessionSummary;

/// Bump when the cached shape changes; a mismatch discards the whole file.
pub const CACHE_VERSION: u32 = 1;

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
    SummaryCache { version: CACHE_VERSION, entries: HashMap::new() }
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

/// Load the cache, or an empty one on any read / parse / version problem — a
/// stale or corrupt cache must never break scanning, only slow it once.
pub fn load() -> SummaryCache {
  let Some(path) = cache_path() else { return SummaryCache::default() };
  let Ok(text) = fs::read_to_string(&path) else { return SummaryCache::default() };
  match serde_json::from_str::<SummaryCache>(&text) {
    Ok(c) if c.version == CACHE_VERSION => c,
    _ => SummaryCache::default(),
  }
}

/// Persist the cache best-effort: write a sibling `.tmp` then rename over the
/// target so a crash mid-write can't leave a half-written (corrupt) file.
pub fn save(cache: &SummaryCache) {
  let Some(path) = cache_path() else { return };
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  let Ok(text) = serde_json::to_string(cache) else { return };
  let tmp = path.with_extension("json.tmp");
  if fs::write(&tmp, text).is_ok() {
    let _ = fs::rename(&tmp, &path);
  }
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
    std::env::temp_dir().join(format!("agentpack-hist-cache-{}-{n}.json", std::process::id()))
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
      CachedEntry { mtime_ms: 111, size: 222, summary: sample_summary("a") },
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
    fs::write(&path, r#"{"version":999,"entries":{"a.jsonl":{"mtime_ms":1,"size":2,"summary":{}}}}"#)
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
