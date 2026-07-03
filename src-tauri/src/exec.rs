use serde::Serialize;
use std::ffi::OsStr;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

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
  c
}

/// Run a CLI command, streaming each stdout/stderr line to the frontend through
/// a Tauri channel. Returns the exit code (-1 if unknown). `Err` only when the
/// process cannot be spawned at all (e.g. binary not on PATH).
///
/// `(async)` on a sync fn makes Tauri run it on a worker thread instead of the
/// main thread, so waiting on a slow subprocess never freezes the UI.
#[tauri::command(async)]
pub fn run_command(file: String, args: Vec<String>, on_event: Channel<String>) -> Result<i32, String> {
  let mut child = build_command(&file, &args)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("command not found: {file} ({e})"))?;

  let stdout = child.stdout.take().ok_or("no stdout handle")?;
  let stderr = child.stderr.take().ok_or("no stderr handle")?;

  // Drain stderr on a side thread so stdout/stderr interleave without deadlock.
  let tx = on_event.clone();
  let stderr_thread = std::thread::spawn(move || {
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
      let _ = tx.send(line);
    }
  });

  for line in BufReader::new(stdout).lines().map_while(Result::ok) {
    let _ = on_event.send(line);
  }
  let _ = stderr_thread.join();

  let status = child.wait().map_err(|e| e.to_string())?;
  Ok(status.code().unwrap_or(-1))
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
    c.output().map(|o| o.status.success()).unwrap_or(false)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn detects_a_real_binary() {
    let bin = if cfg!(windows) { "cmd" } else { "sh" };
    assert!(on_path(bin));
  }

  #[test]
  fn missing_binary_not_installed() {
    assert!(!detect_cli("definitely-not-a-real-bin-xyz".into(), false).installed);
  }
}
