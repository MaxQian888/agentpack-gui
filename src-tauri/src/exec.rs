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
    let key = if cfg!(windows) {
      dir.to_lowercase()
    } else {
      dir.clone()
    };
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
  // Hand the proxy the user applied in agentpack to every child (npm, git, the
  // agent CLIs), so an install works the moment the proxy is set rather than
  // only after the user restarts their shell.
  for (key, value) in crate::net::child_proxy_env() {
    c.env(key, value);
  }
}

/// Build a `Command` that can actually launch the target on every OS.
///
/// On Windows, npm-installed CLIs (claude, codex) and npm/npx themselves are
/// `.cmd`/`.ps1` shims. `CreateProcess` only auto-appends `.exe`, so
/// `Command::new("claude")` fails with "not found" even when the shim is on
/// PATH — which is why detection and installs silently broke on Windows. Routing
/// through `cmd /c` makes Windows honour PATHEXT and run batch shims. On Unix the
/// binary is launched directly.
pub(crate) fn build_command<I, S>(file: &str, args: I) -> Command
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

/// Exit code we return when the user dismissed the UAC prompt (Windows
/// `ERROR_CANCELLED`). winget never exits with this, so the frontend can map it
/// to a clear "you declined administrator access" message rather than a raw code.
#[cfg(windows)]
pub const ELEVATION_DECLINED: i32 = 1223;

/// Wrap `file args` so it runs **elevated** (triggering a UAC prompt) on Windows,
/// relaying the elevated process's combined output and exit code back through a
/// normal (non-elevated) PowerShell we can stream + time out like any other child.
///
/// Machine-scope installers (Node/Python/cc-switch via winget) need admin. From a
/// non-elevated, non-interactive GUI process winget can't raise UAC itself, so it
/// fails with "access denied" — or filters out the machine-scope installer and
/// reports "No applicable installer found" (系统不匹配). Elevating here fixes both.
///
/// Two tiny scripts under %TEMP% avoid all shell-quoting hazards:
///  - inner.ps1 runs ELEVATED: `& <file> <args> > out 2>&1`, then records the exit.
///  - outer.ps1 runs NON-elevated: `Start-Process -Verb RunAs` the inner, waits,
///    echoes the captured output, self-cleans, and exits with the inner's code.
///
/// Returns `None` if the temp scaffolding can't be written; the caller then runs
/// the command unelevated (graceful degradation to the prior behaviour).
///
/// `env` is written into the INNER script as `$env:K='V'` rather than set on the
/// outer process: `Start-Process -Verb RunAs` goes through the elevation broker,
/// which builds the new process a fresh environment instead of inheriting ours.
/// Without this, a recovery retry's proxy/mirror variables would silently vanish
/// for exactly the elevated winget installs that most often need them.
///
/// Note: the elevated child runs in a separate high-integrity context, so it is
/// NOT part of our process tree — `cancel_command`/timeout can stop the waiting
/// outer shell but won't kill an in-flight elevated install.
#[cfg(windows)]
pub(crate) fn elevated_wrapper(
  file: &str,
  args: &[String],
  env: &HashMap<String, String>,
) -> Option<(String, Vec<String>)> {
  use std::sync::atomic::AtomicU64;
  static SEQ: AtomicU64 = AtomicU64::new(0);

  let uid = format!(
    "{}-{}",
    std::process::id(),
    SEQ.fetch_add(1, Ordering::Relaxed)
  );
  let dir = std::env::temp_dir();
  let inner_ps = dir.join(format!("agentpack-elev-{uid}.inner.ps1"));
  let outer_ps = dir.join(format!("agentpack-elev-{uid}.outer.ps1"));
  let out_txt = dir.join(format!("agentpack-elev-{uid}.out"));
  let code_txt = dir.join(format!("agentpack-elev-{uid}.code"));

  // PowerShell single-quoted literal: wrap in '…' and double any embedded quote.
  let psq = |s: &std::borrow::Cow<'_, str>| format!("'{}'", s.replace('\'', "''"));
  let innerp = inner_ps.to_string_lossy();
  let outerp = outer_ps.to_string_lossy();
  let outp = out_txt.to_string_lossy();
  let codep = code_txt.to_string_lossy();

  // Inner script (ELEVATED): run the target, capture stdout+stderr, record exit.
  let mut call = format!("& '{}'", file.replace('\'', "''"));
  for a in args {
    call.push_str(" '");
    call.push_str(&a.replace('\'', "''"));
    call.push('\'');
  }
  // Sorted so the generated script is deterministic (a HashMap's order isn't).
  let mut env_keys: Vec<&String> = env.keys().collect();
  env_keys.sort();
  let mut env_prelude = String::new();
  for key in env_keys {
    // Only plain env-var names reach the script — a crafted key would otherwise
    // be spliced into PowerShell source as code rather than as a variable name.
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
      continue;
    }
    let value = env[key].replace('\'', "''");
    env_prelude.push_str(&format!("$env:{key}='{value}'\r\n"));
  }
  let inner = format!(
    "$ErrorActionPreference='Continue'\r\n\
     {env_prelude}\
     {call} > {out} 2>&1\r\n\
     Set-Content -LiteralPath {code} -Value \"$LASTEXITCODE\" -Encoding ascii\r\n",
    out = psq(&outp),
    code = psq(&codep),
  );

  // Outer script (NON-elevated, streamed by us): elevate the inner via UAC, wait,
  // echo its captured output, then exit with the recorded code. A cancelled UAC
  // prompt throws from Start-Process → we exit with the ELEVATION_DECLINED code.
  let outer = format!(
    "$ErrorActionPreference='Stop'\r\n\
     try {{\r\n\
     \x20 $p = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',{inner} -Verb RunAs -WindowStyle Hidden -PassThru -Wait\r\n\
     }} catch {{\r\n\
     \x20 Remove-Item -LiteralPath {inner},{outer} -ErrorAction SilentlyContinue\r\n\
     \x20 exit {declined}\r\n\
     }}\r\n\
     if (Test-Path -LiteralPath {out}) {{ Get-Content -LiteralPath {out} }}\r\n\
     $rc = 0\r\n\
     if (Test-Path -LiteralPath {code}) {{\r\n\
     \x20 $v = (Get-Content -LiteralPath {code} -Raw).Trim()\r\n\
     \x20 if ($v -match '^-?\\d+$') {{ $rc = [int]$v }} elseif ($null -ne $p.ExitCode) {{ $rc = $p.ExitCode }}\r\n\
     }} elseif ($null -ne $p.ExitCode) {{ $rc = $p.ExitCode }}\r\n\
     Remove-Item -LiteralPath {out},{code},{inner},{outer} -ErrorAction SilentlyContinue\r\n\
     exit $rc\r\n",
    inner = psq(&innerp),
    outer = psq(&outerp),
    out = psq(&outp),
    code = psq(&codep),
    declined = ELEVATION_DECLINED,
  );

  std::fs::write(&inner_ps, inner).ok()?;
  std::fs::write(&outer_ps, outer).ok()?;
  Some((
    "powershell".to_string(),
    vec![
      "-NoProfile".into(),
      "-ExecutionPolicy".into(),
      "Bypass".into(),
      "-File".into(),
      outer_ps.to_string_lossy().into_owned(),
    ],
  ))
}

/// Run a CLI command, streaming each stdout/stderr line to the frontend through
/// a Tauri channel. Returns the exit code (-1 if unknown). `Err` when the process
/// cannot be spawned (binary not on PATH) or was killed by the timeout.
///
/// `op_id` (optional) registers the child so `cancel_command(op_id)` can kill it
/// mid-run; `timeout_secs` (optional) auto-kills a process that never exits.
/// `elevated` (Windows only) runs the command through a UAC-elevating wrapper so
/// machine-scope installs succeed instead of failing on permissions.
///
/// `env` (optional) overlays extra variables on THIS spawn only. It is how the
/// install-failure recovery ladder retries through a mirror or a proxy without
/// writing anything to the user's machine: `HTTPS_PROXY`, `HOMEBREW_API_DOMAIN`,
/// `UV_DEFAULT_INDEX` and friends live for one command and then are gone. Applied
/// after `apply_env`, so a retry's values win over the process-wide proxy.
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
  elevated: Option<bool>,
  env: Option<HashMap<String, String>>,
) -> Result<i32, String> {
  let env = env.unwrap_or_default();
  // Resolve the target up front. On Windows every command is wrapped in `cmd /c`,
  // so a missing binary would otherwise spawn `cmd` fine and merely exit non-zero
  // — hiding the real "not found" cause the frontend keys its hints off. Probing
  // PATH here makes all three platforms report the same clean error. (Done before
  // any elevation wrapping so we validate the real target, not `powershell`.)
  if !on_path(&file) {
    return Err(format!("command not found: {file}"));
  }

  // On Windows, an install flagged as needing admin is routed through a UAC
  // prompt so the machine-scope MSI actually installs. Falls back to running
  // unelevated if the temp scaffolding can't be written.
  #[cfg(windows)]
  let (file, args) = if elevated.unwrap_or(false) {
    elevated_wrapper(&file, &args, &env).unwrap_or((file, args))
  } else {
    (file, args)
  };
  #[cfg(not(windows))]
  let _ = elevated; // no elevation path off Windows

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
  // Last, so a per-run override (a recovery retry's mirror/proxy) beats both the
  // process-wide proxy from `apply_env` and the defaults just set above.
  for (key, value) in &env {
    cmd.env(key, value);
  }
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

/// Whether a human-facing app name refers to cc-switch. The name is NOT stable
/// across platforms and installers: Windows `DisplayName` reads "CC Switch", the
/// macOS bundle on disk is `CC Switch.app`, and older/brew builds use
/// `cc-switch.app`. Stripping non-alphanumerics and lowercasing collapses all of
/// them to `ccswitch`, so one predicate covers every spelling.
#[cfg(any(windows, target_os = "macos"))]
fn is_cc_switch_name(name: &str) -> bool {
  name
    .chars()
    .filter(|c| c.is_alphanumeric())
    .collect::<String>()
    .to_lowercase()
    .contains("ccswitch")
}

/// Resolve the cc-switch desktop app's launch target. winget (Windows) and
/// brew-cask (macOS) install it OUTSIDE PATH, so a plain `cc-switch` lookup
/// misses it — which is why detection and the DB-init launch used to fail on a
/// fresh install. Returns the path to spawn, or None when it isn't installed by
/// those managers (the caller then falls back to a PATH launch).
#[cfg(windows)]
fn cc_switch_exe() -> Option<std::path::PathBuf> {
  use std::path::PathBuf;
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
  use winreg::RegKey;

  // winget registers the app under an Uninstall key carrying InstallLocation and
  // usually DisplayIcon (→ the exe). The exe name is stable: cc-switch.exe.
  let roots = [
    (
      HKEY_CURRENT_USER,
      r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ),
    (
      HKEY_LOCAL_MACHINE,
      r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ),
    (
      HKEY_LOCAL_MACHINE,
      r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ),
  ];
  for (hive, sub) in roots {
    let Ok(uninstall) = RegKey::predef(hive).open_subkey(sub) else {
      continue;
    };
    for name in uninstall.enum_keys().flatten() {
      let Ok(entry) = uninstall.open_subkey(&name) else {
        continue;
      };
      let display: String = entry.get_value("DisplayName").unwrap_or_default();
      if !is_cc_switch_name(&display) {
        continue;
      }
      // Prefer DisplayIcon when it points at a real .exe; else InstallLocation.
      if let Ok(icon) = entry.get_value::<String, _>("DisplayIcon") {
        let raw = icon.trim().trim_matches('"');
        let exe = PathBuf::from(raw.split(',').next().unwrap_or(raw).trim());
        if exe
          .extension()
          .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
          && exe.exists()
        {
          return Some(exe);
        }
      }
      if let Ok(loc) = entry.get_value::<String, _>("InstallLocation") {
        let exe = PathBuf::from(loc).join("cc-switch.exe");
        if exe.exists() {
          return Some(exe);
        }
      }
    }
  }
  None
}

#[cfg(target_os = "macos")]
fn cc_switch_exe() -> Option<std::path::PathBuf> {
  // The bundle lands in /Applications (or ~/Applications) — but its FILE name is
  // not the CLI id: the shipped bundle is `CC Switch.app`, while older/brew
  // builds use `cc-switch.app`. Matching either literal path missed the real
  // install, so scan both dirs and match on the normalized stem instead. We hand
  // the .app to `open` rather than exec its inner binary.
  let mut roots = vec![std::path::PathBuf::from("/Applications")];
  if let Some(home) = dirs::home_dir() {
    roots.push(home.join("Applications"));
  }
  roots.into_iter().find_map(|root| {
    let mut hits: Vec<std::path::PathBuf> = std::fs::read_dir(root)
      .into_iter()
      .flatten()
      .flatten()
      .map(|e| e.path())
      .filter(|p| {
        p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app"))
          && p
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(is_cc_switch_name)
      })
      .collect();
    // read_dir order is filesystem-defined; sort so the pick is deterministic
    // when a machine somehow carries both spellings.
    hits.sort();
    hits.into_iter().next()
  })
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn cc_switch_exe() -> Option<std::path::PathBuf> {
  None
}

/// Whether a GUI app is installed, looked up by the name it ships under rather
/// than by a binary on PATH — desktop apps generally put nothing there.
///
/// macOS: an `.app` bundle in either Applications directory. Windows: an MSIX /
/// Store package, which is how both Claude and Codex ship there and which never
/// appears on PATH. Linux: no convention worth guessing at, so `false` — the
/// registry offers no automated Linux install for these anyway.
#[cfg(target_os = "macos")]
fn app_bundle_installed(name: &str) -> bool {
  let mut roots = vec![std::path::PathBuf::from("/Applications")];
  if let Some(home) = dirs::home_dir() {
    roots.push(home.join("Applications"));
  }
  roots.iter().any(|root| {
    std::fs::read_dir(root)
      .into_iter()
      .flatten()
      .flatten()
      .map(|e| e.path())
      .any(|p| {
        p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app"))
          && p
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case(name))
      })
  })
}

#[cfg(windows)]
fn app_bundle_installed(name: &str) -> bool {
  // `Get-AppxPackage` is the only reliable probe for a Store/MSIX install.
  // -NoProfile so a slow user profile can't stall startup detection.
  build_command(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      &format!("if (Get-AppxPackage -Name '{name}') {{ exit 0 }} else {{ exit 1 }}"),
    ],
  )
  .output()
  .map(|o| o.status.success())
  .unwrap_or(false)
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn app_bundle_installed(_name: &str) -> bool {
  false
}

/// Whether the cc-switch desktop app is actually installed right now. It's a GUI
/// app winget/brew install OFF PATH (and on macOS it ships no CLI shim at all),
/// so a PATH lookup alone under-reports it — hence the resolved install-location
/// check (which requires the real exe/bundle to exist on disk, under any of its
/// name spellings). We deliberately do NOT treat a leftover ~/.cc-switch config
/// dir as "installed": it survives an uninstall, so keying off it would report a
/// removed app as still present.
fn cc_switch_installed() -> bool {
  on_path("cc-switch") || cc_switch_exe().is_some()
}

/// The name cc-switch's process actually reports to the OS.
///
/// On macOS this is NOT the bundle name: `pgrep -x` matches the executable
/// inside `Contents/MacOS/`, which for `CC Switch.app` is whatever the app was
/// built as. Guessing "cc-switch" there silently under-reported a running app —
/// which made both the DB-write guardrail and the status badge lie. Read the
/// real name off the bundle, and fall back to the CLI id everywhere else.
pub(crate) fn cc_switch_process_name() -> String {
  #[cfg(target_os = "macos")]
  if let Some(bundle) = cc_switch_exe() {
    if let Ok(rd) = std::fs::read_dir(bundle.join("Contents/MacOS")) {
      if let Some(name) = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .find_map(|p| p.file_name().and_then(|n| n.to_str()).map(str::to_string))
      {
        return name;
      }
    }
  }
  "cc-switch".to_string()
}

/// Whether the cc-switch desktop app is running right now.
///
/// Wraps `is_process_running` with the resolved process name so callers don't
/// have to know about the macOS bundle quirk. This backs both the "editing is
/// blocked" guardrail and the status badge, so the two can never disagree.
#[tauri::command(async)]
pub fn cc_switch_running() -> bool {
  is_process_running(cc_switch_process_name())
}

/// Poll until `name` is gone, or the deadline passes. Returns whether it exited.
///
/// A quit request returns immediately while the app is still tearing down, so
/// without this the UI would refresh into a stale "still running" state and the
/// user would think the button did nothing.
fn wait_until_exited(name: &str, timeout: Duration) -> bool {
  let deadline = Instant::now() + timeout;
  while Instant::now() < deadline {
    if !is_process_running(name.to_string()) {
      return true;
    }
    std::thread::sleep(Duration::from_millis(150));
  }
  !is_process_running(name.to_string())
}

/// How long to let cc-switch shut down cleanly before escalating.
const QUIT_GRACE: Duration = Duration::from_millis(3500);
/// How long to wait after a forced kill before reporting failure.
const QUIT_FORCE_GRACE: Duration = Duration::from_millis(1500);

/// Ask the cc-switch desktop app to quit, and report whether it actually did.
///
/// Graceful first, forced only if that doesn't take: cc-switch owns the SQLite
/// database agentpack also writes, and a clean shutdown lets it close its own
/// connection and flush window state rather than leaving a WAL behind.
///
/// Returns `false` (not an error) when the app outlives both attempts — that's a
/// result the UI can explain, not a crash.
#[tauri::command(async)]
pub fn quit_cc_switch() -> Result<bool, String> {
  let name = cc_switch_process_name();
  if !is_process_running(name.clone()) {
    return Ok(true); // already gone — nothing to do
  }

  // ── Graceful ──
  #[cfg(target_os = "macos")]
  {
    // AppleScript's `quit` is the real "Cmd+Q": the app runs its own shutdown
    // path. Addressed by bundle name, which is what AppleScript understands.
    if let Some(app_name) = cc_switch_exe()
      .as_deref()
      .and_then(std::path::Path::file_stem)
      .and_then(|s| s.to_str())
    {
      let script = format!("tell application \"{}\" to quit", app_name.replace('"', ""));
      let mut c = Command::new("osascript");
      c.args(["-e", &script]);
      apply_env(&mut c);
      let _ = c.output();
    }
  }
  #[cfg(windows)]
  {
    // Without /F, taskkill posts WM_CLOSE and the app shuts down normally.
    let mut c = Command::new("taskkill");
    c.args(["/IM", &format!("{name}.exe")]);
    apply_no_window(&mut c);
    apply_env(&mut c);
    let _ = c.output();
  }
  #[cfg(all(not(windows), not(target_os = "macos")))]
  {
    let mut c = Command::new("pkill");
    c.args(["-x", &name]);
    apply_env(&mut c);
    let _ = c.output();
  }
  // macOS fallback: an app that ignores AppleScript (or isn't scriptable) still
  // answers SIGTERM, which Cocoa turns into a normal terminate.
  #[cfg(target_os = "macos")]
  if is_process_running(name.clone()) {
    let mut c = Command::new("pkill");
    c.args(["-x", &name]);
    apply_env(&mut c);
    let _ = c.output();
  }

  if wait_until_exited(&name, QUIT_GRACE) {
    return Ok(true);
  }

  // ── Forced ──
  #[cfg(windows)]
  {
    let mut c = Command::new("taskkill");
    c.args(["/IM", &format!("{name}.exe"), "/T", "/F"]);
    apply_no_window(&mut c);
    apply_env(&mut c);
    let _ = c.output();
  }
  #[cfg(not(windows))]
  {
    let mut c = Command::new("pkill");
    c.args(["-9", "-x", &name]);
    apply_env(&mut c);
    let _ = c.output();
  }
  Ok(wait_until_exited(&name, QUIT_FORCE_GRACE))
}

/// Launch a desktop app by the name it is installed under — the "open Claude"
/// button at the end of a run.
///
/// Deliberately by name rather than by resolved path, because the two platforms
/// disagree about what a path even is here: on macOS `open -a` searches both
/// Applications directories itself, and on Windows an MSIX app has no
/// launchable exe path at all, only a Start-menu AppID. Codex ships no Windows
/// build, so `Get-StartApps` covers everything that can actually be launched.
///
/// Waits for the *launcher* — not the app. `open` and `Start-Process` both hand
/// off to the OS and exit immediately, so their status is available right away
/// and is the only thing that reports "no such app": `open -a` on a name that
/// isn't installed exits 1 (verified), and spawning without waiting would turn
/// that into a button that silently does nothing. The Linux fallback execs the
/// binary itself, which never returns, so that one stays detached.
#[tauri::command(async)]
pub fn launch_app(app_bundle: String) -> Result<(), String> {
  if app_bundle.trim().is_empty() {
    return Err("no app name given".into());
  }
  #[cfg(target_os = "macos")]
  let mut cmd = {
    let mut c = Command::new("open");
    // No `-n`: a second instance of an editor-like app is never what "open
    // Claude" means — focus the window that's already there.
    c.arg("-a").arg(&app_bundle);
    c
  };
  #[cfg(windows)]
  let mut cmd = {
    // Single quotes are the escape inside a PowerShell single-quoted string.
    let safe = app_bundle.replace('\'', "''");
    build_command(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        &format!(
          "$a = (Get-StartApps | Where-Object {{ $_.Name -eq '{safe}' }} | Select-Object -First 1).AppID; \
           if ($a) {{ Start-Process \"shell:AppsFolder\\$a\" }} else {{ exit 1 }}"
        ),
      ],
    )
  };
  #[cfg(all(not(windows), not(target_os = "macos")))]
  let mut cmd = Command::new(&app_bundle);

  apply_no_window(&mut cmd);
  apply_env(&mut cmd);
  cmd
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());

  #[cfg(any(windows, target_os = "macos"))]
  {
    let status = cmd
      .status()
      .map_err(|e| format!("could not open {app_bundle}: {e}"))?;
    if !status.success() {
      return Err(format!("could not open {app_bundle} — is it installed?"));
    }
    Ok(())
  }
  #[cfg(all(not(windows), not(target_os = "macos")))]
  {
    cmd
      .spawn()
      .map(|_| ())
      .map_err(|e| format!("could not open {app_bundle}: {e}"))
  }
}

/// Launch the cc-switch desktop app so it self-creates its SQLite database on
/// first run (`run_command` can't be reused: it blocks until exit, which a GUI
/// app never does). Resolves the real install path — winget/brew put it off
/// PATH — and spawns it directly; falls back to a PATH launch when unresolved.
/// stdio is detached so no pipes are held open.
///
/// Already running? On macOS it is brought to the front instead of started
/// again: `open -n` forces a SECOND instance, and two cc-switch processes
/// writing one SQLite file is exactly what the running-guardrail exists to
/// prevent. Elsewhere the app's own single-instance handling takes over.
#[tauri::command(async)]
pub fn launch_cc_switch() -> Result<(), String> {
  let target = cc_switch_exe();
  #[cfg(target_os = "macos")]
  let already_running = is_process_running(cc_switch_process_name());
  let mut cmd = match &target {
    // macOS ships a .app bundle → hand it to `open`.
    #[cfg(target_os = "macos")]
    Some(app) => {
      let mut c = Command::new("open");
      // `-n` only when nothing is running; otherwise plain `open` focuses the
      // existing window, which is what "open cc-switch" should mean.
      if !already_running {
        c.arg("-n");
      }
      c.arg(app);
      c
    }
    // Windows: spawn the resolved .exe directly (no `cmd /c` → no PATHEXT or
    // quoting hazards with a spaced install path like "…\CC Switch\").
    #[cfg(not(target_os = "macos"))]
    Some(exe) => Command::new(exe),
    // Unresolved (Linux, or an unusual install) → try the bare name on PATH.
    None => Command::new("cc-switch"),
  };
  apply_no_window(&mut cmd);
  apply_env(&mut cmd);
  cmd
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("could not launch cc-switch: {e}"))
}

/// Spawn a binary detached (stdio null) so a long-running service outlives this
/// call. `run_command` can't be reused: it blocks until exit, which a service
/// never does. Routed through `build_command` so npm `.cmd` shims work on
/// Windows.
fn spawn_detached(bin: &str) -> Result<(), String> {
  if !on_path(bin) {
    return Err(format!("command not found: {bin}"));
  }
  let mut cmd = build_command(bin, std::iter::empty::<&str>());
  cmd
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("could not launch {bin}: {e}"))
}

/// Kill every process with this base name, children included (`/T` / no flag —
/// npm shims put a node wrapper between us and the real binary). Idempotent:
/// "no such process" (taskkill 128, pkill 1) is a successful no-op.
fn kill_by_name(name: &str) -> Result<(), String> {
  let mut c = if cfg!(windows) {
    let mut c = Command::new("taskkill");
    c.args(["/IM", &format!("{name}.exe"), "/F", "/T"]);
    c
  } else {
    let mut c = Command::new("pkill");
    c.args(["-x", name]);
    c
  };
  apply_no_window(&mut c);
  apply_env(&mut c);
  match c.output() {
    Ok(o) if o.status.success() => Ok(()),
    Ok(o) => {
      let no_match = o.status.code() == Some(if cfg!(windows) { 128 } else { 1 });
      if no_match {
        Ok(())
      } else {
        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
        Err(if err.is_empty() {
          format!("could not stop {name}")
        } else {
          err
        })
      }
    }
    Err(e) => Err(format!("could not stop {name}: {e}")),
  }
}

/// Start the cc-connect bridge as a detached background process. `cc-connect
/// daemon` only exists on Linux (systemd) / macOS (launchd), so the app manages
/// the plain foreground process the same way on every OS; while running it
/// serves the web management UI.
#[tauri::command(async)]
pub fn start_cc_connect() -> Result<(), String> {
  spawn_detached("cc-connect")
}

/// Stop every running cc-connect process (idempotent). Kills by image name AND
/// by the ports the service listens on: npm installs run the real work under a
/// `node` wrapper whose image name is not `cc-connect`, so a name-only kill
/// silently leaves the service alive.
#[tauri::command(async)]
pub fn stop_cc_connect(ports: Vec<u16>) -> Result<(), String> {
  kill_by_name("cc-connect")?;
  for port in ports {
    kill_by_port(port);
  }
  Ok(())
}

/// Whether something is listening on 127.0.0.1:`port` — the reliable "is the
/// cc-connect service up" signal regardless of what its process image is named.
#[tauri::command(async)]
pub fn probe_port(port: u16) -> bool {
  let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
  std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Result of an MCP http-endpoint reachability probe.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostProbe {
  reachable: bool,
  latency_ms: Option<u64>,
}

/// TCP-reachability probe for an arbitrary `host:port`, with connect latency.
/// Generalizes `probe_port` (localhost only) so the MCP health check can test a
/// remote http MCP endpoint. Resolves the host via DNS (blocking — hence `async`,
/// so it runs on a worker thread) then times a `connect_timeout`. An unresolvable
/// host or a refused/timed-out connection returns `reachable: false` rather than
/// erroring, so the caller renders one clean "unreachable" outcome.
#[tauri::command(async)]
pub fn probe_host(host: String, port: u16, timeout_ms: Option<u64>) -> HostProbe {
  use std::net::ToSocketAddrs;
  let timeout = Duration::from_millis(timeout_ms.unwrap_or(1200));
  let start = Instant::now();
  let addrs = match (host.as_str(), port).to_socket_addrs() {
    Ok(a) => a,
    Err(_) => {
      return HostProbe {
        reachable: false,
        latency_ms: None,
      }
    }
  };
  for addr in addrs {
    if std::net::TcpStream::connect_timeout(&addr, timeout).is_ok() {
      return HostProbe {
        reachable: true,
        latency_ms: Some(start.elapsed().as_millis() as u64),
      };
    }
  }
  HostProbe {
    reachable: false,
    latency_ms: None,
  }
}

/// Kill the process tree(s) listening on a local TCP port (best-effort no-op
/// when nothing listens). Guards against killing PID 0 / ourselves.
fn kill_by_port(port: u16) {
  let me = std::process::id();
  for pid in pids_listening_on(port) {
    if pid == 0 || pid == me {
      continue;
    }
    if cfg!(windows) {
      kill_tree(pid);
    } else {
      // The listener isn't necessarily a group leader (unlike run_command
      // children), so signal the single PID rather than a process group.
      let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
    }
  }
}

#[cfg(windows)]
fn pids_listening_on(port: u16) -> Vec<u32> {
  let mut c = Command::new("netstat");
  c.args(["-ano", "-p", "tcp"]);
  apply_no_window(&mut c);
  let Ok(o) = c.output() else { return vec![] };
  let needle = format!(":{port}");
  String::from_utf8_lossy(&o.stdout)
    .lines()
    .filter_map(|l| {
      let cols: Vec<&str> = l.split_whitespace().collect();
      // Proto Local Foreign State PID
      if cols.len() >= 5 && cols[3].eq_ignore_ascii_case("LISTENING") && cols[1].ends_with(&needle)
      {
        cols[4].parse().ok()
      } else {
        None
      }
    })
    .collect()
}

#[cfg(not(windows))]
fn pids_listening_on(port: u16) -> Vec<u32> {
  let mut c = Command::new("lsof");
  c.args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"]);
  apply_env(&mut c);
  let Ok(o) = c.output() else { return vec![] };
  String::from_utf8_lossy(&o.stdout)
    .lines()
    .filter_map(|l| l.trim().parse().ok())
    .collect()
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
pub(crate) fn on_path(bin: &str) -> bool {
  let finder = if cfg!(windows) { "where" } else { "which" };
  let mut c = Command::new(finder);
  c.arg(bin);
  apply_no_window(&mut c);
  apply_env(&mut c);
  c.output().map(|o| o.status.success()).unwrap_or(false)
}

/// Whether a command resolves on PATH (thin `#[tauri::command]` wrapper over the
/// private `on_path`). Used by the MCP health check to verify a stdio server's
/// executable (npx / uvx / python / an absolute path) exists before trusting the
/// config — the lightweight equivalent of cc-switch's `validate_mcp_command`.
#[tauri::command(async)]
pub fn command_on_path(command: String) -> bool {
  on_path(&command)
}

/// Detect a CLI. GUI tools (cc-switch) are never executed — PATH + resolved
/// install location only, so a winget/brew install that isn't on PATH is still
/// detected before its first launch, and a removed one stops being detected even
/// if its ~/.cc-switch config dir lingers.
#[tauri::command(async)]
pub fn detect_cli(bin: String, gui: bool, app_bundle: Option<String>) -> DetectionResult {
  if gui {
    let installed = if bin == "cc-switch" {
      cc_switch_installed()
    } else {
      // A desktop app is normally off PATH entirely, so the PATH probe is only
      // the cheap first guess — `app_bundle` is what actually finds Claude.app
      // or Codex.app. Kept as data on the tool rather than another `bin == …`
      // branch, so adding an app is a registry edit and not a Rust one.
      on_path(&bin) || app_bundle.as_deref().is_some_and(app_bundle_installed)
    };
    return DetectionResult {
      installed,
      version: None,
    };
  }
  match build_command(&bin, ["--version"]).output() {
    Ok(o) if o.status.success() => {
      let raw = if o.stdout.is_empty() {
        &o.stderr
      } else {
        &o.stdout
      };
      let v = String::from_utf8_lossy(raw);
      DetectionResult {
        installed: true,
        version: v
          .lines()
          .next()
          .map(|s| s.trim().to_string())
          .filter(|s| !s.is_empty()),
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
      v.lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    }
    _ => None,
  }
}

/// Whether npm's global prefix currently owns `package` (`npm ls -g --depth=0`).
///
/// Used to pick the right UPGRADE command for an already-installed CLI: an
/// npm-owned CLI upgrades in place via `npm i -g <pkg>@latest`, but a CLI that
/// was put on PATH by the native installer (the no-Node path) is NOT known to
/// npm — running `npm i -g` on it would drop a *second*, shadowing copy instead
/// of upgrading the real one. So a false result means "upgrade by re-running the
/// native installer". Returns false when npm is absent or doesn't list the
/// package (both mean "not an npm-managed global install").
#[tauri::command(async)]
pub fn npm_owns(package: String) -> bool {
  build_command("npm", ["ls", "-g", "--depth=0", &package])
    .output()
    .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains(&package))
    .unwrap_or(false)
}

/// Whether the OS package manager (`winget` on Windows, `brew` on macOS) owns an
/// installed package matching `id`.
///
/// Used to decide whether a runtime can be UPDATED / REINSTALLED in place: only a
/// winget/brew-managed install can be. A runtime put on PATH some other way — the
/// vendor's installer (nodejs.org / python.org), a version manager (nvm/fnm), or
/// scoop / a portable unzip — is invisible to winget/brew, so `winget upgrade`
/// fails (0x8A150014) and `winget install` would drop a shadowing second copy.
/// A `false` result tells the UI to point at the tool's download page instead.
///
/// `id` is matched as a SUBSTRING (winget `--id` without `-e`), so a family
/// prefix like `Python.Python.3` matches whatever minor is installed
/// (`Python.Python.3.14`) — winget ships Python as a separate package per minor,
/// so an exact match on a pinned `…3.13` would wrongly report a winget-installed
/// 3.14 as unmanaged. Ownership keys off the EXIT CODE only: `--id` with no match
/// exits 0x8A150014, and winget truncates its printed table (so the id may not
/// even appear in full) — parsing the text would be both unnecessary and fragile.
///
/// Returns false when the manager is absent or lists nothing — both mean "not
/// managed by it", the safe default that only errs toward showing a link.
#[tauri::command(async)]
pub fn pkg_manager_owns(manager: String, id: String) -> bool {
  match manager.as_str() {
    "winget" => build_command(
      "winget",
      ["list", "--id", &id, "--accept-source-agreements"],
    )
    .output()
    .map(|o| o.status.success())
    .unwrap_or(false),
    // `brew list --versions <formula>` exits 0 only when the formula is installed.
    "brew" => build_command("brew", ["list", "--versions", &id])
      .output()
      .map(|o| o.status.success())
      .unwrap_or(false),
    _ => false,
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
    assert!(!detect_cli("definitely-not-a-real-bin-xyz".into(), false, None).installed);
  }

  #[test]
  fn command_on_path_finds_a_real_binary() {
    let bin = if cfg!(windows) { "cmd" } else { "sh" };
    assert!(command_on_path(bin.into()));
  }

  #[test]
  fn command_on_path_rejects_a_missing_binary() {
    assert!(!command_on_path("definitely-not-a-real-bin-xyz".into()));
  }

  #[test]
  fn probe_host_refused_localhost_is_false() {
    // A closed local port refuses the connection immediately — deterministic and
    // offline (no DNS, no external network, which some environments hijack). Port
    // 1 is effectively never listening, so this must report reachable:false with
    // no latency and without hanging or panicking.
    let r = probe_host("127.0.0.1".into(), 1, Some(300));
    assert!(!r.reachable);
    assert!(r.latency_ms.is_none());
  }

  #[test]
  fn spawn_detached_rejects_missing_binary() {
    let err = spawn_detached("definitely-not-a-real-bin-xyz").unwrap_err();
    assert!(err.contains("command not found"), "unexpected error: {err}");
  }

  #[test]
  fn kill_by_name_is_idempotent_when_nothing_matches() {
    assert_eq!(kill_by_name("definitely-not-a-real-proc-xyz"), Ok(()));
  }

  #[test]
  fn detect_cc_switch_gui_is_infallible() {
    // The GUI detection path walks PATH and the Windows Uninstall registry —
    // neither guaranteed to hold cc-switch on the test machine. It must return a
    // bool without panicking regardless.
    let _ = detect_cli("cc-switch".into(), true, None).installed;
  }

  #[test]
  fn detect_by_app_bundle_is_infallible_and_needs_no_path_entry() {
    // A desktop app puts nothing on PATH, so this walks the Applications dirs
    // (or the Store package list on Windows). Whether it's installed on the test
    // machine is not the point — it must answer without panicking.
    let _ = detect_cli("claude-desktop".into(), true, Some("Claude".into())).installed;
    // A bundle nobody ships must come back false rather than matching loosely.
    assert!(
      !detect_cli(
        "definitely-not-installed-xyz".into(),
        true,
        Some("DefinitelyNotInstalledXyz".into())
      )
      .installed
    );
  }

  #[test]
  fn launch_app_rejects_an_empty_name() {
    // An empty `appBundle` would make `open -a ""` open something arbitrary.
    assert!(launch_app(String::new()).is_err());
    assert!(launch_app("   ".into()).is_err());
  }

  #[cfg(any(windows, target_os = "macos"))]
  #[test]
  fn launch_app_reports_a_missing_app_instead_of_pretending() {
    // The whole reason this waits on the launcher: `open -a` exits 1 for a name
    // that isn't installed, and a bare spawn() would have discarded that and
    // left the caller showing a button that does nothing.
    assert!(launch_app("DefinitelyNotAnInstalledAppXyz".into()).is_err());
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn app_bundle_match_is_exact_not_a_prefix() {
    // `Claude Code URL Handler.app` is a real bundle the Claude Code CLI
    // installs, and it is NOT the desktop app. A prefix or contains match would
    // report Claude Desktop as installed on any machine with the CLI.
    assert!(!app_bundle_installed("Claude Code"));
    assert!(!app_bundle_installed("Cla"));
  }

  #[cfg(any(windows, target_os = "macos"))]
  #[test]
  fn cc_switch_name_matches_every_spelling() {
    // The shipped macOS bundle is "CC Switch.app" and the Windows DisplayName is
    // "CC Switch", but the CLI id is "cc-switch". Matching the id literally was
    // the detection bug: an installed app reported as missing.
    for name in [
      "CC Switch",
      "cc-switch",
      "CC-Switch",
      "ccswitch",
      "CC Switch 1.2.3",
    ] {
      assert!(is_cc_switch_name(name), "should match: {name}");
    }
    for name in ["Switch Control", "CC Cleaner", ""] {
      assert!(!is_cc_switch_name(name), "should not match: {name}");
    }
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn cc_switch_exe_resolves_a_bundle_when_installed() {
    // Only asserts the shape: when the resolver finds something it must be an
    // existing .app bundle whose name really is cc-switch. Machines without it
    // installed simply skip — the resolver must not panic there either.
    if let Some(app) = cc_switch_exe() {
      assert!(
        app.exists(),
        "resolved a bundle that does not exist: {app:?}"
      );
      assert_eq!(app.extension().unwrap(), "app");
      assert!(is_cc_switch_name(
        app.file_stem().unwrap().to_str().unwrap()
      ));
    }
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
      None,
      None,
    );
    let err = res.expect_err("missing binary must be an error");
    assert!(err.contains("command not found"), "got: {err}");
  }

  #[test]
  fn npm_owns_is_false_for_a_nonexistent_package() {
    // Whether or not npm is on PATH, a package that was never installed globally
    // must report as not-owned (absent npm → spawn fails → false; present npm →
    // `ls -g` exits non-zero → false). Guards the "fall back to native" default.
    assert!(!npm_owns("definitely-not-a-real-package-xyz-123".into()));
  }

  #[test]
  fn pkg_manager_owns_is_false_for_unknown_manager_or_missing_package() {
    // An unrecognized manager never claims ownership.
    assert!(!pkg_manager_owns("apt".into(), "OpenJS.NodeJS.LTS".into()));
    // A package the OS manager never installed reports not-owned regardless of
    // whether winget/brew is even present (absent → spawn fails → false; present
    // → no matching row / non-zero exit → false). Drives the "show the download
    // link" fallback, so erring toward false is the safe default.
    assert!(!pkg_manager_owns(
      "winget".into(),
      "Definitely.Not.A.Real.Package.Xyz123".into()
    ));
    assert!(!pkg_manager_owns(
      "brew".into(),
      "definitely-not-a-real-formula-xyz-123".into()
    ));
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
    let res = run_command(
      file.into(),
      args,
      channel,
      Some("test-timeout".into()),
      Some(1),
      None,
      None,
    );
    assert_eq!(res, Err(TIMEOUT_ERR.to_string()));
    // The child must be deregistered once the call returns.
    assert!(running_children()
      .lock()
      .map(|m| !m.contains_key("test-timeout"))
      .unwrap_or(true));
  }

  #[cfg(windows)]
  #[test]
  fn elevated_wrapper_routes_through_powershell_and_embeds_the_target() {
    // The wrapper must launch a (non-elevated) powershell -File pointing at a
    // generated outer script, and that outer script must elevate an inner script
    // that actually invokes the real target with its args.
    let (file, args) = elevated_wrapper(
      "winget",
      &["install".into(), "--id".into(), "OpenJS.NodeJS.LTS".into()],
    )
    .expect("wrapper should be built");
    assert_eq!(file, "powershell");
    let outer_path = args.last().expect("outer script path");
    assert_eq!(args.first().map(String::as_str), Some("-NoProfile"));
    assert!(args.iter().any(|a| a == "-File"));

    let inner_path = outer_path.replace(".outer.ps1", ".inner.ps1");
    let inner = std::fs::read_to_string(&inner_path).expect("inner script written");
    assert!(
      inner.contains("& 'winget'"),
      "inner missing target: {inner}"
    );
    assert!(
      inner.contains("'OpenJS.NodeJS.LTS'"),
      "inner missing arg: {inner}"
    );
    assert!(
      inner.contains("$LASTEXITCODE"),
      "inner must record exit code"
    );

    let outer = std::fs::read_to_string(outer_path).expect("outer script written");
    assert!(outer.contains("-Verb RunAs"), "outer must elevate: {outer}");
    assert!(
      outer.contains(&ELEVATION_DECLINED.to_string()),
      "outer must map a cancelled UAC prompt to the sentinel"
    );

    // Clean up the scaffolding the wrapper wrote (it self-deletes only when run).
    let _ = std::fs::remove_file(&inner_path);
    let _ = std::fs::remove_file(outer_path);
  }

  #[cfg(windows)]
  #[test]
  fn elevated_wrapper_escapes_single_quotes_in_args() {
    // A single quote in an arg must be doubled so it can't break out of the
    // PowerShell single-quoted literal (defensive; our real args never contain one).
    let (_file, args) = elevated_wrapper("winget", &["a'b".into()]).expect("wrapper");
    let outer_path = args.last().unwrap();
    let inner_path = outer_path.replace(".outer.ps1", ".inner.ps1");
    let inner = std::fs::read_to_string(&inner_path).expect("inner written");
    assert!(
      inner.contains("'a''b'"),
      "single quote not doubled: {inner}"
    );
    let _ = std::fs::remove_file(&inner_path);
    let _ = std::fs::remove_file(outer_path);
  }

  #[test]
  fn augmented_path_preserves_base_entries() {
    let aug = augmented_path();
    assert!(!aug.is_empty());
    let aug_dirs: Vec<_> = std::env::split_paths(&aug).collect();
    if let Some(base) = std::env::var_os("PATH") {
      for d in std::env::split_paths(&base) {
        if !d.as_os_str().is_empty() {
          assert!(
            aug_dirs.contains(&d),
            "augmented PATH dropped base dir {d:?}"
          );
        }
      }
    }
  }
}
