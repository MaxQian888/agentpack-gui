//! Proxy discovery, verification and process-wide application.
//!
//! Split from `exec` because it's all about one subject: what proxy this machine
//! is already using, whether it works, and making agentpack's own traffic go
//! through it. Every command returns a structured snapshot instead of erroring —
//! a missing `scutil` / `npm` / registry key simply contributes nothing, so the
//! UI always has something to render.
//!
//! The TS side (`lib/agentpack/network/discovery.ts`) owns the merging, ranking
//! and de-duplication; Rust only reports raw facts.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::exec::build_command;

// ── Process-wide proxy override ──────────────────────────────────────────────

/// The proxy agentpack itself should use, set from the UI when a config is
/// applied. Held in memory rather than pushed into the process environment:
/// `std::env::set_var` races with any thread reading the environment, and we get
/// the same reach without it — `proxy_from_env` consults this for our own ureq
/// agents, and `exec::apply_env` copies it onto every child process we spawn.
#[derive(Clone, Default, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyOverride {
  pub http: Option<String>,
  pub https: Option<String>,
  pub all: Option<String>,
  pub no_proxy: Option<String>,
}

fn override_slot() -> &'static Mutex<ProxyOverride> {
  static SLOT: OnceLock<Mutex<ProxyOverride>> = OnceLock::new();
  SLOT.get_or_init(|| Mutex::new(ProxyOverride::default()))
}

/// Point agentpack's own network traffic at a proxy (or clear it with an empty
/// override). Takes effect immediately: HTTP agents are built per call, and
/// child processes read the override when they're spawned.
#[tauri::command]
pub fn set_process_proxy(config: ProxyOverride) {
  let clean = |s: Option<String>| s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
  let cleaned = ProxyOverride {
    http: clean(config.http),
    https: clean(config.https),
    all: clean(config.all),
    no_proxy: clean(config.no_proxy),
  };
  if let Ok(mut slot) = override_slot().lock() {
    *slot = cleaned;
  }
}

fn active_override() -> ProxyOverride {
  override_slot().lock().map(|s| s.clone()).unwrap_or_default()
}

/// Non-empty environment value for the first of `names` that is set.
fn env_first(names: &[&str]) -> Option<String> {
  names
    .iter()
    .filter_map(|n| std::env::var(n).ok())
    .map(|v| v.trim().to_string())
    .find(|v| !v.is_empty())
}

/// The proxy URL our HTTP client should use: the UI-applied override first, then
/// the ambient environment (what the user's shell already exports).
fn effective_proxy_url() -> Option<String> {
  let ov = active_override();
  ov.https
    .or(ov.http)
    .or_else(|| env_first(&["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]))
}

/// Shared proxy resolution for every ureq agent in the app (`mcp`, `skills`).
/// SOCKS URLs are rejected by `ureq::Proxy` in this build (no socks feature), so
/// they simply yield `None` and the request goes direct rather than failing.
pub fn proxy_from_env() -> Option<ureq::Proxy> {
  effective_proxy_url().and_then(|url| ureq::Proxy::new(&url).ok())
}

/// Proxy variables to place on every child process we spawn, so `npm`, `git` and
/// the agent CLIs inherit the proxy the user applied in agentpack. Empty when no
/// override is set (the child then inherits our own environment untouched).
pub fn child_proxy_env() -> Vec<(String, String)> {
  let ov = active_override();
  let mut out: Vec<(String, String)> = Vec::new();
  let mut push = |name: &str, value: &Option<String>| {
    if let Some(v) = value {
      out.push((name.to_string(), v.clone()));
      out.push((name.to_lowercase(), v.clone()));
    }
  };
  let http = ov.http.clone().or_else(|| ov.https.clone());
  let https = ov.https.clone().or_else(|| ov.http.clone());
  push("HTTP_PROXY", &http);
  push("HTTPS_PROXY", &https);
  push("ALL_PROXY", &ov.all);
  push("NO_PROXY", &ov.no_proxy);
  out
}

// ── Discovery ────────────────────────────────────────────────────────────────

/// Proxy variables visible to the agentpack process.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyEnvSnapshot {
  http_proxy: Option<String>,
  https_proxy: Option<String>,
  all_proxy: Option<String>,
  no_proxy: Option<String>,
}

/// What the user's shell exported before agentpack launched. Read straight from
/// our own environment: uppercase wins, lowercase is the fallback.
#[tauri::command]
pub fn proxy_env_snapshot() -> ProxyEnvSnapshot {
  ProxyEnvSnapshot {
    http_proxy: env_first(&["HTTP_PROXY", "http_proxy"]),
    https_proxy: env_first(&["HTTPS_PROXY", "https_proxy"]),
    all_proxy: env_first(&["ALL_PROXY", "all_proxy"]),
    no_proxy: env_first(&["NO_PROXY", "no_proxy"]),
  }
}

/// One proxy endpoint the OS advertises.
#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemProxyEntry {
  /// "http" | "https" | "socks"
  scheme: String,
  host: String,
  port: u16,
}

/// The operating system's proxy panel.
#[derive(Serialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemProxySnapshot {
  entries: Vec<SystemProxyEntry>,
  pac_url: Option<String>,
  bypass: Vec<String>,
}

/// Run a command with a hard timeout, returning its stdout on success. Every
/// probe here shells out to a system tool that is usually instant but can hang
/// (a stuck `npm`, a slow registry read), and no scan may block the UI.
fn capture(file: &str, args: &[&str], secs: u64) -> Option<String> {
  let (tx, rx) = std::sync::mpsc::channel();
  let file = file.to_string();
  let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
  std::thread::spawn(move || {
    let _ = tx.send(build_command(&file, &args).output());
  });
  match rx.recv_timeout(Duration::from_secs(secs)) {
    Ok(Ok(o)) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).into_owned()),
    _ => None,
  }
}

/// Parse `scutil --proxy` output (macOS). Only enabled protocols are reported,
/// so a stale-but-disabled entry never shows up as a candidate.
///
/// This and the Windows / gsettings parsers below are compiled on every platform
/// (only their caller is gated) so their unit tests run on any CI host — hence
/// the dead-code allowance on the ones this build won't call.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_scutil(text: &str) -> SystemProxySnapshot {
  let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  let mut bypass: Vec<String> = Vec::new();
  let mut in_exceptions = false;
  for raw in text.lines() {
    let line = raw.trim();
    if in_exceptions {
      if line.starts_with('}') {
        in_exceptions = false;
        continue;
      }
      if let Some((_, value)) = line.split_once(':') {
        let v = value.trim();
        if !v.is_empty() {
          bypass.push(v.to_string());
        }
      }
      continue;
    }
    if line.starts_with("ExceptionsList") {
      in_exceptions = line.contains('{');
      continue;
    }
    if let Some((key, value)) = line.split_once(':') {
      let (k, v) = (key.trim(), value.trim());
      if !k.is_empty() && !v.is_empty() && !v.starts_with('<') {
        fields.insert(k.to_string(), v.to_string());
      }
    }
  }
  let enabled = |key: &str| fields.get(key).map(|v| v == "1").unwrap_or(false);
  let mut entries = Vec::new();
  for (flag, host_key, port_key, scheme) in [
    ("HTTPEnable", "HTTPProxy", "HTTPPort", "http"),
    ("HTTPSEnable", "HTTPSProxy", "HTTPSPort", "https"),
    ("SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks"),
  ] {
    if !enabled(flag) {
      continue;
    }
    let host = match fields.get(host_key) {
      Some(h) => h.clone(),
      None => continue,
    };
    let port = fields.get(port_key).and_then(|p| p.parse::<u16>().ok());
    if let Some(port) = port {
      entries.push(SystemProxyEntry { scheme: scheme.into(), host, port });
    }
  }
  let pac_url = if enabled("ProxyAutoConfigEnable") {
    fields.get("ProxyAutoConfigURLString").cloned()
  } else {
    None
  };
  SystemProxySnapshot { entries, pac_url, bypass }
}

/// Split a `host:port` pair, defaulting the port per scheme.
#[cfg_attr(not(windows), allow(dead_code))]
fn split_host_port(value: &str, default_port: u16) -> Option<(String, u16)> {
  let v = value.trim();
  if v.is_empty() {
    return None;
  }
  match v.rsplit_once(':') {
    Some((host, port)) if !host.is_empty() => match port.trim().parse::<u16>() {
      Ok(p) => Some((host.trim().to_string(), p)),
      Err(_) => None,
    },
    _ => Some((v.to_string(), default_port)),
  }
}

/// Parse `reg query …\Internet Settings` output (Windows). `ProxyServer` is
/// either a bare `host:port` (all protocols) or a `scheme=host:port;…` list.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_win_reg(text: &str) -> SystemProxySnapshot {
  let mut values: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  for line in text.lines() {
    let parts: Vec<&str> = line.split_whitespace().collect();
    // `    Name    REG_SZ    value with spaces`
    if parts.len() >= 3 && parts[1].starts_with("REG_") {
      let value = line
        .split_once(parts[1])
        .map(|(_, rest)| rest.trim().to_string())
        .unwrap_or_default();
      values.insert(parts[0].to_string(), value);
    }
  }
  let enabled = values
    .get("ProxyEnable")
    .map(|v| v.trim_start_matches("0x").trim_end() != "0")
    .unwrap_or(false);
  let mut entries = Vec::new();
  if enabled {
    if let Some(server) = values.get("ProxyServer") {
      if server.contains('=') {
        for part in server.split(';') {
          if let Some((scheme, addr)) = part.split_once('=') {
            let scheme = scheme.trim().to_lowercase();
            let default = if scheme == "https" { 443 } else { 80 };
            if let Some((host, port)) = split_host_port(addr, default) {
              entries.push(SystemProxyEntry { scheme, host, port });
            }
          }
        }
      } else if let Some((host, port)) = split_host_port(server, 80) {
        entries.push(SystemProxyEntry { scheme: "http".into(), host, port });
      }
    }
  }
  let bypass = values
    .get("ProxyOverride")
    .map(|v| {
      v.split(';')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
    })
    .unwrap_or_default();
  let pac_url = values
    .get("AutoConfigURL")
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
  SystemProxySnapshot { entries, pac_url, bypass }
}

/// Strip gsettings' quoting: `'value'` → `value`, `['a', 'b']` → `["a", "b"]`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn unquote_gsettings(value: &str) -> String {
  value.trim().trim_matches('\'').trim().to_string()
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_gsettings_list(value: &str) -> Vec<String> {
  // An empty list prints with its type annotation: `@as []`.
  let body = value.trim().trim_start_matches("@as").trim();
  body
    .trim_start_matches('[')
    .trim_end_matches(']')
    .split(',')
    .map(unquote_gsettings)
    .filter(|s| !s.is_empty())
    .collect()
}

#[cfg(target_os = "macos")]
fn os_system_proxy() -> SystemProxySnapshot {
  capture("scutil", &["--proxy"], 3)
    .map(|out| parse_scutil(&out))
    .unwrap_or_default()
}

#[cfg(windows)]
fn os_system_proxy() -> SystemProxySnapshot {
  capture(
    "reg",
    &[
      "query",
      r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
    ],
    3,
  )
  .map(|out| parse_win_reg(&out))
  .unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn os_system_proxy() -> SystemProxySnapshot {
  let get = |schema: &str, key: &str| capture("gsettings", &["get", schema, key], 3);
  let mode = get("org.gnome.system.proxy", "mode")
    .map(|v| unquote_gsettings(&v))
    .unwrap_or_default();
  let mut entries = Vec::new();
  if mode == "manual" {
    for (schema, scheme) in [
      ("org.gnome.system.proxy.http", "http"),
      ("org.gnome.system.proxy.https", "https"),
      ("org.gnome.system.proxy.socks", "socks"),
    ] {
      let host = get(schema, "host").map(|v| unquote_gsettings(&v)).unwrap_or_default();
      let port = get(schema, "port")
        .and_then(|v| v.trim().parse::<u16>().ok())
        .unwrap_or(0);
      if !host.is_empty() && port > 0 {
        entries.push(SystemProxyEntry { scheme: scheme.into(), host, port });
      }
    }
  }
  let pac_url = if mode == "auto" {
    get("org.gnome.system.proxy", "autoconfig-url")
      .map(|v| unquote_gsettings(&v))
      .filter(|v| !v.is_empty())
  } else {
    None
  };
  let bypass = get("org.gnome.system.proxy", "ignore-hosts")
    .map(|v| parse_gsettings_list(&v))
    .unwrap_or_default();
  SystemProxySnapshot { entries, pac_url, bypass }
}

/// Any other platform has no panel we know how to read.
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn os_system_proxy() -> SystemProxySnapshot {
  SystemProxySnapshot::default()
}

/// The OS proxy panel. macOS reads `scutil --proxy`, Windows the Internet
/// Settings registry key, Linux GNOME's gsettings. An unavailable tool (a
/// headless box, a non-GNOME desktop) yields an empty snapshot.
#[tauri::command(async)]
pub fn system_proxy_snapshot() -> SystemProxySnapshot {
  os_system_proxy()
}

/// Proxy-related config already present in npm and git.
#[derive(Serialize, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolProxySnapshot {
  npm_proxy: Option<String>,
  npm_https_proxy: Option<String>,
  npm_no_proxy: Option<String>,
  npm_registry: Option<String>,
  git_http_proxy: Option<String>,
  git_https_proxy: Option<String>,
}

/// npm prints `key=value` lines when asked for several keys at once, and the
/// string `null` for an unset one. Returns the parsed, non-null pairs.
fn parse_npm_config(text: &str) -> std::collections::HashMap<String, String> {
  let mut out = std::collections::HashMap::new();
  for line in text.lines() {
    let Some((key, value)) = line.split_once('=') else {
      continue;
    };
    let (k, v) = (key.trim(), value.trim().trim_matches('"'));
    if k.is_empty() || v.is_empty() || v == "null" || v == "undefined" {
      continue;
    }
    out.insert(k.to_string(), v.to_string());
  }
  out
}

/// What npm and git already have configured — the values a user set up by hand
/// before ever opening agentpack, which discovery offers back to them.
#[tauri::command(async)]
pub fn tool_proxy_snapshot() -> ToolProxySnapshot {
  let npm = capture(
    "npm",
    &["config", "get", "proxy", "https-proxy", "noproxy", "registry"],
    8,
  )
  .map(|out| parse_npm_config(&out))
  .unwrap_or_default();
  let git = |key: &str| {
    capture("git", &["config", "--global", "--get", key], 5)
      .map(|v| v.trim().to_string())
      .filter(|v| !v.is_empty())
  };
  ToolProxySnapshot {
    npm_proxy: npm.get("proxy").cloned(),
    npm_https_proxy: npm.get("https-proxy").cloned(),
    npm_no_proxy: npm.get("noproxy").cloned(),
    npm_registry: npm.get("registry").cloned(),
    git_http_proxy: git("http.proxy"),
    git_https_proxy: git("https.proxy"),
  }
}

// ── Verification ─────────────────────────────────────────────────────────────

/// The outcome of a real request through a proxy.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyCheckResult {
  ok: bool,
  /// HTTP status, when the request reached a server at all.
  status: Option<u16>,
  latency_ms: Option<u64>,
  /// "ok" | "proxy-auth" | "proxy-refused" | "unreachable" | "dns" | "timeout" |
  /// "bad-proxy-url" | "tls" | "http-<code>" | "failed"
  reason: String,
}

/// Classify a ureq transport failure into a reason the UI can explain.
fn transport_reason(err: &ureq::Transport) -> &'static str {
  let text = err.to_string().to_lowercase();
  if text.contains("timed out") || text.contains("timeout") {
    return "timeout";
  }
  match err.kind() {
    ureq::ErrorKind::Dns => "dns",
    ureq::ErrorKind::InvalidProxyUrl => "bad-proxy-url",
    ureq::ErrorKind::ProxyConnect => "proxy-refused",
    ureq::ErrorKind::ProxyUnauthorized => "proxy-auth",
    ureq::ErrorKind::ConnectionFailed => {
      if text.contains("certificate") || text.contains("tls") || text.contains("ssl") {
        "tls"
      } else {
        "unreachable"
      }
    }
    _ => "failed",
  }
}

/// Send one real GET through `proxy_url` (or direct when it's null, which is how
/// the UI offers a "compare with no proxy" baseline) and report what happened.
/// Never errors: an unreachable endpoint is a result, not a failure.
#[tauri::command(async)]
pub fn proxy_check(
  proxy_url: Option<String>,
  test_url: String,
  timeout_ms: Option<u64>,
) -> ProxyCheckResult {
  let timeout = Duration::from_millis(timeout_ms.unwrap_or(8000).clamp(500, 60_000));
  let mut builder = ureq::AgentBuilder::new()
    .timeout(timeout)
    .redirects(2)
    .user_agent("agentpack-proxy-check");
  if let Some(url) = proxy_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
    match ureq::Proxy::new(url) {
      Ok(proxy) => builder = builder.proxy(proxy),
      Err(_) => {
        return ProxyCheckResult {
          ok: false,
          status: None,
          latency_ms: None,
          reason: "bad-proxy-url".into(),
        }
      }
    }
  }
  let started = Instant::now();
  let elapsed = |t: Instant| Some(t.elapsed().as_millis() as u64);
  match builder.build().get(&test_url).call() {
    Ok(resp) => ProxyCheckResult {
      ok: true,
      status: Some(resp.status()),
      latency_ms: elapsed(started),
      reason: "ok".into(),
    },
    // A status response still proves the tunnel works — except 407, which means
    // the proxy itself wants credentials.
    Err(ureq::Error::Status(code, _)) => ProxyCheckResult {
      ok: code < 400,
      status: Some(code),
      latency_ms: elapsed(started),
      reason: if code == 407 {
        "proxy-auth".into()
      } else {
        format!("http-{code}")
      },
    },
    Err(ureq::Error::Transport(t)) => ProxyCheckResult {
      ok: false,
      status: None,
      latency_ms: None,
      reason: transport_reason(&t).into(),
    },
  }
}

/// Outcome of `http_get`. An HTTP response — including 401 or 404 — is a success
/// as far as this command is concerned: it reached the server, and the caller is
/// the one who knows what a given status means for it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpGetResult {
  /// HTTP status, or `None` when the request never got a response.
  status: Option<u16>,
  latency_ms: Option<u64>,
  /// Response body, capped — callers parse only small metadata payloads here.
  body: String,
  /// Transport-level failure (DNS, TLS, timeout); `None` when a status came back.
  error: Option<String>,
}

/// Cap on the body we read back. The endpoint probe wants a model list, not a
/// stream, and an unbounded read would let a hostile or misconfigured endpoint
/// balloon the app's memory.
const HTTP_GET_BODY_CAP: usize = 256 * 1024;

/// Plain authenticated GET, used to check that an API endpoint is reachable and
/// that its credentials work. Generic on purpose: the URL and headers are built
/// on the TS side (`ccswitch/probe.ts`), which is where the knowledge of each
/// CLI's auth scheme already lives, so Rust never duplicates it.
#[tauri::command(async)]
pub fn http_get(
  url: String,
  headers: std::collections::HashMap<String, String>,
  timeout_ms: Option<u64>,
) -> Result<HttpGetResult, String> {
  let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000).clamp(500, 60_000));
  let mut builder = ureq::AgentBuilder::new().timeout(timeout).redirects(2);
  if let Some(proxy) = proxy_from_env() {
    builder = builder.proxy(proxy);
  }
  let mut req = builder.build().get(&url);
  for (k, v) in &headers {
    req = req.set(k, v);
  }

  let started = Instant::now();
  let elapsed = || Some(started.elapsed().as_millis() as u64);
  let read_capped = |resp: ureq::Response| {
    use std::io::Read;
    let mut buf = String::new();
    let _ = resp
      .into_reader()
      .take(HTTP_GET_BODY_CAP as u64)
      .read_to_string(&mut buf);
    buf
  };
  match req.call() {
    Ok(resp) => Ok(HttpGetResult {
      status: Some(resp.status()),
      latency_ms: elapsed(),
      body: read_capped(resp),
      error: None,
    }),
    // A 401/404 is the most useful answer this probe can give — a wrong token or
    // a base URL missing its `/v1` — so it is reported, not raised.
    Err(ureq::Error::Status(code, resp)) => Ok(HttpGetResult {
      status: Some(code),
      latency_ms: elapsed(),
      body: read_capped(resp),
      error: None,
    }),
    Err(ureq::Error::Transport(t)) => Ok(HttpGetResult {
      status: None,
      latency_ms: None,
      body: String::new(),
      error: Some(transport_reason(&t).into()),
    }),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const SCUTIL: &str = r#"
<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
  SOCKSPort : 7891
  SOCKSProxy : 127.0.0.1
}
"#;

  #[test]
  fn scutil_reports_only_enabled_protocols() {
    let snap = parse_scutil(SCUTIL);
    assert_eq!(
      snap.entries,
      vec![
        SystemProxyEntry { scheme: "http".into(), host: "127.0.0.1".into(), port: 7890 },
        SystemProxyEntry { scheme: "https".into(), host: "127.0.0.1".into(), port: 7890 },
      ],
      "a disabled SOCKS entry must not be offered as a candidate"
    );
    assert_eq!(snap.bypass, vec!["*.local", "169.254/16"]);
    assert_eq!(snap.pac_url, None);
  }

  #[test]
  fn scutil_reports_the_pac_url_only_when_enabled() {
    let on = "  ProxyAutoConfigEnable : 1\n  ProxyAutoConfigURLString : http://wpad/proxy.pac\n";
    assert_eq!(parse_scutil(on).pac_url.as_deref(), Some("http://wpad/proxy.pac"));
    let off = "  ProxyAutoConfigEnable : 0\n  ProxyAutoConfigURLString : http://wpad/proxy.pac\n";
    assert_eq!(parse_scutil(off).pac_url, None);
  }

  #[test]
  fn scutil_with_no_proxy_yields_nothing() {
    let snap = parse_scutil("<dictionary> {\n  HTTPEnable : 0\n}\n");
    assert_eq!(snap, SystemProxySnapshot::default());
  }

  #[test]
  fn win_reg_parses_a_bare_host_port() {
    let text = "
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
    ProxyOverride    REG_SZ    localhost;127.*;<local>
";
    let snap = parse_win_reg(text);
    assert_eq!(
      snap.entries,
      vec![SystemProxyEntry { scheme: "http".into(), host: "127.0.0.1".into(), port: 7890 }]
    );
    assert_eq!(snap.bypass, vec!["localhost", "127.*", "<local>"]);
  }

  #[test]
  fn win_reg_parses_a_per_scheme_list_and_the_pac_url() {
    let text = "
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=10.0.0.1:8080;https=10.0.0.1:8443;socks=10.0.0.1:1080
    AutoConfigURL    REG_SZ    http://wpad/proxy.pac
";
    let snap = parse_win_reg(text);
    assert_eq!(snap.entries.len(), 3);
    assert_eq!(snap.entries[1].scheme, "https");
    assert_eq!(snap.entries[1].port, 8443);
    assert_eq!(snap.pac_url.as_deref(), Some("http://wpad/proxy.pac"));
  }

  #[test]
  fn win_reg_ignores_a_disabled_proxy() {
    let text = "
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ    127.0.0.1:7890
";
    assert!(parse_win_reg(text).entries.is_empty());
  }

  #[test]
  fn gsettings_values_are_unquoted() {
    assert_eq!(unquote_gsettings("'manual'"), "manual");
    assert_eq!(
      parse_gsettings_list("['localhost', '127.0.0.0/8']"),
      vec!["localhost", "127.0.0.0/8"]
    );
    assert!(parse_gsettings_list("@as []").is_empty());
  }

  #[test]
  fn npm_config_skips_unset_keys() {
    let text = "proxy=null\nhttps-proxy=http://127.0.0.1:7890\nnoproxy=localhost\nregistry=https://registry.npmjs.org/\n";
    let cfg = parse_npm_config(text);
    assert!(!cfg.contains_key("proxy"), "npm prints `null` for an unset key");
    assert_eq!(cfg.get("https-proxy").unwrap(), "http://127.0.0.1:7890");
    assert_eq!(cfg.get("registry").unwrap(), "https://registry.npmjs.org/");
  }

  #[test]
  fn host_port_splitting_defaults_the_port() {
    assert_eq!(split_host_port("h:8080", 80), Some(("h".into(), 8080)));
    assert_eq!(split_host_port("h", 443), Some(("h".into(), 443)));
    assert_eq!(split_host_port("  ", 80), None);
  }

  #[test]
  fn proxy_check_reports_a_refused_proxy_rather_than_erroring() {
    // Port 9 (discard) is closed on a normal machine, so the CONNECT is refused
    // immediately — deterministic and offline (no DNS, no external network).
    let result = proxy_check(
      Some("http://127.0.0.1:9".into()),
      "http://127.0.0.1:9/".into(),
      Some(1000),
    );
    assert!(!result.ok);
    assert_ne!(result.reason, "ok");
  }

  #[test]
  fn proxy_check_without_a_proxy_tests_the_direct_route() {
    // The `None` branch is the "compare against no proxy" baseline the UI offers.
    let result = proxy_check(None, "http://127.0.0.1:9/".into(), Some(1000));
    assert!(!result.ok);
    assert!(result.status.is_none());
    assert_ne!(result.reason, "ok");
  }

  #[test]
  fn process_proxy_override_reaches_children_and_clears() {
    let _guard = crate::TEST_ENV_LOCK.lock();
    set_process_proxy(ProxyOverride {
      http: Some("http://127.0.0.1:7890".into()),
      https: None,
      all: None,
      no_proxy: Some("localhost".into()),
    });
    let env = child_proxy_env();
    // Both cases are exported, and https cross-fills from http.
    assert!(env.contains(&("HTTP_PROXY".into(), "http://127.0.0.1:7890".into())));
    assert!(env.contains(&("http_proxy".into(), "http://127.0.0.1:7890".into())));
    assert!(env.contains(&("HTTPS_PROXY".into(), "http://127.0.0.1:7890".into())));
    assert!(env.contains(&("NO_PROXY".into(), "localhost".into())));
    assert!(proxy_from_env().is_some());

    set_process_proxy(ProxyOverride::default());
    assert!(child_proxy_env().is_empty());
  }
}
