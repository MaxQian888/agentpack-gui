//! MCP-specific side effects: fetch the official registry over HTTP and probe a
//! server with a real MCP `initialize` handshake. Kept separate from `exec` so
//! the network + protocol code lives in one place. All commands return a
//! structured result rather than erroring on an unreachable/unauthorized server,
//! so the UI can show *why* a probe failed.

use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const REGISTRY_BASE: &str = "https://registry.modelcontextprotocol.io/v0/servers";
const PROTOCOL_VERSION: &str = "2025-06-18";

/// Shared ureq agent: bounded timeouts + the proxy resolved by `net`
/// (the one applied in the UI, else the ambient environment).
fn http_agent() -> ureq::Agent {
  let mut builder = ureq::AgentBuilder::new()
    .timeout_connect(Duration::from_secs(10))
    .timeout_read(Duration::from_secs(15));
  if let Some(proxy) = crate::net::proxy_from_env() {
    builder = builder.proxy(proxy);
  }
  builder.build()
}

/// Fetch one page of the official MCP registry (`GET /v0/servers`) and return the
/// raw JSON body — the TS side (`registry-remote.ts`) owns the schema mapping, so
/// Rust never duplicates it. Cursor-based pagination; `limit` is clamped to 100.
#[tauri::command(async)]
pub fn registry_fetch(
  query: Option<String>,
  cursor: Option<String>,
  limit: Option<u32>,
) -> Result<String, String> {
  let agent = http_agent();
  let lim = limit.unwrap_or(30).min(100).to_string();
  let mut req = agent.get(REGISTRY_BASE).query("limit", &lim);
  if let Some(q) = query.filter(|q| !q.trim().is_empty()) {
    req = req.query("search", &q);
  }
  if let Some(c) = cursor.filter(|c| !c.is_empty()) {
    req = req.query("cursor", &c);
  }
  let resp = req
    .call()
    .map_err(|e| format!("registry fetch failed: {e}"))?;
  resp.into_string().map_err(|e| e.to_string())
}

/// The outcome of an MCP probe. `ok` means the server completed a real MCP
/// `initialize`; `reason` distinguishes the failure modes the UI surfaces.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
  ok: bool,
  /// "ok" | "unauthorized" | "unreachable" | "not-mcp" | "http-<code>" |
  /// "spawn-failed" | "timeout"
  reason: String,
  protocol_version: Option<String>,
  server_name: Option<String>,
  tool_count: Option<u32>,
  latency_ms: Option<u64>,
}

impl ProbeResult {
  fn fail(reason: &str, latency_ms: Option<u64>) -> Self {
    ProbeResult {
      ok: false,
      reason: reason.to_string(),
      protocol_version: None,
      server_name: None,
      tool_count: None,
      latency_ms,
    }
  }
}

/// The JSON-RPC `initialize` request body every probe sends.
fn initialize_body() -> serde_json::Value {
  serde_json::json!({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": PROTOCOL_VERSION,
      "capabilities": {},
      "clientInfo": { "name": "agentpack", "version": "1.0" }
    }
  })
}

/// Extract the JSON-RPC envelope from a response body that is either raw JSON or
/// an SSE (`text/event-stream`) frame (`data: {…}` lines). Returns the first
/// object that carries a `result`/`error`.
fn parse_jsonrpc(text: &str) -> Option<serde_json::Value> {
  let trimmed = text.trim_start();
  if trimmed.starts_with('{') {
    return serde_json::from_str(trimmed).ok();
  }
  for line in text.lines() {
    let line = line.trim();
    if let Some(data) = line.strip_prefix("data:") {
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(data.trim()) {
        if v.get("result").is_some() || v.get("error").is_some() {
          return Some(v);
        }
      }
    }
  }
  None
}

/// Build a successful `ProbeResult` from an `initialize` result object.
fn ok_from_result(result: &serde_json::Value, latency_ms: Option<u64>) -> ProbeResult {
  ProbeResult {
    ok: true,
    reason: "ok".to_string(),
    protocol_version: result
      .get("protocolVersion")
      .and_then(|v| v.as_str())
      .map(String::from),
    server_name: result
      .get("serverInfo")
      .and_then(|s| s.get("name"))
      .and_then(|v| v.as_str())
      .map(String::from),
    tool_count: None,
    latency_ms,
  }
}

/// Probe a remote MCP server with a real `initialize` handshake over
/// streamable-HTTP. Distinguishes a genuine MCP server from something merely
/// reachable, and reports `unauthorized` (401/403) vs `unreachable` so the UI can
/// tell "wrong key" from "server down". `headers` are sent verbatim (an
/// unexpanded `${VAR}` token simply reads as unauthorized). SSE-only endpoints
/// may not answer a POST — that's the deprecated transport's known limitation.
#[tauri::command(async)]
pub fn mcp_probe_remote(
  url: String,
  headers: HashMap<String, String>,
  transport: String,
) -> Result<ProbeResult, String> {
  let _ = transport; // POST-initialize covers streamable-HTTP; SSE is best-effort.
  let agent = http_agent();
  let start = Instant::now();
  let mut req = agent
    .post(&url)
    .set("Content-Type", "application/json")
    .set("Accept", "application/json, text/event-stream");
  for (k, v) in &headers {
    req = req.set(k, v);
  }
  let body = serde_json::to_string(&initialize_body()).unwrap_or_default();
  let resp = match req.send_string(&body) {
    Ok(r) => r,
    Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => {
      return Ok(ProbeResult::fail(
        "unauthorized",
        Some(start.elapsed().as_millis() as u64),
      ))
    }
    Err(ureq::Error::Status(code, _)) => {
      return Ok(ProbeResult::fail(
        &format!("http-{code}"),
        Some(start.elapsed().as_millis() as u64),
      ))
    }
    Err(_) => return Ok(ProbeResult::fail("unreachable", None)),
  };
  let latency = start.elapsed().as_millis() as u64;
  let text = resp.into_string().map_err(|e| e.to_string())?;
  match parse_jsonrpc(&text) {
    Some(v) if v.get("result").is_some() => Ok(ok_from_result(&v["result"], Some(latency))),
    _ => Ok(ProbeResult::fail("not-mcp", Some(latency))),
  }
}

/// Deep-probe a local (stdio) MCP server: actually spawn it, send `initialize`
/// over stdin, and read the JSON-RPC reply from stdout (bounded by `timeout_ms`),
/// then kill it. This runs the server's real command (e.g. downloads an npx
/// package), so it is only ever invoked from an explicit "deep test" action.
#[tauri::command(async)]
pub fn mcp_probe_stdio(
  command: String,
  args: Vec<String>,
  env: HashMap<String, String>,
  timeout_ms: Option<u64>,
) -> Result<ProbeResult, String> {
  use std::io::{BufRead, BufReader, Write};
  use std::process::{Command, Stdio};

  let timeout = Duration::from_millis(timeout_ms.unwrap_or(10_000));
  // npm-family shims need `cmd /c` on Windows (mirrors exec::build_command).
  let mut cmd = if cfg!(windows) {
    let mut c = Command::new("cmd");
    c.arg("/c").arg(&command).args(&args);
    c
  } else {
    let mut c = Command::new(&command);
    c.args(&args);
    c
  };
  for (k, v) in &env {
    cmd.env(k, v);
  }
  cmd
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());

  let mut child = match cmd.spawn() {
    Ok(c) => c,
    Err(_) => return Ok(ProbeResult::fail("spawn-failed", None)),
  };
  if let Some(stdin) = child.stdin.as_mut() {
    let _ = writeln!(stdin, "{}", initialize_body());
  }
  let stdout = match child.stdout.take() {
    Some(s) => s,
    None => {
      let _ = child.kill();
      return Ok(ProbeResult::fail("spawn-failed", None));
    }
  };

  let (tx, rx) = std::sync::mpsc::channel();
  std::thread::spawn(move || {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
      line.clear();
      match reader.read_line(&mut line) {
        Ok(0) => break,
        Ok(_) => {
          if line.contains("\"jsonrpc\"") {
            let _ = tx.send(line.clone());
            break;
          }
        }
        Err(_) => break,
      }
    }
  });

  let outcome = rx.recv_timeout(timeout);
  let _ = child.kill();
  let _ = child.wait();

  match outcome {
    Ok(line) => {
      let v: serde_json::Value =
        serde_json::from_str(line.trim()).unwrap_or(serde_json::Value::Null);
      match v.get("result") {
        Some(result) => Ok(ok_from_result(result, None)),
        None => Ok(ProbeResult::fail("not-mcp", None)),
      }
    }
    Err(_) => Ok(ProbeResult::fail("timeout", None)),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_raw_json_rpc() {
    let v = parse_jsonrpc(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}"#)
      .unwrap();
    assert!(v.get("result").is_some());
  }

  #[test]
  fn parses_sse_framed_json_rpc() {
    let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"x\"}}\n\n";
    let v = parse_jsonrpc(body).unwrap();
    assert_eq!(v["result"]["protocolVersion"], "x");
  }

  #[test]
  fn ok_from_result_reads_protocol_and_name() {
    let result = serde_json::json!({
      "protocolVersion": "2025-06-18",
      "serverInfo": { "name": "demo" }
    });
    let r = ok_from_result(&result, Some(5));
    assert!(r.ok);
    assert_eq!(r.protocol_version.as_deref(), Some("2025-06-18"));
    assert_eq!(r.server_name.as_deref(), Some("demo"));
  }

  #[test]
  fn non_mcp_body_yields_none() {
    assert!(parse_jsonrpc("<html>not mcp</html>").is_none());
  }
}
