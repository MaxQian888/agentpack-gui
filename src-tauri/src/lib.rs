mod backup;
mod ccswitch;
mod download;
mod exec;
mod fsops;
mod history;
mod history_cache;
mod login;
mod mcp;
mod net;
mod paths;
mod skills;

/// One process-wide lock shared by every test that mutates the global env vars
/// (`AGENTPACK_CCSWITCH_DB`, `AGENTPACK_BACKUP_ROOT`, `AGENTPACK_SKIP_RUNNING_CHECK`,
/// `AGENTPACK_HISTORY_CACHE`). ccswitch, backup and history_cache tests all touch
/// these, so a per-module lock isn't enough — they'd race across modules. Holding
/// this serializes them.
#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Clears every test env var when it drops, however the test ends.
///
/// Cleaning up on the success path only isn't enough: a failing assertion
/// unwinds past the `remove_var` calls and leaves the vars set for whichever
/// sibling test acquires [`TEST_ENV_LOCK`] next — turning one real failure into
/// a cascade of unrelated ones. `Drop` runs during unwind, so this holds either
/// way.
#[cfg(test)]
pub(crate) struct TestEnvGuard;

#[cfg(test)]
impl Drop for TestEnvGuard {
  fn drop(&mut self) {
    for key in [
      "AGENTPACK_CCSWITCH_DB",
      "AGENTPACK_BACKUP_ROOT",
      "AGENTPACK_SKIP_RUNNING_CHECK",
      "AGENTPACK_HISTORY_CACHE",
    ] {
      std::env::remove_var(key);
    }
  }
}

/// Bring the main window back to the front, whatever state it's in.
///
/// The order matters and every step earns its place:
///  1. macOS only — un-hide the *application* first. After Cmd+H the whole app
///     is hidden, so its windows report `isVisible == false`, and tao's
///     `set_focus` bails out early on exactly that condition. Without this, a
///     second launch would silently do nothing.
///  2. `unminimize` — a minimized window also fails tao's `set_focus` guard.
///  3. `show` — the window itself may have been ordered out.
///  4. `set_focus` — only now does it reach `activateIgnoringOtherApps`.
#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
  use tauri::Manager;
  #[cfg(target_os = "macos")]
  let _ = app.show();
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  #[cfg(desktop)]
  {
    builder = builder
      // MUST stay the first registered plugin — plugins run in registration
      // order, so this has to reject the duplicate launch before anything else
      // touches state. Two agentpack windows would race each other writing
      // ~/.claude, ~/.codex and the cc-switch DB, so the second launch just
      // re-summons the first window instead of opening its own.
      .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        focus_main_window(app);
      }))
      .plugin(tauri_plugin_updater::Builder::new().build())
      // Persist and restore the window's size/position across launches.
      .plugin(tauri_plugin_window_state::Builder::new().build())
      // Backs the opt-in "summon agentpack" hotkey. Shortcuts are registered
      // from the frontend (lib/tauri/shortcut.ts) so the accelerator stays a
      // user setting; this only installs the plugin.
      .plugin(tauri_plugin_global_shortcut::Builder::new().build());
  }

  builder
    .plugin(tauri_plugin_dialog::init())
    // Self-update support: `process` for relaunch after install; `store` for
    // persisted app settings; `opener` for release-notes/config-folder links;
    // `notification` for background update alerts.
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
    // `os` tells the frontend which window chrome to draw (native traffic
    // lights on macOS vs. our own buttons elsewhere); `clipboard-manager`
    // replaces `navigator.clipboard`, which silently fails in WebKitGTK.
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .invoke_handler(tauri::generate_handler![
      paths::get_paths,
      exec::run_command,
      exec::cancel_command,
      exec::launch_app,
      exec::launch_cc_switch,
      exec::quit_cc_switch,
      exec::cc_switch_running,
      exec::detect_cli,
      exec::latest_version,
      exec::npm_owns,
      exec::pkg_manager_owns,
      exec::is_process_running,
      exec::start_cc_connect,
      exec::stop_cc_connect,
      exec::probe_port,
      exec::probe_host,
      exec::command_on_path,
      fsops::read_text_file,
      fsops::write_text_file,
      fsops::write_binary_file,
      fsops::path_exists,
      fsops::remove_dir,
      fsops::list_skills,
      fsops::install_skill,
      skills::skills_scan,
      skills::install_skill_from_dir,
      skills::list_skill_files,
      skills::fetch_repo_skills,
      skills::install_repo_skills,
      skills::check_repo_updates,
      skills::update_skill,
      skills::cleanup_repo_scan,
      skills::backup_skill,
      skills::list_skill_backups,
      skills::restore_skill_backup,
      skills::delete_skill_backup,
      skills::create_skill,
      mcp::registry_fetch,
      mcp::mcp_probe_remote,
      mcp::mcp_probe_stdio,
      net::proxy_env_snapshot,
      net::system_proxy_snapshot,
      net::tool_proxy_snapshot,
      net::proxy_check,
      net::http_get,
      net::set_process_proxy,
      download::github_latest_release,
      download::manifest_latest_release,
      download::download_release_asset,
      download::install_package,
      ccswitch::cc_load_providers,
      ccswitch::cc_write_provider,
      ccswitch::cc_schema_status,
      ccswitch::cc_init_db,
      login::login_status,
      backup::backup_snapshot,
      backup::backup_list,
      backup::backup_restore,
      history::history_list_sessions,
      history::history_usage_series,
      history::history_get_session,
      history::history_get_part_text,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
