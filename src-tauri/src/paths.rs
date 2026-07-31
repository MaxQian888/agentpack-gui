use serde::Serialize;
use std::path::PathBuf;

/// Absolute paths the frontend needs, resolved here so the webview never does
/// cross-platform path math. Serialized camelCase to match `lib/agentpack/types.ts` `Paths`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
  home: String,
  claude_settings: String,
  claude_config: String,
  claude_skills_dir: String,
  codex_config: String,
  codex_auth: String,
  codex_skills_dir: String,
  opencode_config: String,
  opencode_skills_dir: String,
  agents_skills_dir: String,
  cc_switch_settings: String,
  cc_switch_db: String,
  cc_connect_dir: String,
  cc_connect_config: String,
  mcp_disabled_store: String,
  shell_profile: String,
  os: String,
}

fn s(p: PathBuf) -> String {
  p.to_string_lossy().into_owned()
}

/// Our OS family, matching the `OS` union in the TS registry.
pub fn os_family() -> &'static str {
  if cfg!(windows) {
    "win"
  } else if cfg!(target_os = "macos") {
    "mac"
  } else {
    "linux"
  }
}

/// The login shell's rc file — where an `export HTTP_PROXY=…` block has to go for
/// Codex / OpenCode (which read the process environment and have no proxy config
/// field of their own) to see it. Picked from `$SHELL`, defaulting to zsh on
/// macOS and bash elsewhere. Empty on Windows, which has no rc file to edit:
/// there the proxy is written with `setx` instead.
fn shell_profile(home: &std::path::Path) -> PathBuf {
  if cfg!(windows) {
    return PathBuf::new();
  }
  let shell = std::env::var("SHELL").unwrap_or_default();
  let name = shell.rsplit('/').next().unwrap_or("");
  match name {
    "fish" => home.join(".config").join("fish").join("config.fish"),
    "bash" => home.join(".bashrc"),
    "zsh" => home.join(".zshrc"),
    _ if cfg!(target_os = "macos") => home.join(".zshrc"),
    _ => home.join(".bashrc"),
  }
}

/// `~/.codex`, honoring `CODEX_HOME` like Codex itself does.
pub fn codex_home(home: &std::path::Path) -> PathBuf {
  std::env::var("CODEX_HOME")
    .map(PathBuf::from)
    .unwrap_or_else(|_| home.join(".codex"))
}

#[tauri::command]
pub fn get_paths() -> Result<Paths, String> {
  let home = dirs::home_dir().ok_or("no home dir")?;
  let claude = home.join(".claude");
  let codex = codex_home(&home);
  let ccsw = home.join(".cc-switch");
  let ccconn = home.join(".cc-connect");
  let agentpack = home.join(".agentpack");
  Ok(Paths {
    home: s(home.clone()),
    claude_settings: s(claude.join("settings.json")),
    // User-scope MCP servers live in ~/.claude.json (not settings.json); read
    // directly instead of the 45s-slow, health-checking `claude mcp list`.
    claude_config: s(home.join(".claude.json")),
    claude_skills_dir: s(claude.join("skills")),
    codex_config: s(codex.join("config.toml")),
    codex_auth: s(codex.join("auth.json")),
    codex_skills_dir: s(codex.join("skills")),
    // OpenCode uses an XDG-style ~/.config even on Windows (verified against the
    // opencode.ai docs and a real install); skills.sh installs there too.
    opencode_config: s(home.join(".config").join("opencode").join("opencode.json")),
    opencode_skills_dir: s(home.join(".config").join("opencode").join("skills")),
    // Shared canonical dir used by the skills.sh CLI (symlink targets) and read
    // directly by OpenCode.
    agents_skills_dir: s(home.join(".agents").join("skills")),
    cc_switch_settings: s(ccsw.join("settings.json")),
    cc_switch_db: s(ccsw.join("cc-switch.db")),
    cc_connect_dir: s(ccconn.clone()),
    cc_connect_config: s(ccconn.join("config.toml")),
    // agentpack's own stash for Claude MCP servers disabled via remove-and-remember
    // (Claude has no native per-server disable flag).
    mcp_disabled_store: s(agentpack.join("mcp-disabled.json")),
    shell_profile: s(shell_profile(&home)),
    os: os_family().into(),
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::TEST_ENV_LOCK;

  /// Restores the *previous* values rather than removing the keys: unlike the
  /// crate-wide `TestEnvGuard` vars, `SHELL` genuinely exists in a developer's
  /// environment and clearing it would leak into whatever runs next.
  struct EnvRestore(Vec<(&'static str, Option<String>)>);

  impl EnvRestore {
    fn set(pairs: &[(&'static str, Option<&str>)]) -> Self {
      let saved = pairs
        .iter()
        .map(|(k, _)| (*k, std::env::var(k).ok()))
        .collect();
      for (k, v) in pairs {
        match v {
          Some(v) => std::env::set_var(k, v),
          None => std::env::remove_var(k),
        }
      }
      Self(saved)
    }
  }

  impl Drop for EnvRestore {
    fn drop(&mut self) {
      for (k, v) in &self.0 {
        match v {
          Some(v) => std::env::set_var(k, v),
          None => std::env::remove_var(k),
        }
      }
    }
  }

  fn home() -> PathBuf {
    PathBuf::from("/h")
  }

  #[test]
  fn os_family_matches_the_ts_registry_union() {
    assert!(matches!(os_family(), "win" | "mac" | "linux"));
    #[cfg(target_os = "macos")]
    assert_eq!(os_family(), "mac");
    #[cfg(windows)]
    assert_eq!(os_family(), "win");
  }

  /// Codex itself honours `CODEX_HOME`; a user who has moved it would otherwise
  /// have every Codex path written to a directory Codex never reads.
  #[test]
  fn codex_home_follows_the_env_var_when_set() {
    let _lock = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = EnvRestore::set(&[("CODEX_HOME", Some("/elsewhere/codex"))]);
    assert_eq!(codex_home(&home()), PathBuf::from("/elsewhere/codex"));
  }

  #[test]
  fn codex_home_defaults_to_dot_codex_under_home() {
    let _lock = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = EnvRestore::set(&[("CODEX_HOME", None)]);
    assert_eq!(codex_home(&home()), PathBuf::from("/h/.codex"));
  }

  /// The rc file is where an `export HTTP_PROXY=…` block has to land for Codex
  /// and OpenCode to see it, so picking the wrong one writes a proxy nothing
  /// reads.
  #[cfg(not(windows))]
  #[test]
  fn shell_profile_follows_the_login_shell() {
    let _lock = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    for (shell, expected) in [
      ("/bin/zsh", "/h/.zshrc"),
      ("/bin/bash", "/h/.bashrc"),
      ("/opt/homebrew/bin/fish", "/h/.config/fish/config.fish"),
      ("/usr/bin/zsh", "/h/.zshrc"),
    ] {
      let _env = EnvRestore::set(&[("SHELL", Some(shell))]);
      assert_eq!(
        shell_profile(&home()),
        PathBuf::from(expected),
        "for {shell}"
      );
    }
  }

  #[cfg(not(windows))]
  #[test]
  fn shell_profile_falls_back_per_platform_for_an_unknown_shell() {
    let _lock = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = EnvRestore::set(&[("SHELL", Some("/usr/bin/nu"))]);
    let expected = if cfg!(target_os = "macos") {
      "/h/.zshrc"
    } else {
      "/h/.bashrc"
    };
    assert_eq!(shell_profile(&home()), PathBuf::from(expected));
    // An unset SHELL takes the same path as an unrecognised one.
    let _env = EnvRestore::set(&[("SHELL", None)]);
    assert_eq!(shell_profile(&home()), PathBuf::from(expected));
  }

  /// Windows has no rc file to edit — the proxy is written with `setx` instead —
  /// so an empty string here is the signal, not a bug.
  #[cfg(windows)]
  #[test]
  fn shell_profile_is_empty_on_windows() {
    assert_eq!(shell_profile(&home()), PathBuf::new());
  }

  /// Every field is derived, so one wrong join silently writes an agent's config
  /// somewhere it will never be read.
  #[test]
  fn get_paths_derives_every_field_from_the_home_directory() {
    let _lock = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = EnvRestore::set(&[("CODEX_HOME", None)]);
    let p = get_paths().expect("home dir resolves");
    let h = p.home.clone();
    let join = |rest: &str| PathBuf::from(&h).join(rest).to_string_lossy().into_owned();

    assert_eq!(p.claude_settings, join(".claude/settings.json"));
    // User-scope MCP servers live in ~/.claude.json, NOT in settings.json.
    assert_eq!(p.claude_config, join(".claude.json"));
    assert_eq!(p.claude_skills_dir, join(".claude/skills"));
    assert_eq!(p.codex_config, join(".codex/config.toml"));
    assert_eq!(p.codex_auth, join(".codex/auth.json"));
    assert_eq!(p.codex_skills_dir, join(".codex/skills"));
    // OpenCode uses an XDG-style ~/.config even on Windows.
    assert_eq!(p.opencode_config, join(".config/opencode/opencode.json"));
    assert_eq!(p.opencode_skills_dir, join(".config/opencode/skills"));
    assert_eq!(p.agents_skills_dir, join(".agents/skills"));
    assert_eq!(p.cc_switch_settings, join(".cc-switch/settings.json"));
    assert_eq!(p.cc_switch_db, join(".cc-switch/cc-switch.db"));
    assert_eq!(p.cc_connect_dir, join(".cc-connect"));
    assert_eq!(p.cc_connect_config, join(".cc-connect/config.toml"));
    assert_eq!(p.mcp_disabled_store, join(".agentpack/mcp-disabled.json"));
    assert_eq!(p.os, os_family());
  }

  #[test]
  fn get_paths_relocates_the_codex_group_when_codex_home_is_set() {
    let _lock = TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _env = EnvRestore::set(&[("CODEX_HOME", Some("/elsewhere/codex"))]);
    let p = get_paths().expect("home dir resolves");
    assert!(p.codex_config.starts_with("/elsewhere/codex"));
    assert!(p.codex_auth.starts_with("/elsewhere/codex"));
    assert!(p.codex_skills_dir.starts_with("/elsewhere/codex"));
    // …and only that group: Claude's paths stay under the real home.
    assert!(p.claude_config.starts_with(&p.home));
  }
}
