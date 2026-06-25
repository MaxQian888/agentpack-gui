use serde::Serialize;
use std::path::PathBuf;

/// Absolute paths the frontend needs, resolved here so the webview never does
/// cross-platform path math. Serialized camelCase to match `lib/agentpack/types.ts` `Paths`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
  home: String,
  claude_settings: String,
  claude_skills_dir: String,
  codex_config: String,
  codex_skills_dir: String,
  cc_switch_settings: String,
  cc_switch_db: String,
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
  Ok(Paths {
    home: s(home.clone()),
    claude_settings: s(claude.join("settings.json")),
    claude_skills_dir: s(claude.join("skills")),
    codex_config: s(codex.join("config.toml")),
    codex_skills_dir: s(codex.join("skills")),
    cc_switch_settings: s(ccsw.join("settings.json")),
    cc_switch_db: s(ccsw.join("cc-switch.db")),
    os: os_family().into(),
  })
}
