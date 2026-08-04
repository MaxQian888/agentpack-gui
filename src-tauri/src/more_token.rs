//! Hardened more-token management and personal-account transport.
//!
//! The webview never receives either credential and cannot choose an
//! arbitrary URL, method, header, or proxy. It names a saved instance plus one
//! typed operation; this module owns every network decision.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use url::Url;

const STORE_FILE: &str = "more-token-instances.json";
const STORE_KEY: &str = "instances";
const MANAGEMENT_KEYRING_SERVICE: &str = "app.agentpack.more-token.management";
const PERSONAL_KEYRING_SERVICE: &str = "app.agentpack.more-token.personal";
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_CA_BYTES: u64 = 1024 * 1024;
const MAX_CONCURRENCY: usize = 6;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MoreTokenPackage {
  #[default]
  Management,
  Personal,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoreTokenInstance {
  pub id: String,
  pub name: String,
  pub base_url: String,
  pub ca_fingerprint: Option<String>,
  pub read_only: bool,
  pub display_currency: Option<String>,
  #[serde(default)]
  pub package: MoreTokenPackage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoreTokenInstanceDraft {
  pub id: String,
  pub name: String,
  pub base_url: String,
  pub read_only: bool,
  pub display_currency: Option<String>,
  pub custom_ca_path: Option<String>,
  #[serde(default)]
  pub clear_custom_ca: bool,
  #[serde(default)]
  pub package: MoreTokenPackage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingResult {
  pub token_id: u64,
  pub expires_at: i64,
  pub credential_persistent: bool,
}

#[derive(Clone, Debug)]
struct PendingPersonalOAuth {
  instance_id: String,
  device_code: String,
  client_id: String,
  expires_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalOAuthStartResult {
  pub handle: String,
  pub authorization_url: String,
  pub expires_at: i64,
  pub interval_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalOAuthPollResult {
  pub status: String,
  pub credential: Option<PairingResult>,
}

fn persist_personal_credential(
  instance_id: &str,
  response: ManagementHttpResponse,
) -> Result<PairingResult, String> {
  if response.status >= 400 {
    return Err(
      response
        .body
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("LOGIN_REJECTED")
        .to_string(),
    );
  }
  let data = response
    .body
    .get("data")
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let token = data
    .get("personal_token")
    .and_then(Value::as_str)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let token_id = data
    .get("token_id")
    .and_then(Value::as_u64)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let expires_at = data
    .get("expires_at")
    .and_then(Value::as_i64)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  Ok(PairingResult {
    token_id,
    expires_at,
    credential_persistent: store_token(MoreTokenPackage::Personal, instance_id, token),
  })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialState {
  pub connected: bool,
  pub persistent: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementHttpResponse {
  pub status: u16,
  pub body: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
  tag = "kind",
  rename_all = "camelCase",
  rename_all_fields = "camelCase"
)]
pub enum ManagementOperation {
  Capabilities,
  QuotaDisplay,
  UpdateQuotaDisplay {
    body: Value,
  },
  Overview,
  Accounts {
    page: u32,
    page_size: u32,
    search: Option<String>,
    lifecycle_state: Option<String>,
    master_id: Option<u64>,
  },
  CreateAccount {
    body: Value,
  },
  Account {
    id: u64,
  },
  ActionPreview {
    body: Value,
  },
  AccountAction {
    id: u64,
    action: String,
    body: Value,
  },
  CloseAccount {
    id: u64,
    body: Value,
  },
  QuotaSummary,
  QuotaTransfer {
    body: Value,
  },
  QuotaAdjustment {
    body: Value,
  },
  ReverseQuota {
    id: u64,
    body: Value,
  },
  QuotaOperation {
    operation_id: String,
  },
  QuotaTransactions {
    page: u32,
    page_size: u32,
  },
  CreateQuotaBatch {
    body: Value,
  },
  QuotaBatch {
    id: u64,
  },
  QuotaPolicy {
    master_id: Option<u64>,
  },
  UpdateQuotaPolicy {
    body: Value,
  },
  Analytics {
    start: i64,
    end: i64,
    account_id: Option<u64>,
    model: Option<String>,
    group: Option<String>,
    api_key: Option<String>,
    status: Option<String>,
    timezone: Option<String>,
  },
  AuditEvents {
    page: u32,
    page_size: u32,
  },
  AlertRules,
  CreateAlertRule {
    body: Value,
  },
  UpdateAlertRule {
    id: u64,
    body: Value,
  },
  DeleteAlertRule {
    id: u64,
  },
  AlertEvents {
    page: u32,
    page_size: u32,
    acknowledged: Option<bool>,
  },
  AcknowledgeAlert {
    id: u64,
  },
  Notifications,
  AcknowledgeNotification {
    id: u64,
  },
  PersonalCapabilities,
  PersonalOverview,
  PersonalProfile,
  UpdatePersonalProfile {
    body: Value,
  },
  ChangePersonalPassword {
    body: Value,
  },
  ClosePersonalAccount {
    body: Value,
  },
  PersonalBalance,
  PersonalLedger {
    page: u32,
    page_size: u32,
  },
  PersonalUsage {
    start: i64,
    end: i64,
    page: Option<u32>,
    page_size: Option<u32>,
    model: Option<String>,
    group: Option<String>,
    token_name: Option<String>,
    status: Option<String>,
  },
  PersonalModels,
  PersonalSessions,
  RevokePersonalSession {
    id: u64,
  },
  PersonalActivity {
    page: u32,
    page_size: u32,
  },
}

impl ManagementOperation {
  fn package(&self) -> MoreTokenPackage {
    match self {
      Self::PersonalCapabilities
      | Self::PersonalOverview
      | Self::PersonalProfile
      | Self::UpdatePersonalProfile { .. }
      | Self::ChangePersonalPassword { .. }
      | Self::ClosePersonalAccount { .. }
      | Self::PersonalBalance
      | Self::PersonalLedger { .. }
      | Self::PersonalUsage { .. }
      | Self::PersonalModels
      | Self::PersonalSessions
      | Self::RevokePersonalSession { .. }
      | Self::PersonalActivity { .. } => MoreTokenPackage::Personal,
      _ => MoreTokenPackage::Management,
    }
  }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Method {
  Get,
  Post,
  Put,
  Delete,
}

struct RequestSpec {
  method: Method,
  path: String,
  query: Vec<(String, String)>,
  body: Option<Value>,
  write: bool,
}

fn memory_tokens() -> &'static Mutex<HashMap<String, String>> {
  static TOKENS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
  TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pending_personal_oauth() -> &'static Mutex<HashMap<String, PendingPersonalOAuth>> {
  static AUTHORIZATIONS: OnceLock<Mutex<HashMap<String, PendingPersonalOAuth>>> = OnceLock::new();
  AUTHORIZATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn unix_now() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs() as i64
}

fn validate_personal_authorization_url(
  instance: &MoreTokenInstance,
  raw: &str,
) -> Result<String, String> {
  let base = Url::parse(&instance.base_url).map_err(|_| "INVALID_INSTANCE_URL".to_string())?;
  let target = base
    .join(raw)
    .map_err(|_| "INVALID_AUTHORIZATION_URL".to_string())?;
  if target.scheme() != base.scheme()
    || target.host_str() != base.host_str()
    || target.port_or_known_default() != base.port_or_known_default()
    || !target.username().is_empty()
    || target.password().is_some()
    || !["/profile", "/console/personal"].contains(&target.path())
  {
    return Err("INVALID_AUTHORIZATION_URL".into());
  }
  Ok(target.to_string())
}

fn active_requests() -> &'static Mutex<usize> {
  static ACTIVE: OnceLock<Mutex<usize>> = OnceLock::new();
  ACTIVE.get_or_init(|| Mutex::new(0))
}

struct RequestPermit;

impl RequestPermit {
  fn acquire() -> Result<Self, String> {
    let mut count = active_requests()
      .lock()
      .map_err(|_| "REQUEST_LIMIT".to_string())?;
    if *count >= MAX_CONCURRENCY {
      return Err("REQUEST_LIMIT".into());
    }
    *count += 1;
    Ok(Self)
  }
}

impl Drop for RequestPermit {
  fn drop(&mut self) {
    if let Ok(mut count) = active_requests().lock() {
      *count = count.saturating_sub(1);
    }
  }
}

fn normalize_base_url(input: &str) -> Result<String, String> {
  let mut url = Url::parse(input.trim()).map_err(|_| "INVALID_INSTANCE_URL".to_string())?;
  if !url.username().is_empty()
    || url.password().is_some()
    || url.query().is_some()
    || url.fragment().is_some()
  {
    return Err("INVALID_INSTANCE_URL".into());
  }
  let host = url
    .host_str()
    .ok_or_else(|| "INVALID_INSTANCE_URL".to_string())?;
  let ip_host = host.trim_matches(['[', ']']);
  let loopback = host.eq_ignore_ascii_case("localhost")
    || ip_host
      .parse::<std::net::IpAddr>()
      .map(|ip| ip.is_loopback())
      .unwrap_or(false);
  match url.scheme() {
    "https" => {}
    "http" if loopback => {}
    _ => return Err("HTTPS_REQUIRED".into()),
  }
  if url.path() != "/" && !url.path().is_empty() {
    return Err("INSTANCE_PATH_NOT_ALLOWED".into());
  }
  url.set_path("");
  let normalized = url.as_str().trim_end_matches('/').to_string();
  Ok(normalized)
}

fn validate_id(value: &str) -> Result<(), String> {
  if value.is_empty()
    || value.len() > 64
    || !value
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
  {
    return Err("INVALID_INSTANCE_ID".into());
  }
  Ok(())
}

fn load_instances(app: &AppHandle) -> Result<Vec<MoreTokenInstance>, String> {
  let store = app
    .store(STORE_FILE)
    .map_err(|_| "INSTANCE_STORE_UNAVAILABLE".to_string())?;
  match store.get(STORE_KEY) {
    Some(value) => serde_json::from_value(value).map_err(|_| "INSTANCE_STORE_INVALID".to_string()),
    None => Ok(Vec::new()),
  }
}

fn save_instances(app: &AppHandle, instances: &[MoreTokenInstance]) -> Result<(), String> {
  let store = app
    .store(STORE_FILE)
    .map_err(|_| "INSTANCE_STORE_UNAVAILABLE".to_string())?;
  let value = serde_json::to_value(instances).map_err(|_| "INSTANCE_STORE_INVALID".to_string())?;
  store.set(STORE_KEY, value);
  store
    .save()
    .map_err(|_| "INSTANCE_STORE_UNAVAILABLE".to_string())
}

fn ca_directory(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|_| "CA_STORE_UNAVAILABLE".to_string())?
    .join("more-token-ca");
  fs::create_dir_all(&dir).map_err(|_| "CA_STORE_UNAVAILABLE".to_string())?;
  Ok(dir)
}

fn ca_file(app: &AppHandle, instance_id: &str) -> Result<PathBuf, String> {
  validate_id(instance_id)?;
  Ok(ca_directory(app)?.join(format!("{instance_id}.pem")))
}

fn import_ca(app: &AppHandle, instance_id: &str, source: &str) -> Result<String, String> {
  let bytes = fs::read(source).map_err(|_| "CA_IMPORT_FAILED".to_string())?;
  if bytes.is_empty() || bytes.len() as u64 > MAX_CA_BYTES {
    return Err("CA_IMPORT_FAILED".into());
  }
  let mut reader = BufReader::new(bytes.as_slice());
  let certs: Vec<_> = rustls_pemfile::certs(&mut reader)
    .collect::<Result<Vec<_>, _>>()
    .map_err(|_| "CA_IMPORT_FAILED".to_string())?;
  if certs.is_empty() {
    return Err("CA_IMPORT_FAILED".into());
  }
  let fingerprint = Sha256::digest(&bytes)
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  fs::write(ca_file(app, instance_id)?, bytes).map_err(|_| "CA_STORE_UNAVAILABLE".to_string())?;
  Ok(fingerprint)
}

fn credential_key(package: MoreTokenPackage, instance_id: &str) -> String {
  format!("{:?}:{instance_id}", package).to_lowercase()
}

fn keyring_entry(
  package: MoreTokenPackage,
  instance_id: &str,
) -> Result<keyring::Entry, keyring::Error> {
  let service = match package {
    MoreTokenPackage::Management => MANAGEMENT_KEYRING_SERVICE,
    MoreTokenPackage::Personal => PERSONAL_KEYRING_SERVICE,
  };
  keyring::Entry::new(service, instance_id)
}

fn store_token(package: MoreTokenPackage, instance_id: &str, token: &str) -> bool {
  let memory_key = credential_key(package, instance_id);
  if let Ok(entry) = keyring_entry(package, instance_id) {
    if entry.set_password(token).is_ok() {
      if let Ok(mut tokens) = memory_tokens().lock() {
        tokens.remove(&memory_key);
      }
      return true;
    }
  }
  if let Ok(mut tokens) = memory_tokens().lock() {
    tokens.insert(memory_key, token.to_string());
  }
  false
}

fn load_token(package: MoreTokenPackage, instance_id: &str) -> Option<(String, bool)> {
  if let Ok(entry) = keyring_entry(package, instance_id) {
    if let Ok(token) = entry.get_password() {
      if !token.is_empty() {
        return Some((token, true));
      }
    }
  }
  memory_tokens()
    .lock()
    .ok()
    .and_then(|tokens| tokens.get(&credential_key(package, instance_id)).cloned())
    .map(|token| (token, false))
}

fn delete_token(package: MoreTokenPackage, instance_id: &str) {
  if let Ok(entry) = keyring_entry(package, instance_id) {
    let _ = entry.delete_credential();
  }
  if let Ok(mut tokens) = memory_tokens().lock() {
    tokens.remove(&credential_key(package, instance_id));
  }
}

fn bounded_page(page: u32, page_size: u32) -> Vec<(String, String)> {
  vec![
    ("page".into(), page.max(1).to_string()),
    ("page_size".into(), page_size.clamp(1, 200).to_string()),
  ]
}

fn require_id(id: u64) -> Result<u64, String> {
  if id == 0 {
    Err("INVALID_OPERATION".into())
  } else {
    Ok(id)
  }
}

fn operation_spec(
  package: MoreTokenPackage,
  operation: ManagementOperation,
) -> Result<RequestSpec, String> {
  if operation.package() != package {
    return Err("PACKAGE_OPERATION_MISMATCH".into());
  }
  let spec = match operation {
    ManagementOperation::Capabilities => (
      Method::Get,
      "/api/management/capabilities".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::QuotaDisplay => (
      Method::Get,
      "/api/management/quota-display".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::UpdateQuotaDisplay { body } => (
      Method::Put,
      "/api/management/quota-display".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::Overview => (
      Method::Get,
      "/api/distribution/overview".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::Accounts {
      page,
      page_size,
      search,
      lifecycle_state,
      master_id,
    } => {
      let mut query = bounded_page(page, page_size);
      if let Some(value) = search.filter(|v| !v.trim().is_empty()) {
        query.push(("search".into(), value));
      }
      if let Some(value) =
        lifecycle_state.filter(|v| ["active", "closing", "archived"].contains(&v.as_str()))
      {
        query.push(("lifecycle_state".into(), value));
      }
      if let Some(value) = master_id {
        query.push(("master_id".into(), value.to_string()));
      }
      (
        Method::Get,
        "/api/distribution/accounts".into(),
        query,
        None,
        false,
      )
    }
    ManagementOperation::CreateAccount { body } => (
      Method::Post,
      "/api/distribution/accounts".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::Account { id } => (
      Method::Get,
      format!("/api/distribution/accounts/{}", require_id(id)?),
      vec![],
      None,
      false,
    ),
    ManagementOperation::ActionPreview { body } => (
      Method::Post,
      "/api/distribution/action-previews".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::AccountAction { id, action, body } => {
      if ![
        "enable", "disable", "archive", "restore", "attach", "detach", "promote", "demote",
        "password",
      ]
      .contains(&action.as_str())
      {
        return Err("INVALID_OPERATION".into());
      }
      (
        Method::Post,
        format!("/api/distribution/accounts/{}/{action}", require_id(id)?),
        vec![],
        Some(body),
        true,
      )
    }
    ManagementOperation::CloseAccount { id, body } => (
      Method::Post,
      format!("/api/distribution/accounts/{}/close", require_id(id)?),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::QuotaSummary => (
      Method::Get,
      "/api/distribution/quota/summary".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::QuotaTransfer { body } => (
      Method::Post,
      "/api/distribution/quota/transfers".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::QuotaAdjustment { body } => (
      Method::Post,
      "/api/distribution/quota/adjustments".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::ReverseQuota { id, body } => (
      Method::Post,
      format!(
        "/api/distribution/quota/transactions/{}/reverse",
        require_id(id)?
      ),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::QuotaOperation { operation_id } => {
      if operation_id.is_empty()
        || operation_id.len() > 64
        || !operation_id
          .chars()
          .all(|c| c.is_ascii_alphanumeric() || c == '-')
      {
        return Err("INVALID_OPERATION".into());
      }
      (
        Method::Get,
        format!("/api/distribution/quota/operations/{operation_id}"),
        vec![],
        None,
        false,
      )
    }
    ManagementOperation::QuotaTransactions { page, page_size } => (
      Method::Get,
      "/api/distribution/quota/transactions".into(),
      bounded_page(page, page_size),
      None,
      false,
    ),
    ManagementOperation::CreateQuotaBatch { body } => (
      Method::Post,
      "/api/distribution/quota/batches".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::QuotaBatch { id } => (
      Method::Get,
      format!("/api/distribution/quota/batches/{}", require_id(id)?),
      vec![],
      None,
      false,
    ),
    ManagementOperation::QuotaPolicy { master_id } => {
      let query = master_id
        .map(|v| vec![("master_id".into(), v.to_string())])
        .unwrap_or_default();
      (
        Method::Get,
        "/api/distribution/quota/policies".into(),
        query,
        None,
        false,
      )
    }
    ManagementOperation::UpdateQuotaPolicy { body } => (
      Method::Put,
      "/api/distribution/quota/policies".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::Analytics {
      start,
      end,
      account_id,
      model,
      group,
      api_key,
      status,
      timezone,
    } => {
      let mut query = vec![
        ("start".into(), start.to_string()),
        ("end".into(), end.to_string()),
      ];
      if let Some(v) = account_id {
        query.push(("account_id".into(), v.to_string()));
      }
      for (key, value) in [
        ("model", model),
        ("group", group),
        ("api_key", api_key),
        ("status", status),
        ("timezone", timezone),
      ] {
        if let Some(v) = value.filter(|v| !v.trim().is_empty()) {
          query.push((key.into(), v));
        }
      }
      (
        Method::Get,
        "/api/distribution/analytics".into(),
        query,
        None,
        false,
      )
    }
    ManagementOperation::AuditEvents { page, page_size } => (
      Method::Get,
      "/api/distribution/audit-events".into(),
      bounded_page(page, page_size),
      None,
      false,
    ),
    ManagementOperation::AlertRules => (
      Method::Get,
      "/api/distribution/alert-rules".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::CreateAlertRule { body } => (
      Method::Post,
      "/api/distribution/alert-rules".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::UpdateAlertRule { id, body } => (
      Method::Put,
      format!("/api/distribution/alert-rules/{}", require_id(id)?),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::DeleteAlertRule { id } => (
      Method::Delete,
      format!("/api/distribution/alert-rules/{}", require_id(id)?),
      vec![],
      None,
      true,
    ),
    ManagementOperation::AlertEvents {
      page,
      page_size,
      acknowledged,
    } => {
      let mut query = bounded_page(page, page_size);
      if let Some(v) = acknowledged {
        query.push(("acknowledged".into(), v.to_string()));
      }
      (
        Method::Get,
        "/api/distribution/alert-events".into(),
        query,
        None,
        false,
      )
    }
    ManagementOperation::AcknowledgeAlert { id } => (
      Method::Post,
      format!("/api/distribution/alert-events/{}/ack", require_id(id)?),
      vec![],
      None,
      true,
    ),
    ManagementOperation::Notifications => (
      Method::Get,
      "/api/distribution/notifications".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::AcknowledgeNotification { id } => (
      Method::Post,
      format!("/api/distribution/notifications/{}/ack", require_id(id)?),
      vec![],
      None,
      true,
    ),
    ManagementOperation::PersonalCapabilities => (
      Method::Get,
      "/api/personal/capabilities".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::PersonalOverview => (
      Method::Get,
      "/api/personal/overview".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::PersonalProfile => (
      Method::Get,
      "/api/personal/profile".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::UpdatePersonalProfile { body } => (
      Method::Put,
      "/api/personal/profile".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::ChangePersonalPassword { body } => (
      Method::Post,
      "/api/personal/password".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::ClosePersonalAccount { body } => (
      Method::Post,
      "/api/personal/account/close".into(),
      vec![],
      Some(body),
      true,
    ),
    ManagementOperation::PersonalBalance => (
      Method::Get,
      "/api/personal/balance".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::PersonalLedger { page, page_size } => (
      Method::Get,
      "/api/personal/ledger".into(),
      bounded_page(page, page_size),
      None,
      false,
    ),
    ManagementOperation::PersonalUsage {
      start,
      end,
      page,
      page_size,
      model,
      group,
      token_name,
      status,
    } => {
      let mut query = bounded_page(page.unwrap_or(1), page_size.unwrap_or(25));
      query.push(("start".into(), start.to_string()));
      query.push(("end".into(), end.to_string()));
      if let Some(model) = model.map(|value| value.trim().to_string()) {
        if model.len() > 255 {
          return Err("INVALID_MODEL".into());
        }
        if !model.is_empty() {
          query.push(("model".into(), model));
        }
      }
      if let Some(group) = group.map(|value| value.trim().to_string()) {
        if group.len() > 64 {
          return Err("INVALID_GROUP".into());
        }
        if !group.is_empty() {
          query.push(("group".into(), group));
        }
      }
      if let Some(token_name) = token_name.map(|value| value.trim().to_string()) {
        if token_name.len() > 255 {
          return Err("INVALID_TOKEN_NAME".into());
        }
        if !token_name.is_empty() {
          query.push(("token_name".into(), token_name));
        }
      }
      if let Some(status) = status.map(|value| value.trim().to_string()) {
        if !["billable", "success", "refund", "error", "all"].contains(&status.as_str()) {
          return Err("INVALID_STATUS".into());
        }
        if !status.is_empty() {
          query.push(("status".into(), status));
        }
      }
      (
        Method::Get,
        "/api/personal/usage".into(),
        query,
        None,
        false,
      )
    }
    ManagementOperation::PersonalModels => (
      Method::Get,
      "/api/personal/models".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::PersonalSessions => (
      Method::Get,
      "/api/personal/sessions".into(),
      vec![],
      None,
      false,
    ),
    ManagementOperation::RevokePersonalSession { id } => (
      Method::Delete,
      format!("/api/personal/sessions/{}", require_id(id)?),
      vec![],
      None,
      true,
    ),
    ManagementOperation::PersonalActivity { page, page_size } => (
      Method::Get,
      "/api/personal/activity".into(),
      bounded_page(page, page_size),
      None,
      false,
    ),
  };
  Ok(RequestSpec {
    method: spec.0,
    path: spec.1,
    query: spec.2,
    body: spec.3,
    write: spec.4,
  })
}

fn build_agent(app: &AppHandle, instance: &MoreTokenInstance) -> Result<ureq::Agent, String> {
  let mut builder = ureq::AgentBuilder::new()
    .redirects(0)
    .timeout_connect(Duration::from_secs(5))
    .timeout_read(Duration::from_secs(15))
    .timeout_write(Duration::from_secs(15))
    .user_agent("agentpack-more-token/1");
  if instance.ca_fingerprint.is_some() {
    let pem =
      fs::read(ca_file(app, &instance.id)?).map_err(|_| "CA_STORE_UNAVAILABLE".to_string())?;
    let mut reader = BufReader::new(pem.as_slice());
    let certs = rustls_pemfile::certs(&mut reader)
      .collect::<Result<Vec<_>, _>>()
      .map_err(|_| "CA_IMPORT_FAILED".to_string())?;
    let mut roots = ureq::rustls::RootCertStore {
      roots: webpki_roots::TLS_SERVER_ROOTS.iter().cloned().collect(),
    };
    let (added, _) = roots.add_parsable_certificates(certs);
    if added == 0 {
      return Err("CA_IMPORT_FAILED".into());
    }
    let config = ureq::rustls::ClientConfig::builder()
      .with_root_certificates(roots)
      .with_no_client_auth();
    builder = builder.tls_config(Arc::new(config));
  }
  Ok(builder.build())
}

fn read_response(response: ureq::Response) -> Result<ManagementHttpResponse, String> {
  let status = response.status();
  let mut reader = response.into_reader().take(MAX_RESPONSE_BYTES + 1);
  let mut bytes = Vec::new();
  reader
    .read_to_end(&mut bytes)
    .map_err(|_| "RESPONSE_READ_FAILED".to_string())?;
  if bytes.len() as u64 > MAX_RESPONSE_BYTES {
    return Err("RESPONSE_TOO_LARGE".into());
  }
  let body = serde_json::from_slice(&bytes).map_err(|_| "INVALID_SERVER_RESPONSE".to_string())?;
  Ok(ManagementHttpResponse { status, body })
}

fn execute(
  app: &AppHandle,
  instance: &MoreTokenInstance,
  spec: RequestSpec,
  token: Option<&str>,
) -> Result<ManagementHttpResponse, String> {
  let _permit = RequestPermit::acquire()?;
  if spec.write && instance.read_only {
    return Err("INSTANCE_READ_ONLY".into());
  }
  let mut url = Url::parse(&format!("{}{}", instance.base_url, spec.path))
    .map_err(|_| "INVALID_INSTANCE_URL".to_string())?;
  if !spec.query.is_empty() {
    url.query_pairs_mut().extend_pairs(spec.query);
  }
  let agent = build_agent(app, instance)?;
  let request = match spec.method {
    Method::Get => agent.get(url.as_str()),
    Method::Post => agent.post(url.as_str()),
    Method::Put => agent.put(url.as_str()),
    Method::Delete => agent.delete(url.as_str()),
  }
  .set("Accept", "application/json")
  .set("Content-Type", "application/json");
  let request = if let Some(value) = token {
    request.set("Authorization", &format!("Bearer {value}"))
  } else {
    request
  };
  let result = if let Some(body) = spec.body {
    let encoded = serde_json::to_string(&body).map_err(|_| "INVALID_REQUEST".to_string())?;
    if encoded.len() > MAX_REQUEST_BYTES {
      return Err("REQUEST_TOO_LARGE".into());
    }
    request.send_string(&encoded)
  } else {
    request.call()
  };
  match result {
    Ok(response) => read_response(response),
    Err(ureq::Error::Status(_, response)) => read_response(response),
    Err(ureq::Error::Transport(error)) => Err(format!("NETWORK_{}", error.kind())),
  }
}

fn find_instance(app: &AppHandle, id: &str) -> Result<MoreTokenInstance, String> {
  load_instances(app)?
    .into_iter()
    .find(|instance| instance.id == id)
    .ok_or_else(|| "INSTANCE_NOT_FOUND".to_string())
}

#[tauri::command]
pub fn more_token_list_instances(app: AppHandle) -> Result<Vec<MoreTokenInstance>, String> {
  load_instances(&app)
}

#[tauri::command]
pub fn more_token_save_instance(
  app: AppHandle,
  draft: MoreTokenInstanceDraft,
) -> Result<MoreTokenInstance, String> {
  validate_id(&draft.id)?;
  if draft.name.trim().is_empty() || draft.name.len() > 128 {
    return Err("INVALID_INSTANCE_NAME".into());
  }
  let mut instances = load_instances(&app)?;
  let existing = instances.iter().find(|item| item.id == draft.id).cloned();
  if existing
    .as_ref()
    .is_some_and(|current| current.package != draft.package)
  {
    return Err("INSTANCE_PACKAGE_IMMUTABLE".into());
  }
  let ca_fingerprint = if draft.clear_custom_ca {
    let _ = fs::remove_file(ca_file(&app, &draft.id)?);
    None
  } else if let Some(path) = draft
    .custom_ca_path
    .as_deref()
    .filter(|v| !v.trim().is_empty())
  {
    Some(import_ca(&app, &draft.id, path)?)
  } else {
    existing.and_then(|value| value.ca_fingerprint)
  };
  let instance = MoreTokenInstance {
    id: draft.id,
    name: draft.name.trim().to_string(),
    base_url: normalize_base_url(&draft.base_url)?,
    ca_fingerprint,
    read_only: draft.read_only,
    display_currency: draft
      .display_currency
      .map(|value| value.trim().to_uppercase())
      .filter(|value| !value.is_empty()),
    package: draft.package,
  };
  instances.retain(|item| item.id != instance.id);
  instances.push(instance.clone());
  instances.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  save_instances(&app, &instances)?;
  Ok(instance)
}

#[tauri::command]
pub fn more_token_remove_instance(app: AppHandle, instance_id: String) -> Result<(), String> {
  validate_id(&instance_id)?;
  let mut instances = load_instances(&app)?;
  let package = instances
    .iter()
    .find(|item| item.id == instance_id)
    .map(|item| item.package)
    .ok_or_else(|| "INSTANCE_NOT_FOUND".to_string())?;
  instances.retain(|item| item.id != instance_id);
  save_instances(&app, &instances)?;
  delete_token(package, &instance_id);
  let _ = fs::remove_file(ca_file(&app, &instance_id)?);
  Ok(())
}

#[tauri::command]
pub fn more_token_credential_state(
  app: AppHandle,
  instance_id: String,
) -> Result<CredentialState, String> {
  validate_id(&instance_id)?;
  let instance = find_instance(&app, &instance_id)?;
  let state = load_token(instance.package, &instance_id);
  Ok(CredentialState {
    connected: state.is_some(),
    persistent: state.map(|(_, persistent)| persistent).unwrap_or(false),
  })
}

#[tauri::command]
pub fn more_token_forget_credential(app: AppHandle, instance_id: String) -> Result<(), String> {
  validate_id(&instance_id)?;
  let instance = find_instance(&app, &instance_id)?;
  delete_token(instance.package, &instance_id);
  Ok(())
}

#[tauri::command]
pub async fn more_token_pair(
  app: AppHandle,
  instance_id: String,
  pairing_code: String,
  client_id: String,
) -> Result<PairingResult, String> {
  validate_id(&instance_id)?;
  let instance = find_instance(&app, &instance_id)?;
  let code = pairing_code.trim().to_uppercase();
  let compact = code.replace('-', "");
  if compact.len() != 10
    || !compact
      .chars()
      .all(|value| matches!(value, 'A'..='Z' | '2'..='7'))
    || client_id.trim().is_empty()
    || client_id.len() > 128
  {
    return Err("INVALID_PAIRING_CODE".into());
  }
  let body = json!({"pairing_code": code, "client_id": client_id.trim()});
  let (pair_path, token_field) = match instance.package {
    MoreTokenPackage::Management => ("/api/management/pair", "management_token"),
    MoreTokenPackage::Personal => ("/api/personal/pair", "personal_token"),
  };
  let package = instance.package;
  let app_for_request = app.clone();
  let response = tauri::async_runtime::spawn_blocking(move || {
    execute(
      &app_for_request,
      &instance,
      RequestSpec {
        method: Method::Post,
        path: pair_path.into(),
        query: vec![],
        body: Some(body),
        write: false,
      },
      None,
    )
  })
  .await
  .map_err(|_| "NETWORK_ERROR".to_string())??;
  if response.status >= 400 {
    return Err("PAIRING_REJECTED".into());
  }
  let data = response
    .body
    .get("data")
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let token = data
    .get(token_field)
    .and_then(Value::as_str)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let token_id = data
    .get("token_id")
    .and_then(Value::as_u64)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let expires_at = data
    .get("expires_at")
    .and_then(Value::as_i64)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let credential_persistent = store_token(package, &instance_id, token);
  Ok(PairingResult {
    token_id,
    expires_at,
    credential_persistent,
  })
}

#[tauri::command]
pub async fn more_token_personal_login(
  app: AppHandle,
  instance_id: String,
  username: String,
  password: String,
  two_factor_code: Option<String>,
  client_id: String,
  client_label: String,
) -> Result<PairingResult, String> {
  validate_id(&instance_id)?;
  let instance = find_instance(&app, &instance_id)?;
  if instance.package != MoreTokenPackage::Personal {
    return Err("PACKAGE_OPERATION_MISMATCH".into());
  }
  if username.trim().is_empty()
    || password.is_empty()
    || client_id.trim().is_empty()
    || client_id.len() > 128
    || client_label.trim().is_empty()
    || client_label.len() > 128
  {
    return Err("INVALID_LOGIN_REQUEST".into());
  }
  let body = json!({
    "username": username.trim(),
    "password": password,
    "two_factor_code": two_factor_code.unwrap_or_default().trim(),
    "client_id": client_id.trim(),
    "client_label": client_label.trim(),
  });
  let app_for_request = app.clone();
  let response = tauri::async_runtime::spawn_blocking(move || {
    execute(
      &app_for_request,
      &instance,
      RequestSpec {
        method: Method::Post,
        path: "/api/personal/login".into(),
        query: vec![],
        body: Some(body),
        write: false,
      },
      None,
    )
  })
  .await
  .map_err(|_| "NETWORK_ERROR".to_string())??;
  persist_personal_credential(&instance_id, response)
}

#[tauri::command]
pub async fn more_token_personal_oauth_start(
  app: AppHandle,
  instance_id: String,
  client_id: String,
  client_label: String,
) -> Result<PersonalOAuthStartResult, String> {
  validate_id(&instance_id)?;
  let instance = find_instance(&app, &instance_id)?;
  if instance.package != MoreTokenPackage::Personal {
    return Err("PACKAGE_OPERATION_MISMATCH".into());
  }
  if client_id != "agentpack-personal-desktop"
    || client_label.trim().is_empty()
    || client_label.len() > 128
  {
    return Err("INVALID_OAUTH_REQUEST".into());
  }
  let body = json!({
    "client_id": client_id,
    "client_label": client_label.trim(),
    "scopes": [],
  });
  let app_for_request = app.clone();
  let request_instance = instance.clone();
  let response = tauri::async_runtime::spawn_blocking(move || {
    execute(
      &app_for_request,
      &request_instance,
      RequestSpec {
        method: Method::Post,
        path: "/api/personal/oauth/device/authorize".into(),
        query: vec![],
        body: Some(body),
        write: false,
      },
      None,
    )
  })
  .await
  .map_err(|_| "NETWORK_ERROR".to_string())??;
  if response.status >= 400 {
    return Err(
      response
        .body
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("OAUTH_START_REJECTED")
        .to_string(),
    );
  }
  let device_code = response
    .body
    .get("device_code")
    .and_then(Value::as_str)
    .filter(|value| value.len() >= 40)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?
    .to_string();
  let raw_authorization_url = response
    .body
    .get("verification_uri_complete_path")
    .or_else(|| response.body.get("verification_uri_complete"))
    .and_then(Value::as_str)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let authorization_url = validate_personal_authorization_url(&instance, raw_authorization_url)?;
  let expires_in = response
    .body
    .get("expires_in")
    .and_then(Value::as_i64)
    .unwrap_or(600)
    .clamp(60, 600);
  let interval_seconds = response
    .body
    .get("interval")
    .and_then(Value::as_u64)
    .unwrap_or(3)
    .clamp(3, 15);
  let handle = Sha256::digest(format!("{}:{}", instance_id, device_code).as_bytes())
    .iter()
    .take(16)
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  let expires_at = unix_now() + expires_in;
  pending_personal_oauth()
    .lock()
    .map_err(|_| "OAUTH_STATE_UNAVAILABLE".to_string())?
    .insert(
      handle.clone(),
      PendingPersonalOAuth {
        instance_id,
        device_code,
        client_id: "agentpack-personal-desktop".into(),
        expires_at,
      },
    );
  Ok(PersonalOAuthStartResult {
    handle,
    authorization_url,
    expires_at,
    interval_seconds,
  })
}

#[tauri::command]
pub async fn more_token_personal_oauth_poll(
  app: AppHandle,
  instance_id: String,
  handle: String,
) -> Result<PersonalOAuthPollResult, String> {
  validate_id(&instance_id)?;
  if handle.len() != 32 || !handle.chars().all(|value| value.is_ascii_hexdigit()) {
    return Err("INVALID_OAUTH_HANDLE".into());
  }
  let pending = pending_personal_oauth()
    .lock()
    .map_err(|_| "OAUTH_STATE_UNAVAILABLE".to_string())?
    .get(&handle)
    .cloned()
    .ok_or_else(|| "OAUTH_STATE_NOT_FOUND".to_string())?;
  if pending.instance_id != instance_id {
    return Err("OAUTH_STATE_NOT_FOUND".into());
  }
  if pending.expires_at <= unix_now() {
    pending_personal_oauth()
      .lock()
      .ok()
      .map(|mut values| values.remove(&handle));
    return Err("expired_token".into());
  }
  let instance = find_instance(&app, &instance_id)?;
  if instance.package != MoreTokenPackage::Personal {
    return Err("PACKAGE_OPERATION_MISMATCH".into());
  }
  let body = json!({
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": pending.device_code,
    "client_id": pending.client_id,
  });
  let app_for_request = app.clone();
  let response = tauri::async_runtime::spawn_blocking(move || {
    execute(
      &app_for_request,
      &instance,
      RequestSpec {
        method: Method::Post,
        path: "/api/personal/oauth/token".into(),
        query: vec![],
        body: Some(body),
        write: false,
      },
      None,
    )
  })
  .await
  .map_err(|_| "NETWORK_ERROR".to_string())??;
  if response.status >= 400 {
    let status = response
      .body
      .get("error")
      .and_then(Value::as_str)
      .unwrap_or("OAUTH_REJECTED");
    if ["authorization_pending", "slow_down"].contains(&status) {
      return Ok(PersonalOAuthPollResult {
        status: status.to_string(),
        credential: None,
      });
    }
    pending_personal_oauth()
      .lock()
      .ok()
      .map(|mut values| values.remove(&handle));
    return Err(status.to_string());
  }
  let token = response
    .body
    .get("access_token")
    .and_then(Value::as_str)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let token_id = response
    .body
    .get("token_id")
    .and_then(Value::as_u64)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let expires_at = response
    .body
    .get("expires_at")
    .and_then(Value::as_i64)
    .ok_or_else(|| "INVALID_SERVER_RESPONSE".to_string())?;
  let credential = PairingResult {
    token_id,
    expires_at,
    credential_persistent: store_token(MoreTokenPackage::Personal, &instance_id, token),
  };
  pending_personal_oauth()
    .lock()
    .ok()
    .map(|mut values| values.remove(&handle));
  Ok(PersonalOAuthPollResult {
    status: "authorized".into(),
    credential: Some(credential),
  })
}

#[tauri::command]
pub fn more_token_personal_oauth_cancel(instance_id: String, handle: String) -> Result<(), String> {
  validate_id(&instance_id)?;
  let mut values = pending_personal_oauth()
    .lock()
    .map_err(|_| "OAUTH_STATE_UNAVAILABLE".to_string())?;
  if values
    .get(&handle)
    .map(|pending| pending.instance_id.as_str())
    != Some(instance_id.as_str())
  {
    return Err("OAUTH_STATE_NOT_FOUND".into());
  }
  values.remove(&handle);
  Ok(())
}

#[tauri::command]
pub async fn more_token_request(
  app: AppHandle,
  instance_id: String,
  operation: ManagementOperation,
) -> Result<ManagementHttpResponse, String> {
  validate_id(&instance_id)?;
  let instance = find_instance(&app, &instance_id)?;
  let spec = operation_spec(instance.package, operation)?;
  let (token, _) = load_token(instance.package, &instance_id)
    .ok_or_else(|| "PACKAGE_CREDENTIAL_REQUIRED".to_string())?;
  let app_for_request = app.clone();
  tauri::async_runtime::spawn_blocking(move || {
    execute(&app_for_request, &instance, spec, Some(&token))
  })
  .await
  .map_err(|_| "NETWORK_ERROR".to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn url_policy_accepts_https_and_loopback_http_only() {
    assert_eq!(
      normalize_base_url("https://EXAMPLE.com/").unwrap(),
      "https://example.com"
    );
    assert!(normalize_base_url("http://127.0.0.1:3000").is_ok());
    assert!(normalize_base_url("http://[::1]:3000").is_ok());
    assert!(normalize_base_url("http://example.com").is_err());
    assert!(normalize_base_url("https://example.com/api").is_err());
    assert!(normalize_base_url("https://user:pass@example.com").is_err());
  }

  #[test]
  fn operation_mapping_cannot_escape_allowlist() {
    let valid = operation_spec(
      MoreTokenPackage::Management,
      ManagementOperation::AccountAction {
        id: 7,
        action: "archive".into(),
        body: json!({}),
      },
    )
    .unwrap();
    assert_eq!(valid.path, "/api/distribution/accounts/7/archive");
    assert_eq!(valid.method, Method::Post);
    assert!(valid.write);
    assert!(operation_spec(
      MoreTokenPackage::Management,
      ManagementOperation::AccountAction {
        id: 7,
        action: "../../tokens".into(),
        body: json!({})
      }
    )
    .is_err());
    assert!(operation_spec(
      MoreTokenPackage::Personal,
      ManagementOperation::Accounts {
        page: 1,
        page_size: 20,
        search: None,
        lifecycle_state: None,
        master_id: None,
      },
    )
    .is_err());
    assert_eq!(
      operation_spec(
        MoreTokenPackage::Personal,
        ManagementOperation::PersonalLedger {
          page: 1,
          page_size: 20,
        },
      )
      .unwrap()
      .path,
      "/api/personal/ledger"
    );
    assert_eq!(
      operation_spec(
        MoreTokenPackage::Personal,
        ManagementOperation::PersonalModels,
      )
      .unwrap()
      .path,
      "/api/personal/models"
    );
  }

  #[test]
  fn personal_usage_mapping_keeps_filters_on_the_allowlisted_path() {
    let operation: ManagementOperation = serde_json::from_value(json!({
      "kind": "personalUsage",
      "start": 1_700_000_000,
      "end": 1_700_086_400,
      "model": "gpt-5",
      "group": "premium",
      "tokenName": "Desktop Key",
      "status": "success",
      "page": 2,
      "pageSize": 25
    }))
    .unwrap();

    let spec = operation_spec(MoreTokenPackage::Personal, operation).unwrap();

    assert_eq!(spec.path, "/api/personal/usage");
    assert_eq!(spec.method, Method::Get);
    assert!(!spec.write);
    assert_eq!(
      spec.query,
      vec![
        ("page".into(), "2".into()),
        ("page_size".into(), "25".into()),
        ("start".into(), "1700000000".into()),
        ("end".into(), "1700086400".into()),
        ("model".into(), "gpt-5".into()),
        ("group".into(), "premium".into()),
        ("token_name".into(), "Desktop Key".into()),
        ("status".into(), "success".into()),
      ]
    );
  }

  #[test]
  fn browser_authorization_url_stays_on_the_saved_instance() {
    let instance = MoreTokenInstance {
      id: "personal".into(),
      name: "Personal".into(),
      base_url: "https://more-token.example.com".into(),
      ca_fingerprint: None,
      read_only: false,
      display_currency: None,
      package: MoreTokenPackage::Personal,
    };
    assert!(validate_personal_authorization_url(
      &instance,
      "/profile?desktop_authorization=ABCDE-FGHIJ"
    )
    .is_ok());
    assert!(validate_personal_authorization_url(
      &instance,
      "https://evil.example/profile?desktop_authorization=ABCDE-FGHIJ"
    )
    .is_err());
    assert!(
      validate_personal_authorization_url(&instance, "https://more-token.example.com/admin")
        .is_err()
    );
  }

  #[test]
  fn query_values_are_encoded_not_interpolated() {
    let spec = operation_spec(
      MoreTokenPackage::Management,
      ManagementOperation::Accounts {
        page: 0,
        page_size: 999,
        search: Some("a&role=root".into()),
        lifecycle_state: None,
        master_id: None,
      },
    )
    .unwrap();
    let mut url = Url::parse("https://example.com/api/distribution/accounts").unwrap();
    url.query_pairs_mut().extend_pairs(spec.query);
    assert!(url.as_str().contains("search=a%26role%3Droot"));
    assert!(url.as_str().contains("page_size=200"));
  }

  #[test]
  fn response_cap_rejects_oversized_bodies() {
    let body = "x".repeat((MAX_RESPONSE_BYTES + 1) as usize);
    let response = ureq::Response::new(200, "OK", &body).unwrap();
    assert_eq!(read_response(response).unwrap_err(), "RESPONSE_TOO_LARGE");
  }
}
