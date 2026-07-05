use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

/// Registry of in-flight `run_command` child PIDs keyed by a caller-supplied
/// operation id, so a separate `cancel_command` invocation can find and kill a
/// running install. Only populated when the caller passes an `op_id`.
fn running_children() -> &'static Mutex<HashMap<String, u32>> {
  static CHILDREN: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
  CHILDREN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Forcibly terminate a process *and its descendants*. Installs spawn children
/// (`cmd /c npm` → node, or a shell → curl), so killing only the direct child
/// would orphan the real work; we tear down the whole tree.
#[cfg(windows)]
fn kill_tree(pid: u32) {
  let mut c = Command::new("taskkill");
  c.args(["/PID", &pid.to_string(), "/T", "/F"]);
  apply_no_window(&mut c);
  let _ = c.output();
}
#[cfg(not(windows))]
fn kill_tree(pid: u32) {
  // The child is spawned in its own process group (see `apply_process_group`),
  // so a negative pid signals the whole group — killing descendants too.
  let _ = Command::new("kill")
    .arg("-9")
    .arg(format!("-{pid}"))
    .output();
}

/// Put the spawned child in its own process group so `kill_tree` can signal the
/// entire group at once (Unix only; Windows uses `taskkill /T`).
#[cfg(not(windows))]
fn apply_process_group(c: &mut Command) {
  use std::os::unix::process::CommandExt;
  c.process_group(0);
}
#[cfg(windows)]
fn apply_process_group(_c: &mut Command) {}

/// Suppress the transient console window a spawned process would otherwise flash
/// in a GUI app (Windows only; no-op elsewhere).
#[cfg(windows)]
fn apply_no_window(c: &mut Command) {
  use std::os::windows::process::CommandExt;
  // CREATE_NO_WINDOW
  c.creation_flags(0x0800_0000);
}
#[cfg(not(windows))]
fn apply_no_window(_c: &mut Command) {}

/// Expand `%VAR%` references in a Windows registry PATH string. Registry PATH
/// values are often `REG_EXPAND_SZ` (e.g. `%SystemRoot%\system32`), so the raw
/// string must be expanded before it is usable. Unknown / unbalanced tokens are
/// left verbatim.
#[cfg(windows)]
fn expand_env_vars(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  let mut rest = s;
  while let Some(start) = rest.find('%') {
    out.push_str(&rest[..start]);
    let after = &rest[start + 1..];
    match after.find('%') {
      Some(end) => {
        let name = &after[..end];
        if name.is_empty() {
          out.push('%'); // "%%" -> literal percent
        } else if let Some(val) = std::env::var_os(name) {
          out.push_str(&val.to_string_lossy());
        } else {
          out.push('%');
          out.push_str(name);
          out.push('%');
        }
        rest = &after[end + 1..];
      }
      None => {
        out.push('%');
        out.push_str(after);
        rest = "";
      }
    }
  }
  out.push_str(rest);
  out
}

/// Directories the running process's PATH may be missing but freshly-installed
/// tools live in. On Windows this is the *live* persisted PATH from the registry
/// (what a new `cmd` window would inherit) plus npm's global shim dir.
#[cfg(windows)]
fn extra_path_dirs() -> Vec<String> {
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
  use winreg::RegKey;

  let mut dirs = Vec::new();
  let sources = [
    (HKEY_CURRENT_USER, "Environment"),
    (
      HKEY_LOCAL_MACHINE,
      r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    ),
  ];
  for (hive, subkey) in sources {
    if let Ok(key) = RegKey::predef(hive).open_subkey(subkey) {
      if let Ok(path) = key.get_value::<String, _>("Path") {
        for dir in expand_env_vars(&path).split(';') {
          let d = dir.trim();
          if !d.is_empty() {
            dirs.push(d.to_string());
          }
        }
      }
    }
  }
  // `npm i -g` drops claude/codex `.cmd` shims here; not always on the stale PATH.
  if let Some(appdata) = std::env::var_os("APPDATA") {
    let mut p = std::path::PathBuf::from(appdata);
    p.push("npm");
    dirs.push(p.to_string_lossy().into_owned());
  }
  dirs
}

/// GUI apps launched from Finder/Dock inherit a minimal PATH that usually omits
/// the dirs Homebrew, npm, cargo and per-user installs use — add them back.
#[cfg(not(windows))]
fn extra_path_dirs() -> Vec<String> {
  let mut dirs = vec![
    "/usr/local/bin".to_string(),
    "/opt/homebrew/bin".to_string(),
    "/opt/homebrew/sbin".to_string(),
  ];
  if let Some(home) = dirs::home_dir() {
    for sub in [".local/bin", ".npm-global/bin", ".bun/bin", ".cargo/bin"] {
      dirs.push(home.join(sub).to_string_lossy().into_owned());
    }
  }
  dirs
}

/// Rebuild PATH from the live persisted sources on every spawn.
///
/// A GUI process inherits PATH at launch. When a runtime or CLI is installed
/// mid-session — Node via winget, claude via `npm i -g` — the installer updates
/// the *persisted* PATH (the Windows registry / a shell rc), but this already
/// running process keeps its stale copy, so the new binary can't be found until
/// the app restarts. Recomputing here (never cached) means detection and the
/// next install step see freshly-installed tools immediately.
fn augmented_path() -> OsString {
  let mut parts: Vec<String> = Vec::new();
  let mut seen: HashSet<String> = HashSet::new();
  let mut add = |dir: String| {
    if dir.is_empty() {
      return;
    }
    // Windows paths are case-insensitive; dedup accordingly (keep first casing).
    let key = if cfg!(windows) { dir.to_lowercase() } else { dir.clone() };
    if seen.insert(key) {
      parts.push(dir);
    }
  };

  // Current process PATH first — tools already resolvable keep resolving fast.
  if let Some(p) = std::env::var_os("PATH") {
    for dir in std::env::split_paths(&p) {
      add(dir.to_string_lossy().into_owned());
    }
  }
  for dir in extra_path_dirs() {
    add(dir);
  }

  std::env::join_paths(parts.iter())
    .unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// Give a spawned process the freshly-rebuilt PATH so session-installed tools
/// are visible without an app restart.
fn apply_env(c: &mut Command) {
  c.env("PATH", augmented_path());
}

/// Build a `Command` that can actually launch the target on every OS.
///
/// On Windows, npm-installed CLIs (claude, codex) and npm/npx themselves are
/// `.cmd`/`.ps1` shims. `CreateProcess` only auto-appends `.exe`, so
/// `Command::new("claude")` fails with "not found" even when the shim is on
/// PATH — which is why detection and installs silently broke on Windows. Routing
/// through `cmd /c` makes Windows honour PATHEXT and run batch shims. On Unix the
/// binary is launched directly.
fn build_command<I, S>(file: &str, args: I) -> Command
where
  I: IntoIterator<Item = S>,
  S: AsRef<OsStr>,
{
  let mut c = if cfg!(windows) {
    let mut c = Command::new("cmd");
    c.arg("/c").arg(file).args(args);
    c
  } else {
    let mut c = Command::new(file);
    c.args(args);
    c
  };
  apply_no_window(&mut c);
  apply_env(&mut c);
  c
}

/// Read `reader` line by line, decoding each line lossily so an invalid byte
/// becomes the replacement char instead of aborting the stream.
///
/// `BufRead::lines()` yields an `Err` on the first non-UTF-8 byte, so the old
/// `lines().map_while(Result::ok)` idiom silently truncated the rest of a
/// subprocess's output — common on Windows, where npm / winget / powershell emit
/// OEM/ANSI code-page bytes. This drains to real EOF regardless of encoding.
fn stream_lines<R: std::io::Read>(reader: R, mut sink: impl FnMut(String)) {
  let mut buf = BufReader::new(reader);
  let mut bytes = Vec::new();
  loop {
    bytes.clear();
    match buf.read_until(b'\n', &mut bytes) {
      Ok(0) => break, // EOF
      Ok(_) => {
        while matches!(bytes.last(), Some(b'\n') | Some(b'\r')) {
          bytes.pop();
        }
        sink(String::from_utf8_lossy(&bytes).into_owned());
      }
      Err(_) => break, // genuine IO error — stop reading this stream
    }
  }
}

/// Sentinel error returned when a command was killed by the timeout monitor, so
/// the frontend can render a localized "timed out" message instead of a raw code.
pub const TIMEOUT_ERR: &str = "agentpack:timeout";

/// Run a CLI command, streaming each stdout/stderr line to the frontend through
/// a Tauri channel. Returns the exit code (-1 if unknown). `Err` when the process
/// cannot be spawned (binary not on PATH) or was killed by the timeout.
///
/// `op_id` (optional) registers the child so `cancel_command(op_id)` can kill it
/// mid-run; `timeout_secs` (optional) auto-kills a process that never exits.
///
/// `(async)` on a sync fn makes Tauri run it on a worker thread instead of the
/// main thread, so waiting on a slow subprocess never freezes the UI.
#[tauri::command(async)]
pub fn run_command(
  file: String,
  args: Vec<String>,
  on_event: Channel<String>,
  op_id: Option<String>,
  timeout_secs: Option<u64>,
) -> Result<i32, String> {
  // Resolve the target up front. On Windows every command is wrapped in `cmd /c`,
  // so a missing binary would otherwise spawn `cmd` fine and merely exit non-zero
  // — hiding the real "not found" cause the frontend keys its hints off. Probing
  // PATH here makes all three platforms report the same clean error.
  if !on_path(&file) {
    return Err(format!("command not found: {file}"));
  }

  let mut cmd = build_command(&file, &args);
  // Detach stdin so an installer that prompts (e.g. a Y/N) gets EOF and fails
  // fast instead of hanging forever on a GUI process with no console to answer.
  cmd
    .stdin(Stdio::null())
    // Force non-interactive behaviour where tools honour it.
    .env("CI", "1")
    .env("npm_config_yes", "true")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
  apply_process_group(&mut cmd);

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("command not found: {file} ({e})"))?;

  let pid = child.id();
  if let Some(id) = &op_id {
    if let Ok(mut map) = running_children().lock() {
      map.insert(id.clone(), pid);
    }
  }

  // Timeout monitor: a background thread that kills the tree once the deadline
  // passes. `done` lets the main path stop the monitor cleanly on normal exit.
  let done = Arc::new(AtomicBool::new(false));
  let monitor = timeout_secs.map(|secs| {
    let done = done.clone();
    std::thread::spawn(move || {
      let deadline = Instant::now() + Duration::from_secs(secs);
      while !done.load(Ordering::Relaxed) {
        if Instant::now() >= deadline {
          kill_tree(pid);
          return true; // timed out
        }
        std::thread::sleep(Duration::from_millis(200));
      }
      false
    })
  });

  let stdout = child.stdout.take().ok_or("no stdout handle")?;
  let stderr = child.stderr.take().ok_or("no stderr handle")?;

  // Drain stderr on a side thread so stdout/stderr interleave without deadlock.
  let tx = on_event.clone();
  let stderr_thread = std::thread::spawn(move || {
    stream_lines(stderr, |line| {
      let _ = tx.send(line);
    });
  });

  stream_lines(stdout, |line| {
    let _ = on_event.send(line);
  });
  let _ = stderr_thread.join();

  let status = child.wait().map_err(|e| e.to_string())?;

  // Stop the monitor and learn whether it was the one that killed us.
  done.store(true, Ordering::Relaxed);
  let timed_out = monitor.map(|h| h.join().unwrap_or(false)).unwrap_or(false);
  if let Some(id) = &op_id {
    if let Ok(mut map) = running_children().lock() {
      map.remove(id);
    }
  }

  if timed_out {
    return Err(TIMEOUT_ERR.to_string());
  }
  Ok(status.code().unwrap_or(-1))
}

/// Kill a running `run_command` (and its child tree) by the operation id the
/// caller registered it under. No-op if the op already finished or never ran.
#[tauri::command(async)]
pub fn cancel_command(op_id: String) {
  let pid = running_children()
    .lock()
    .ok()
    .and_then(|map| map.get(&op_id).copied());
  if let Some(pid) = pid {
    kill_tree(pid);
  }
}

/// Launch a (usually GUI) app and return immediately without waiting for it to
/// exit. Used to start cc-switch once so it self-initializes its SQLite database;
/// `run_command` can't be reused because it blocks until the process ends, which
/// a GUI app never does. stdio is detached so no pipes are held open.
#[tauri::command(async)]
pub fn launch_app(file: String, args: Vec<String>) -> Result<(), String> {
  build_command(&file, &args)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("could not launch {file}: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
  installed: bool,
  version: Option<String>,
}

/// Look a binary up on PATH without executing it (`where` on Windows, else `which`).
/// `where`/`which` are real executables, so they're spawned directly (not via the
/// `cmd /c` wrapper), just with the window suppressed.
fn on_path(bin: &str) -> bool {
  let finder = if cfg!(windows) { "where" } else { "which" };
  let mut c = Command::new(finder);
  c.arg(bin);
  apply_no_window(&mut c);
  apply_env(&mut c);
  c.output().map(|o| o.status.success()).unwrap_or(false)
}

/// Detect a CLI. GUI tools (cc-switch) are never executed — PATH + config dir only.
#[tauri::command(async)]
pub fn detect_cli(bin: String, gui: bool) -> DetectionResult {
  if gui {
    let cc = dirs::home_dir()
      .map(|h| h.join(".cc-switch").exists())
      .unwrap_or(false);
    return DetectionResult {
      installed: on_path(&bin) || (bin == "cc-switch" && cc),
      version: None,
    };
  }
  match build_command(&bin, ["--version"]).output() {
    Ok(o) if o.status.success() => {
      let raw = if o.stdout.is_empty() { &o.stderr } else { &o.stdout };
      let v = String::from_utf8_lossy(raw);
      DetectionResult {
        installed: true,
        version: v.lines().next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
      }
    }
    _ => DetectionResult {
      installed: false,
      version: None,
    },
  }
}

/// Query the latest published version of an npm package (`npm view <pkg> version`).
/// Runs on a side thread with a hard timeout so a slow/hung registry never blocks
/// startup. Returns `None` on any failure (no npm, offline, timeout) — the UI then
/// hides the upgrade action because it can't confirm a newer version exists.
#[tauri::command(async)]
pub fn latest_version(package: String) -> Option<String> {
  let (tx, rx) = std::sync::mpsc::channel();
  std::thread::spawn(move || {
    let out = build_command("npm", ["view", &package, "version"]).output();
    let _ = tx.send(out);
  });
  match rx.recv_timeout(std::time::Duration::from_secs(8)) {
    Ok(Ok(o)) if o.status.success() => {
      let v = String::from_utf8_lossy(&o.stdout);
      v.lines().next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }
    _ => None,
  }
}

/// Whether a process with this base name is running (best-effort, used as a
/// guardrail before writing the cc-switch DB).
#[tauri::command(async)]
pub fn is_process_running(name: String) -> bool {
  if cfg!(windows) {
    let mut c = Command::new("tasklist");
    c.args(["/fi", &format!("imagename eq {name}.exe"), "/nh"]);
    apply_no_window(&mut c);
    apply_env(&mut c);
    c.output()
      .map(|o| {
        String::from_utf8_lossy(&o.stdout)
          .to_lowercase()
          .contains(&format!("{name}.exe"))
      })
      .unwrap_or(false)
  } else {
    let mut c = Command::new("pgrep");
    c.args(["-x", &name]);
    apply_env(&mut c);
    c.output().map(|o| o.status.success()).unwrap_or(false)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn stream_lines_survives_invalid_utf8() {
    // A non-UTF-8 byte on the middle line must NOT truncate the rest of the
    // stream. The old `lines().map_while(Result::ok)` idiom stopped at the first
    // decode error; all three lines should arrive, the bad one lossy-decoded.
    let data: &[u8] = b"first\n\xff\xfebad\nlast\n";
    let mut out: Vec<String> = Vec::new();
    stream_lines(data, |line| out.push(line));
    assert_eq!(out.len(), 3, "invalid UTF-8 truncated the stream: {out:?}");
    assert_eq!(out[0], "first");
    assert_eq!(out[2], "last");
  }

  #[test]
  fn detects_a_real_binary() {
    let bin = if cfg!(windows) { "cmd" } else { "sh" };
    assert!(on_path(bin));
  }

  #[test]
  fn missing_binary_not_installed() {
    assert!(!detect_cli("definitely-not-a-real-bin-xyz".into(), false).installed);
  }

  #[test]
  fn run_command_reports_missing_binary_on_all_platforms() {
    // On Windows the `cmd /c` wrapper hides a missing binary behind exit code 1;
    // the on_path pre-check makes it a clean, cross-platform "command not found".
    let channel = Channel::new(|_| Ok(()));
    let res = run_command(
      "definitely-not-a-real-bin-xyz".into(),
      vec![],
      channel,
      None,
      None,
    );
    let err = res.expect_err("missing binary must be an error");
    assert!(err.contains("command not found"), "got: {err}");
  }

  #[test]
  fn cancel_unknown_op_is_a_noop() {
    // Cancelling an op that was never registered must not panic or block.
    cancel_command("no-such-op".into());
  }

  #[test]
  fn run_command_times_out_and_reports_the_sentinel() {
    let channel = Channel::new(|_| Ok(()));
    let (file, args): (&str, Vec<String>) = if cfg!(windows) {
      ("ping", vec!["-n".into(), "20".into(), "127.0.0.1".into()])
    } else {
      ("sleep", vec!["20".into()])
    };
    let res = run_command(file.into(), args, channel, Some("test-timeout".into()), Some(1));
    assert_eq!(res, Err(TIMEOUT_ERR.to_string()));
    // The child must be deregistered once the call returns.
    assert!(running_children()
      .lock()
      .map(|m| !m.contains_key("test-timeout"))
      .unwrap_or(true));
  }

  #[test]
  fn augmented_path_preserves_base_entries() {
    let aug = augmented_path();
    assert!(!aug.is_empty());
    let aug_dirs: Vec<_> = std::env::split_paths(&aug).collect();
    if let Some(base) = std::env::var_os("PATH") {
      for d in std::env::split_paths(&base) {
        if !d.as_os_str().is_empty() {
          assert!(aug_dirs.contains(&d), "augmented PATH dropped base dir {d:?}");
        }
      }
    }
  }
}
