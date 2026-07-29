use serde::Serialize;
use std::path::Path;

/// Read-only view of each agent CLI's *own* login, shown next to the provider
/// list so "official login" is a state the user can see rather than infer.
///
/// This module never returns a credential and never writes one. That shapes what
/// it can report per platform:
///
/// - **Claude on macOS** keeps its OAuth tokens in the login Keychain, under the
///   `Claude Code-credentials` service. Extracting the value there means calling
///   `security` with `-w`/`-g`, which pops an "agentpack wants to use your
///   confidential information" prompt and hands us the refresh token — for a
///   status badge. So we only ask whether the item *exists* (no flag, no
///   prompt), and report plan/expiry as unknown.
/// - **Claude elsewhere** stores the same JSON in `~/.claude/.credentials.json`,
///   a plain file we already sit next to. There the non-secret fields
///   (`subscriptionType`, `expiresAt`) come for free.
/// - **Codex** records an explicit `auth_mode` in `~/.codex/auth.json`, which is
///   the field that actually decides whether a relay takes effect at all. Only
///   that field and the presence of the token bundle are read.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
  /// Whether the CLI has an official login at all.
  signed_in: bool,
  /// Codex's explicit `auth_mode` ("chatgpt", "apikey", …), when it sets one.
  mode: Option<String>,
  /// Subscription tier, where the platform stores it somewhere readable.
  plan: Option<String>,
  /// Unix-ms expiry, where readable.
  expires_at: Option<i64>,
  /// Where the answer came from, so the UI can explain an "unknown".
  source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginReport {
  claude: LoginStatus,
  codex: LoginStatus,
}

/// Keychain service name Claude Code writes its OAuth bundle under.
const CLAUDE_KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

/// Is the Keychain item there? `find-generic-password` without `-w`/`-g` prints
/// only attributes, so this answers "signed in?" without unlocking the secret
/// and without prompting the user.
#[cfg(target_os = "macos")]
fn claude_keychain_present() -> bool {
  std::process::Command::new("security")
    .args(["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()
    .map(|s| s.success())
    .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn claude_keychain_present() -> bool {
  false
}

fn claude_login(home: &Path) -> LoginStatus {
  let path = home.join(".claude/.credentials.json");
  if let Ok(text) = std::fs::read_to_string(&path) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
      let oauth = &v["claudeAiOauth"];
      let signed_in = oauth.get("accessToken").and_then(|t| t.as_str()).is_some();
      return LoginStatus {
        signed_in,
        mode: signed_in.then(|| "oauth".to_string()),
        plan: oauth["subscriptionType"].as_str().map(str::to_string),
        expires_at: oauth["expiresAt"].as_i64(),
        source: ".credentials.json".into(),
      };
    }
  }
  if claude_keychain_present() {
    // Plan and expiry stay None on purpose — see the module comment.
    return LoginStatus {
      signed_in: true,
      mode: Some("oauth".into()),
      source: "macOS Keychain".into(),
      ..Default::default()
    };
  }
  LoginStatus {
    source: "not signed in".into(),
    ..Default::default()
  }
}

fn codex_login(home: &Path) -> LoginStatus {
  let path = crate::paths::codex_home(home).join("auth.json");
  let Ok(text) = std::fs::read_to_string(&path) else {
    return LoginStatus {
      source: "not signed in".into(),
      ..Default::default()
    };
  };
  let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
    return LoginStatus {
      source: "auth.json unreadable".into(),
      ..Default::default()
    };
  };
  let mode = v["auth_mode"].as_str().map(str::to_string);
  let has_tokens = v["tokens"]["refresh_token"].as_str().is_some();
  let has_key = v["OPENAI_API_KEY"].as_str().is_some_and(|k| !k.is_empty());
  LoginStatus {
    signed_in: has_tokens || has_key,
    mode,
    plan: None,
    expires_at: None,
    source: "auth.json".into(),
  }
}

#[tauri::command(async)]
pub fn login_status() -> Result<LoginReport, String> {
  let home = dirs::home_dir().unwrap_or_default();
  Ok(LoginReport {
    claude: claude_login(&home),
    codex: codex_login(&home),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tmp_home(tag: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!(
      "aplogin-{tag}-{}",
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
    ));
    std::fs::create_dir_all(p.join(".claude")).unwrap();
    std::fs::create_dir_all(p.join(".codex")).unwrap();
    p
  }

  #[test]
  fn claude_credentials_file_yields_plan_and_expiry() {
    let home = tmp_home("claude");
    std::fs::write(
      home.join(".claude/.credentials.json"),
      r#"{"claudeAiOauth":{"accessToken":"x","subscriptionType":"max","expiresAt":1785258233624}}"#,
    )
    .unwrap();

    let st = claude_login(&home);
    assert!(st.signed_in);
    assert_eq!(st.plan.as_deref(), Some("max"));
    assert_eq!(st.expires_at, Some(1785258233624));
    let _ = std::fs::remove_dir_all(&home);
  }

  #[test]
  fn codex_reports_auth_mode_which_decides_whether_a_relay_applies() {
    let home = tmp_home("codex");
    std::fs::write(
      crate::paths::codex_home(&home).join("auth.json"),
      r#"{"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{"refresh_token":"r"}}"#,
    )
    .unwrap();

    let st = codex_login(&home);
    assert!(st.signed_in);
    assert_eq!(st.mode.as_deref(), Some("chatgpt"));
    let _ = std::fs::remove_dir_all(&home);
  }

  #[test]
  fn a_missing_or_broken_file_reads_as_signed_out_not_an_error() {
    let home = tmp_home("empty");
    assert!(!codex_login(&home).signed_in);

    std::fs::write(crate::paths::codex_home(&home).join("auth.json"), "{not json").unwrap();
    let st = codex_login(&home);
    assert!(!st.signed_in);
    assert!(st.source.contains("unreadable"), "source: {}", st.source);
    let _ = std::fs::remove_dir_all(&home);
  }

  #[test]
  fn no_credential_value_is_ever_returned() {
    let home = tmp_home("secrets");
    std::fs::write(
      home.join(".claude/.credentials.json"),
      r#"{"claudeAiOauth":{"accessToken":"SECRET-ACCESS","refreshToken":"SECRET-REFRESH","subscriptionType":"max"}}"#,
    )
    .unwrap();
    std::fs::write(
      crate::paths::codex_home(&home).join("auth.json"),
      r#"{"auth_mode":"apikey","OPENAI_API_KEY":"SECRET-KEY"}"#,
    )
    .unwrap();

    let report = LoginReport {
      claude: claude_login(&home),
      codex: codex_login(&home),
    };
    let json = serde_json::to_string(&report).unwrap();
    for secret in ["SECRET-ACCESS", "SECRET-REFRESH", "SECRET-KEY"] {
      assert!(!json.contains(secret), "{secret} leaked into {json}");
    }
    let _ = std::fs::remove_dir_all(&home);
  }
}
