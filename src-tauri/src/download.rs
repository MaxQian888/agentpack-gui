//! Direct install from a publisher's own release — the route that works when the
//! platform's own package manager can't get there, or isn't there at all.
//!
//! Two publishers are understood: GitHub Releases (resolved through the API and
//! matched by asset name) and a vendor's Squirrel-style `RELEASES.json`, which
//! names one current build. Claude for macOS uses the latter, because Anthropic's
//! *documented* download links sit behind a bot check that 403s any non-browser
//! client — this one included — so they can't be fetched here at all.
//!
//! This exists because winget is a dead end on a restricted network: its
//! downloader goes through WinINet, which reads the *system* proxy and ignores
//! `HTTPS_PROXY`, so there is no per-run variable that makes a winget install
//! succeed. Fetching the same installer ourselves — through `ureq`, which honours
//! the proxy agentpack applied, and optionally through a GitHub mirror prefix —
//! turns "no automated path" into a working one. It is also the *only* automated
//! path cc-switch has ever had on Linux.
//!
//! Asset selection deliberately stays on the TS side (`lib/agentpack/registry.ts`
//! owns the catalog); Rust resolves the release, downloads bytes, and knows how
//! to run each package format.

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::ipc::Channel;

use crate::exec::build_command;

/// Cap on a downloaded asset. Desktop installers run 5-150 MB; anything past
/// this is a redirect to something we didn't mean to fetch.
const MAX_ASSET_BYTES: u64 = 500 * 1024 * 1024;

/// GitHub rejects API requests without one, and a recognisable agent makes our
/// traffic explicable in anyone's proxy logs.
const USER_AGENT: &str = "agentpack-gui";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

// ── Release resolution ───────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
  pub name: String,
  pub url: String,
  pub size: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
  /// Git tag of the release, e.g. `v3.4.1`.
  pub tag: String,
  pub assets: Vec<ReleaseAsset>,
}

fn agent() -> ureq::Agent {
  let mut builder = ureq::AgentBuilder::new()
    .timeout_connect(CONNECT_TIMEOUT)
    .timeout_read(READ_TIMEOUT)
    .user_agent(USER_AGENT);
  if let Some(proxy) = crate::net::proxy_from_env() {
    builder = builder.proxy(proxy);
  }
  builder.build()
}

/// Prepend a mirror prefix to a full URL, the same way `skills::codeload_url`
/// does — `https://gh-proxy.com/` + `https://github.com/…`. An empty or absent
/// prefix means direct.
fn mirrored(url: &str, mirror_prefix: Option<&str>) -> String {
  match mirror_prefix.map(str::trim).filter(|p| !p.is_empty()) {
    Some(prefix) => format!("{prefix}{url}"),
    None => url.to_string(),
  }
}

/// Reject anything that isn't a plain `owner/name`, so a crafted value can't
/// steer the API request at another host or path.
fn validate_repo(repo: &str) -> Result<(), String> {
  let mut parts = repo.split('/');
  let ok = matches!((parts.next(), parts.next(), parts.next()), (Some(o), Some(n), None)
    if !o.is_empty()
      && !n.is_empty()
      && o.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
      && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.'));
  if ok {
    Ok(())
  } else {
    Err(format!("invalid repo: {repo}"))
  }
}

/// Pull `tag_name` + the asset list out of a GitHub release payload. Kept
/// separate from the request so it can be tested against a recorded body.
fn parse_release(body: &str) -> Result<ReleaseInfo, String> {
  let value: serde_json::Value =
    serde_json::from_str(body).map_err(|e| format!("bad release JSON: {e}"))?;
  let tag = value
    .get("tag_name")
    .and_then(|v| v.as_str())
    .ok_or("release has no tag_name")?
    .to_string();
  let assets = value
    .get("assets")
    .and_then(|v| v.as_array())
    .map(|list| {
      list
        .iter()
        .filter_map(|a| {
          Some(ReleaseAsset {
            name: a.get("name")?.as_str()?.to_string(),
            url: a.get("browser_download_url")?.as_str()?.to_string(),
            size: a.get("size").and_then(|s| s.as_u64()).unwrap_or(0),
          })
        })
        .collect()
    })
    .unwrap_or_default();
  Ok(ReleaseInfo { tag, assets })
}

/// Latest published release of `repo`. Resolved live rather than hard-coding a
/// download URL, so an upstream rename of the installer file doesn't silently
/// break the fallback.
#[tauri::command(async)]
pub fn github_latest_release(
  repo: String,
  mirror_prefix: Option<String>,
) -> Result<ReleaseInfo, String> {
  validate_repo(&repo)?;
  let url = mirrored(
    &format!("https://api.github.com/repos/{repo}/releases/latest"),
    mirror_prefix.as_deref(),
  );
  let body = agent()
    .get(&url)
    .set("Accept", "application/vnd.github+json")
    .call()
    .map_err(|e| format!("release lookup failed: {e}"))?
    .into_string()
    .map_err(|e| format!("release lookup failed: {e}"))?;
  parse_release(&body)
}

/// Pull the current build out of a Squirrel-style `RELEASES.json`.
///
/// Kept separate from the request so it can be tested against a recorded body,
/// exactly like `parse_release`. The entry whose `version` equals
/// `currentRelease` wins rather than the first one in the list: the array is a
/// version history, and its order is the publisher's business, not ours.
fn parse_manifest(body: &str) -> Result<ReleaseInfo, String> {
  let value: serde_json::Value =
    serde_json::from_str(body).map_err(|e| format!("bad manifest JSON: {e}"))?;
  let current = value
    .get("currentRelease")
    .and_then(|v| v.as_str())
    .ok_or("manifest has no currentRelease")?;
  let url = value
    .get("releases")
    .and_then(|v| v.as_array())
    .and_then(|list| {
      list
        .iter()
        .find(|r| r.get("version").and_then(|v| v.as_str()) == Some(current))
        .or_else(|| list.first())
    })
    .and_then(|r| r.get("updateTo"))
    .and_then(|u| u.get("url"))
    .and_then(|v| v.as_str())
    .ok_or("manifest has no download URL for the current release")?;
  if !url.starts_with("https://") {
    return Err("manifest download URL is not https".into());
  }
  // The last path segment is the real file name, and its extension is what
  // decides which installer routine runs — so a manifest that points at
  // something unnamed is an error here rather than a confusing failure later.
  let name = url
    .rsplit('/')
    .next()
    .map(|s| s.split(['?', '#']).next().unwrap_or(s))
    .filter(|s| !s.is_empty())
    .ok_or("manifest download URL has no file name")?;
  Ok(ReleaseInfo {
    tag: current.to_string(),
    assets: vec![ReleaseAsset {
      name: name.to_string(),
      url: url.to_string(),
      // Not published in the manifest; the download reports real progress from
      // Content-Length anyway, and 0 already means "indeterminate" here.
      size: 0,
    }],
  })
}

/// Resolve a vendor's own release manifest — the route for desktop apps that
/// publish through Squirrel rather than GitHub Releases (Claude for macOS).
///
/// Returns the same `ReleaseInfo` shape as `github_latest_release`, with the one
/// build it names as the single asset, so the download and install half of the
/// caller doesn't have to care which kind of source it came from.
#[tauri::command(async)]
pub fn manifest_latest_release(url: String) -> Result<ReleaseInfo, String> {
  if !url.starts_with("https://") {
    return Err("only https:// manifest URLs are allowed".into());
  }
  let body = agent()
    .get(&url)
    .set("Accept", "application/json")
    .call()
    .map_err(|e| format!("manifest lookup failed: {e}"))?
    .into_string()
    .map_err(|e| format!("manifest lookup failed: {e}"))?;
  parse_manifest(&body)
}

// ── Download ─────────────────────────────────────────────────────────────────

/// Streamed so a 100 MB installer shows a moving bar instead of a frozen step.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
  pub received: u64,
  /// `Content-Length` when the server sent one, else 0 (indeterminate).
  pub total: u64,
}

/// Where downloaded installers land. Under the temp dir, not the home dir: these
/// are disposable, often large, and the OS sweeps the directory for us.
fn download_dir() -> PathBuf {
  std::env::temp_dir().join("agentpack-downloads")
}

/// Keep only the file name of an untrusted asset name, so a `../` in it can't
/// place the download outside the temp directory.
fn safe_file_name(name: &str) -> Result<String, String> {
  let base = Path::new(name)
    .file_name()
    .and_then(|n| n.to_str())
    .ok_or("asset has no usable file name")?;
  if base.is_empty() || base == "." || base == ".." {
    return Err("asset has no usable file name".into());
  }
  Ok(base.to_string())
}

/// Fetch a release asset to a local file, reporting progress, and return its
/// path. `mirror_prefix` routes the download through a GitHub mirror; the proxy
/// (if any) is applied automatically by `agent()`.
#[tauri::command(async)]
pub fn download_release_asset(
  url: String,
  file_name: String,
  mirror_prefix: Option<String>,
  on_progress: Channel<DownloadProgress>,
) -> Result<String, String> {
  if !url.starts_with("https://") {
    return Err("only https:// URLs are allowed".into());
  }
  let name = safe_file_name(&file_name)?;
  let dir = download_dir();
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let dest = dir.join(&name);

  let response = agent()
    .get(&mirrored(&url, mirror_prefix.as_deref()))
    .call()
    .map_err(|e| format!("download failed: {e}"))?;
  let total = response
    .header("Content-Length")
    .and_then(|v| v.parse::<u64>().ok())
    .unwrap_or(0);

  // Write to a partial file and rename at the end, so an interrupted download
  // can never be mistaken for a complete installer on the next attempt.
  let partial = dir.join(format!("{name}.partial"));
  let mut file = fs::File::create(&partial).map_err(|e| e.to_string())?;
  let mut reader = response.into_reader().take(MAX_ASSET_BYTES);
  let mut buf = vec![0u8; 64 * 1024];
  let mut received: u64 = 0;
  let mut last_reported: u64 = 0;
  loop {
    let n = match reader.read(&mut buf) {
      Ok(0) => break,
      Ok(n) => n,
      Err(e) => {
        let _ = fs::remove_file(&partial);
        return Err(format!("download failed: {e}"));
      }
    };
    if let Err(e) = file.write_all(&buf[..n]) {
      let _ = fs::remove_file(&partial);
      return Err(format!("write failed: {e}"));
    }
    received += n as u64;
    // Throttle to ~1 message per 256 KB: a channel event per 64 KB chunk would
    // flood the UI thread on a fast link for no visible benefit.
    if received - last_reported >= 256 * 1024 {
      last_reported = received;
      let _ = on_progress.send(DownloadProgress { received, total });
    }
  }
  file.flush().map_err(|e| e.to_string())?;
  drop(file);
  if received >= MAX_ASSET_BYTES {
    let _ = fs::remove_file(&partial);
    return Err("download exceeded the size limit".into());
  }
  fs::rename(&partial, &dest).map_err(|e| e.to_string())?;
  let _ = on_progress.send(DownloadProgress {
    received,
    total: received,
  });
  Ok(dest.to_string_lossy().into_owned())
}

// ── Install ──────────────────────────────────────────────────────────────────

/// Run a command, streaming its combined output, and return its exit code.
fn run_streamed(file: &str, args: &[&str], on_event: &Channel<String>) -> Result<i32, String> {
  let _ = on_event.send(format!("$ {file} {}", args.join(" ")));
  let output = build_command(file, args)
    .stdin(Stdio::null())
    .output()
    .map_err(|e| format!("{file}: {e}"))?;
  for stream in [&output.stdout, &output.stderr] {
    for line in String::from_utf8_lossy(stream).lines() {
      if !line.trim().is_empty() {
        let _ = on_event.send(line.to_string());
      }
    }
  }
  Ok(output.status.code().unwrap_or(-1))
}

fn extension_of(path: &Path) -> String {
  path
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase()
}

/// Install a downloaded package, dispatching on its format.
///
/// Every branch is a side effect on the user's machine, so each one announces
/// the exact command it is about to run through `on_event` before running it —
/// a silent `/S` install is precisely the thing a user should be able to audit
/// in the run log afterwards.
#[tauri::command(async)]
pub fn install_package(path: String, on_event: Channel<String>) -> Result<i32, String> {
  let file = PathBuf::from(&path);
  if !file.is_file() {
    return Err(format!("no such file: {path}"));
  }
  match extension_of(&file).as_str() {
    #[cfg(windows)]
    "exe" => install_windows_exe(&file, &on_event),
    #[cfg(windows)]
    "msi" => install_windows_msi(&file, &on_event),
    #[cfg(target_os = "macos")]
    "dmg" => install_macos_dmg(&file, &on_event),
    #[cfg(target_os = "macos")]
    "zip" => install_macos_zip(&file, &on_event),
    #[cfg(target_os = "linux")]
    "deb" => install_linux_deb(&file, &on_event),
    #[cfg(target_os = "linux")]
    "appimage" => install_linux_appimage(&file, &on_event),
    other => Err(format!(
      "don't know how to install a .{other} package on this platform — the file is at {path}"
    )),
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────

/// NSIS (what Tauri bundles by default) takes `/S` for a silent install. Run
/// elevated: these write to Program Files.
#[cfg(windows)]
fn install_windows_exe(file: &Path, on_event: &Channel<String>) -> Result<i32, String> {
  let path = file.to_string_lossy().into_owned();
  run_elevated(&path, &["/S"], on_event)
}

#[cfg(windows)]
fn install_windows_msi(file: &Path, on_event: &Channel<String>) -> Result<i32, String> {
  let path = file.to_string_lossy().into_owned();
  run_elevated("msiexec", &["/i", &path, "/quiet", "/norestart"], on_event)
}

/// Route an installer through the same UAC wrapper `run_command` uses, so the
/// prompt, the output relay and the declined-prompt exit code all behave
/// identically to a winget install.
#[cfg(windows)]
fn run_elevated(file: &str, args: &[&str], on_event: &Channel<String>) -> Result<i32, String> {
  let owned: Vec<String> = args.iter().map(|a| a.to_string()).collect();
  match crate::exec::elevated_wrapper(file, &owned, &std::collections::HashMap::new()) {
    Some((wrapper, wrapper_args)) => {
      let refs: Vec<&str> = wrapper_args.iter().map(String::as_str).collect();
      run_streamed(&wrapper, &refs, on_event)
    }
    // Couldn't write the temp scaffolding — try unelevated rather than give up.
    None => run_streamed(file, args, on_event),
  }
}

// ── macOS ────────────────────────────────────────────────────────────────────

/// Where a `.app` should land. `/Applications` when we can write it, otherwise
/// the per-user `~/Applications` — which needs no admin prompt at all.
#[cfg(target_os = "macos")]
fn app_install_dir() -> PathBuf {
  let system = PathBuf::from("/Applications");
  // A writability probe beats a root check: an admin user's /Applications is
  // group-writable, so the common case needs no elevation.
  let probe = system.join(".agentpack-write-probe");
  if fs::write(&probe, b"").is_ok() {
    let _ = fs::remove_file(&probe);
    return system;
  }
  let user = dirs::home_dir().unwrap_or_default().join("Applications");
  let _ = fs::create_dir_all(&user);
  user
}

/// Copy the single `.app` bundle found in `src` into the apps directory and
/// clear its quarantine flag (without which Gatekeeper refuses a copied bundle).
#[cfg(target_os = "macos")]
fn place_app_bundle(src: &Path, on_event: &Channel<String>) -> Result<i32, String> {
  let bundle = fs::read_dir(src)
    .map_err(|e| e.to_string())?
    .flatten()
    .map(|e| e.path())
    .find(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))
    .ok_or("no .app bundle found in the downloaded package")?;
  let name = bundle
    .file_name()
    .and_then(|n| n.to_str())
    .ok_or("unreadable bundle name")?
    .to_string();
  let dest = app_install_dir().join(&name);
  let dest_str = dest.to_string_lossy().into_owned();

  // Replace any previous copy: `cp -R` into an existing bundle merges the two
  // and can leave stale binaries behind.
  if dest.exists() {
    let _ = fs::remove_dir_all(&dest);
  }
  let code = run_streamed(
    "cp",
    &["-R", &bundle.to_string_lossy(), &dest_str],
    on_event,
  )?;
  if code != 0 {
    return Ok(code);
  }
  let _ = run_streamed(
    "xattr",
    &["-dr", "com.apple.quarantine", &dest_str],
    on_event,
  );
  let _ = on_event.send(format!("installed → {dest_str}"));
  Ok(0)
}

#[cfg(target_os = "macos")]
fn install_macos_dmg(file: &Path, on_event: &Channel<String>) -> Result<i32, String> {
  // An explicit mount point means we never have to parse hdiutil's output, and
  // guarantees we detach exactly what we attached.
  let mount = std::env::temp_dir().join(format!("agentpack-dmg-{}", std::process::id()));
  fs::create_dir_all(&mount).map_err(|e| e.to_string())?;
  let mount_str = mount.to_string_lossy().into_owned();

  let code = run_streamed(
    "hdiutil",
    &[
      "attach",
      "-nobrowse",
      "-readonly",
      "-quiet",
      &file.to_string_lossy(),
      "-mountpoint",
      &mount_str,
    ],
    on_event,
  )?;
  if code != 0 {
    let _ = fs::remove_dir(&mount);
    return Ok(code);
  }

  let placed = place_app_bundle(&mount, on_event);
  // Always detach, even when the copy failed — a leaked mount survives the app.
  let _ = run_streamed("hdiutil", &["detach", &mount_str, "-quiet"], on_event);
  let _ = fs::remove_dir(&mount);
  placed
}

#[cfg(target_os = "macos")]
fn install_macos_zip(file: &Path, on_event: &Channel<String>) -> Result<i32, String> {
  let staging = std::env::temp_dir().join(format!("agentpack-zip-{}", std::process::id()));
  let _ = fs::remove_dir_all(&staging);
  fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
  // `ditto` (not `unzip`) because it preserves the resource forks and code
  // signature a `.app` needs to launch.
  let code = run_streamed(
    "ditto",
    &[
      "-x",
      "-k",
      &file.to_string_lossy(),
      &staging.to_string_lossy(),
    ],
    on_event,
  )?;
  if code != 0 {
    let _ = fs::remove_dir_all(&staging);
    return Ok(code);
  }
  let placed = place_app_bundle(&staging, on_event);
  let _ = fs::remove_dir_all(&staging);
  placed
}

// ── Linux ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn install_linux_deb(file: &Path, on_event: &Channel<String>) -> Result<i32, String> {
  let path = file.to_string_lossy().into_owned();
  // A .deb needs root and we have no console to prompt on, so this only works
  // through a graphical privilege agent. When there's none, say exactly what to
  // run instead of failing with a bare permissions error.
  if !crate::exec::on_path("pkexec") {
    return Err(format!(
      "installing a .deb needs administrator rights and pkexec isn't available — run it yourself:  sudo apt install {path}"
    ));
  }
  run_streamed("pkexec", &["apt-get", "install", "-y", &path], on_event)
}

/// An AppImage is self-contained: make it executable and put it on the user's
/// own PATH. No root, no package manager — which is why it's the format we
/// prefer on Linux.
#[cfg(target_os = "linux")]
fn install_linux_appimage(file: &Path, on_event: &Channel<String>) -> Result<i32, String> {
  use std::os::unix::fs::PermissionsExt;

  let bin_dir = dirs::home_dir().unwrap_or_default().join(".local/bin");
  fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
  // Drop the version and architecture from the file name so the command stays
  // stable across upgrades (`cc-switch`, not `cc-switch_3.4.1_amd64.AppImage`).
  let stem = file
    .file_stem()
    .and_then(|s| s.to_str())
    .ok_or("unreadable AppImage name")?;
  let name = stem
    .split(['_', '-'])
    .next()
    .filter(|s| !s.is_empty())
    .unwrap_or(stem);
  let dest = bin_dir.join(name);

  fs::copy(file, &dest).map_err(|e| format!("copy failed: {e}"))?;
  fs::set_permissions(&dest, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
  let _ = on_event.send(format!("installed → {}", dest.display()));
  if !std::env::var("PATH")
    .unwrap_or_default()
    .split(':')
    .any(|p| Path::new(p) == bin_dir)
  {
    let _ = on_event.send(format!(
      "note: {} is not on your PATH — add it to your shell profile to run `{name}` directly.",
      bin_dir.display()
    ));
  }
  Ok(0)
}

#[cfg(test)]
mod tests {
  use super::*;

  const RELEASE_JSON: &str = r#"{
    "tag_name": "v3.4.1",
    "name": "CC Switch 3.4.1",
    "assets": [
      {"name": "CC.Switch_3.4.1_x64-setup.exe",
       "browser_download_url": "https://github.com/o/r/releases/download/v3.4.1/setup.exe",
       "size": 4194304},
      {"name": "CC.Switch_3.4.1_aarch64.dmg",
       "browser_download_url": "https://github.com/o/r/releases/download/v3.4.1/arm.dmg",
       "size": 8388608},
      {"name": "cc-switch_3.4.1_amd64.AppImage",
       "browser_download_url": "https://github.com/o/r/releases/download/v3.4.1/app.AppImage"}
    ]
  }"#;

  // Shaped exactly like the real Claude desktop manifest at
  // downloads.claude.ai/releases/darwin/universal/RELEASES.json.
  const MANIFEST_JSON: &str = r#"{
    "currentRelease": "1.24012.9",
    "releases": [
      {"version": "1.24000.0",
       "updateTo": {"version": "1.24000.0",
                    "url": "https://downloads.claude.ai/releases/darwin/universal/1.24000.0/Claude-old.zip"}},
      {"version": "1.24012.9",
       "updateTo": {"version": "1.24012.9",
                    "url": "https://downloads.claude.ai/releases/darwin/universal/1.24012.9/Claude-abc.zip"}}
    ]
  }"#;

  #[test]
  fn manifest_resolves_the_current_release_not_the_first_listed() {
    // The stale entry is listed FIRST; picking by order would install it.
    let info = parse_manifest(MANIFEST_JSON).unwrap();
    assert_eq!(info.tag, "1.24012.9");
    assert_eq!(info.assets.len(), 1);
    assert_eq!(info.assets[0].name, "Claude-abc.zip");
    assert!(info.assets[0].url.ends_with("/1.24012.9/Claude-abc.zip"));
  }

  #[test]
  fn manifest_file_name_drops_any_query_string() {
    // The extension decides which installer runs, so `?sig=…` must not become
    // part of it and turn a .zip into an unknown format.
    let body = r#"{"currentRelease":"1","releases":[{"version":"1",
      "updateTo":{"url":"https://x/y/Claude.zip?sig=abc&t=1"}}]}"#;
    assert_eq!(parse_manifest(body).unwrap().assets[0].name, "Claude.zip");
  }

  #[test]
  fn manifest_rejects_a_non_https_download() {
    let body = r#"{"currentRelease":"1","releases":[{"version":"1",
      "updateTo":{"url":"http://x/y/Claude.zip"}}]}"#;
    assert!(parse_manifest(body).is_err());
  }

  #[test]
  fn manifest_errors_instead_of_guessing_when_fields_are_missing() {
    assert!(parse_manifest(r#"{"releases":[]}"#).is_err());
    assert!(parse_manifest(r#"{"currentRelease":"1","releases":[]}"#).is_err());
    assert!(parse_manifest("not json").is_err());
  }

  #[test]
  fn parses_tag_and_every_asset() {
    let info = parse_release(RELEASE_JSON).unwrap();
    assert_eq!(info.tag, "v3.4.1");
    assert_eq!(info.assets.len(), 3);
    assert_eq!(info.assets[0].name, "CC.Switch_3.4.1_x64-setup.exe");
    assert_eq!(
      info.assets[0].url,
      "https://github.com/o/r/releases/download/v3.4.1/setup.exe"
    );
    assert_eq!(info.assets[0].size, 4194304);
    // A missing size is reported as 0 rather than dropping the asset.
    assert_eq!(info.assets[2].size, 0);
  }

  #[test]
  fn skips_malformed_assets_instead_of_failing_the_whole_release() {
    let body = r#"{"tag_name":"v1","assets":[{"name":"only-a-name"},
      {"name":"good.dmg","browser_download_url":"https://x/y.dmg","size":1}]}"#;
    let info = parse_release(body).unwrap();
    assert_eq!(info.assets.len(), 1);
    assert_eq!(info.assets[0].name, "good.dmg");
  }

  #[test]
  fn rejects_a_release_without_a_tag() {
    assert!(parse_release(r#"{"assets":[]}"#).is_err());
    assert!(parse_release("not json").is_err());
  }

  #[test]
  fn tolerates_a_release_with_no_assets_at_all() {
    let info = parse_release(r#"{"tag_name":"v1"}"#).unwrap();
    assert_eq!(info.tag, "v1");
    assert!(info.assets.is_empty());
  }

  #[test]
  fn mirror_prefix_is_prepended_verbatim_and_ignored_when_blank() {
    let url = "https://github.com/o/r/releases/download/v1/a.dmg";
    assert_eq!(
      mirrored(url, Some("https://gh-proxy.com/")),
      format!("https://gh-proxy.com/{url}")
    );
    assert_eq!(mirrored(url, None), url);
    assert_eq!(mirrored(url, Some("   ")), url);
  }

  #[test]
  fn only_a_plain_owner_slash_name_is_accepted() {
    assert!(validate_repo("farion1231/cc-switch").is_ok());
    assert!(validate_repo("o/r.dot-dash_ok").is_ok());
    // Anything that could steer the request elsewhere is refused.
    assert!(validate_repo("o/r/extra").is_err());
    assert!(validate_repo("../../etc").is_err());
    assert!(validate_repo("o/r?x=1").is_err());
    assert!(validate_repo("o").is_err());
    assert!(validate_repo("/r").is_err());
  }

  #[test]
  fn a_traversing_asset_name_cannot_escape_the_download_dir() {
    assert_eq!(safe_file_name("setup.exe").unwrap(), "setup.exe");
    assert_eq!(safe_file_name("../../evil.exe").unwrap(), "evil.exe");
    assert_eq!(safe_file_name("/etc/passwd").unwrap(), "passwd");
    assert!(safe_file_name("..").is_err());
    assert!(safe_file_name("").is_err());
  }

  #[test]
  fn extension_matching_is_case_insensitive() {
    assert_eq!(extension_of(Path::new("/tmp/a.AppImage")), "appimage");
    assert_eq!(extension_of(Path::new("/tmp/a.DMG")), "dmg");
    assert_eq!(extension_of(Path::new("/tmp/noext")), "");
  }
}
