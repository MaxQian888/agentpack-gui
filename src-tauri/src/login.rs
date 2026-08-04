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
/// - **OpenCode** stores a provider-keyed credential map in its XDG data
///   directory. We report only whether that map has entries and their count.
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
  opencode: LoginStatus,
}

/// Keychain service name Claude Code writes its OAuth bundle under.
///
/// Gated like its only caller below: the Keychain exists only on macOS, and an
/// ungated constant is dead code everywhere else — which `-D warnings` rejects.
#[cfg(target_os = "macos")]
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

fn opencode_login_from(path: &Path) -> LoginStatus {
  let Ok(text) = std::fs::read_to_string(path) else {
    return LoginStatus {
      source: "not signed in".into(),
      ..Default::default()
    };
  };
  let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
    return LoginStatus {
      source: "auth.json unreadable".into(),
      ..Default::default()
    };
  };
  let count = value.as_object().map_or(0, serde_json::Map::len);
  LoginStatus {
    signed_in: count > 0,
    mode: (count > 0).then(|| format!("{count} provider{}", if count == 1 { "" } else { "s" })),
    plan: None,
    expires_at: None,
    source: "OpenCode auth.json".into(),
  }
}

fn opencode_login(home: &Path) -> LoginStatus {
  let data_home = std::env::var_os("XDG_DATA_HOME")
    .filter(|value| !value.is_empty())
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|| home.join(".local/share"));
  opencode_login_from(&data_home.join("opencode/auth.json"))
}

#[tauri::command(async)]
pub fn login_status() -> Result<LoginReport, String> {
  let home = dirs::home_dir().unwrap_or_default();
  Ok(LoginReport {
    claude: claude_login(&home),
    codex: codex_login(&home),
    opencode: opencode_login(&home),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// A scratch home, and the crate-wide env lock held for as long as it lives.
  ///
  /// `codex_login` resolves its path through `paths::codex_home`, which honours
  /// `$CODEX_HOME` — so any sibling test that sets that variable (paths, cleanup)
  /// silently redirects these reads to *its* directory. Holding the lock is what
  /// keeps "the Codex home" meaning the same thing for the length of a test.
  struct TmpHome {
    path: std::path::PathBuf,
    _lock: std::sync::MutexGuard<'static, ()>,
  }

  impl std::ops::Deref for TmpHome {
    type Target = std::path::Path;
    fn deref(&self) -> &std::path::Path {
      &self.path
    }
  }

  impl Drop for TmpHome {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.path);
    }
  }

  fn tmp_home(tag: &str) -> TmpHome {
    let lock = crate::TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|e| e.into_inner());
    // Cleared rather than assumed absent: a test that panicked mid-run may have
    // left it set, and that would send every path below somewhere else.
    std::env::remove_var("CODEX_HOME");
    let p = std::env::temp_dir().join(format!(
      "aplogin-{tag}-{}",
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
    ));
    std::fs::create_dir_all(p.join(".claude")).unwrap();
    std::fs::create_dir_all(p.join(".codex")).unwrap();
    TmpHome {
      path: p,
      _lock: lock,
    }
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
  }

  #[test]
  fn a_missing_or_broken_file_reads_as_signed_out_not_an_error() {
    let home = tmp_home("empty");
    assert!(!codex_login(&home).signed_in);

    std::fs::write(
      crate::paths::codex_home(&home).join("auth.json"),
      "{not json",
    )
    .unwrap();
    let st = codex_login(&home);
    assert!(!st.signed_in);
    assert!(st.source.contains("unreadable"), "source: {}", st.source);
  }

  #[test]
  fn opencode_reports_credential_count_without_returning_values() {
    let home = tmp_home("opencode");
    let auth = home.join("opencode-auth.json");
    std::fs::write(
      &auth,
      r#"{"anthropic":{"type":"oauth","access":"SECRET"},"openai":{"type":"api","key":"SECRET-KEY"}}"#,
    )
    .unwrap();
    let status = opencode_login_from(&auth);
    assert!(status.signed_in);
    assert_eq!(status.mode.as_deref(), Some("2 providers"));
    assert!(!serde_json::to_string(&status).unwrap().contains("SECRET"));
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
      opencode: opencode_login_from(&home.join("missing-opencode-auth.json")),
    };
    let json = serde_json::to_string(&report).unwrap();
    for secret in ["SECRET-ACCESS", "SECRET-REFRESH", "SECRET-KEY"] {
      assert!(!json.contains(secret), "{secret} leaked into {json}");
    }
  }
}
