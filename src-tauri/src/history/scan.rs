//! Incremental-scan plumbing shared by the file-based readers.
//!
//! Scanning means `stat`ing every candidate transcript, skipping the ones both
//! caches already hold, and parsing the rest in parallel. Nothing here knows how
//! any particular CLI stores a session — the per-source modules supply that as a
//! `parse` closure, and this decides only what gets re-read and how progress is
//! reported.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;

use super::{ParsedSession, SessionSummary};
use crate::history_cache::{CachedEntry, CachedSeries, ScanCache};

/// A candidate history file plus a cheap change-signature (a `stat`, no read).
/// The signature is what the summary cache keys on: an unchanged `(mtime, size)`
/// means the file's parsed summary can be reused verbatim.
pub(super) struct FileSig {
  pub(super) path: PathBuf,
  pub(super) mtime_ms: i64,
  pub(super) size: u64,
}

/// Signature for one path, or `None` if it can't be `stat`ed.
pub(super) fn file_sig(path: PathBuf) -> Option<FileSig> {
  let md = fs::metadata(&path).ok()?;
  let size = md.len();
  let mtime_ms = md
    .modified()
    .ok()
    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0);
  Some(FileSig {
    path,
    mtime_ms,
    size,
  })
}

/// Map `f` over `items` across up to one thread per CPU core (contiguous
/// chunks), falling back to a serial map for tiny inputs. Result order is not
/// preserved — callers here don't depend on it (the session list is re-sorted).
pub(super) fn parallel_map<T, R, F>(items: Vec<T>, f: F) -> Vec<R>
where
  T: Send + Sync,
  R: Send,
  F: Fn(&T) -> R + Sync,
{
  let len = items.len();
  let workers = std::thread::available_parallelism()
    .map(|n| n.get())
    .unwrap_or(1)
    .min(len.max(1));
  if workers <= 1 {
    return items.iter().map(&f).collect();
  }
  let chunk = len.div_ceil(workers);
  let mut out: Vec<R> = Vec::with_capacity(len);
  std::thread::scope(|scope| {
    let handles: Vec<_> = items
      .chunks(chunk)
      .map(|c| scope.spawn(|| c.iter().map(&f).collect::<Vec<R>>()))
      .collect();
    for h in handles {
      out.extend(h.join().unwrap());
    }
  });
  out
}

/// How far a scan has got, streamed to the UI. Rebuilding a real history means
/// re-parsing gigabytes of JSONL; without this the first launch after a cache
/// version bump is a long spinner with nothing behind it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
  pub done: usize,
  pub total: usize,
}

/// Optional progress sink, shared across the scan's worker threads.
///
/// Reports at most one event per [`Progress::STRIDE`] files: a per-file event
/// would push thousands of messages through the IPC bridge and cost more than
/// the parsing it reports on.
#[derive(Default)]
pub(super) struct Progress {
  channel: Option<Channel<ScanProgressEvent>>,
  done: std::sync::atomic::AtomicUsize,
  total: usize,
}

impl Progress {
  const STRIDE: usize = 25;

  pub(super) fn new(channel: Option<Channel<ScanProgressEvent>>, total: usize) -> Progress {
    Progress {
      channel,
      done: std::sync::atomic::AtomicUsize::new(0),
      total,
    }
  }

  /// Count one finished file and emit if this crossed a stride boundary.
  pub(super) fn tick(&self) {
    let Some(channel) = &self.channel else { return };
    let done = self.done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if done % Self::STRIDE == 0 || done == self.total {
      let _ = channel.send(ScanProgressEvent {
        done,
        total: self.total,
      });
    }
  }
}

/// Cache-aware, parallel scan shared by the file-based sources. Files whose
/// `(mtime, size)` matches **both** caches are reused without re-reading; the
/// rest are parsed in parallel via `parse`. Every current file's entry lands in
/// `new_cache` (so vanished files are pruned for free), and summaries with at
/// least one message are appended to `out`.
///
/// Requiring a hit in both halves is what keeps the single-pass promise: a
/// summary without its series would force a second read of the same gigabytes
/// the first time the usage dashboard is opened.
pub(super) fn scan_files<F>(
  cache: &ScanCache,
  new_cache: &mut ScanCache,
  out: &mut Vec<SessionSummary>,
  sigs: Vec<FileSig>,
  progress: &Progress,
  parse: F,
) where
  F: Fn(&Path) -> Option<ParsedSession> + Sync,
{
  let mut misses = Vec::new();
  for sig in sigs {
    let key = sig.path.to_string_lossy().into_owned();
    if let Some((summary, series)) = cache.hit(&key, sig.mtime_ms, sig.size) {
      if summary.summary.message_count > 0 {
        out.push(summary.summary.clone());
      }
      new_cache.insert(key, summary.clone(), series.clone());
      progress.tick();
      continue;
    }
    misses.push(sig);
  }
  let parsed = parallel_map(misses, |sig| {
    let out = parse(&sig.path).map(|parsed| {
      (
        sig.path.to_string_lossy().into_owned(),
        CachedEntry {
          mtime_ms: sig.mtime_ms,
          size: sig.size,
          summary: parsed.summary,
          warnings: parsed.warnings,
        },
        CachedSeries {
          mtime_ms: sig.mtime_ms,
          size: sig.size,
          series: parsed.series,
        },
      )
    });
    progress.tick();
    out
  });
  for (key, entry, series) in parsed.into_iter().flatten() {
    if entry.summary.message_count > 0 {
      out.push(entry.summary.clone());
    }
    new_cache.insert(key, entry, series);
  }
}
