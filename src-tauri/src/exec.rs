use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

/// Run a CLI command, streaming each stdout/stderr line to the frontend through
/// a Tauri channel. Returns the exit code (-1 if unknown). `Err` only when the
/// process cannot be spawned at all (e.g. binary not on PATH).
#[tauri::command]
pub fn run_command(file: String, args: Vec<String>, on_event: Channel<String>) -> Result<i32, String> {
  let mut child = Command::new(&file)
    .args(&args)
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
  installed: bool,
  version: Option<String>,
}

/// Look a binary up on PATH without executing it (`where` on Windows, else `which`).
fn on_path(bin: &str) -> bool {
  let finder = if cfg!(windows) { "where" } else { "which" };
  Command::new(finder)
    .arg(bin)
    .output()
    .map(|o| o.status.success())
    .unwrap_or(false)
}

/// Detect a CLI. GUI tools (cc-switch) are never executed — PATH + config dir only.
#[tauri::command]
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
  match Command::new(&bin).arg("--version").output() {
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

/// Whether a process with this base name is running (best-effort, used as a
/// guardrail before writing the cc-switch DB).
#[tauri::command]
pub fn is_process_running(name: String) -> bool {
  if cfg!(windows) {
    Command::new("tasklist")
      .args(["/fi", &format!("imagename eq {name}.exe"), "/nh"])
      .output()
      .map(|o| {
        String::from_utf8_lossy(&o.stdout)
          .to_lowercase()
          .contains(&format!("{name}.exe"))
      })
      .unwrap_or(false)
  } else {
    Command::new("pgrep")
      .args(["-x", &name])
      .output()
      .map(|o| o.status.success())
      .unwrap_or(false)
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
