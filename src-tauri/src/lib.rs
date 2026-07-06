mod backup;
mod ccswitch;
mod commands;
mod exec;
mod fsops;
mod history;
mod paths;

/// One process-wide lock shared by every test that mutates the global env vars
/// (`AGENTPACK_CCSWITCH_DB`, `AGENTPACK_BACKUP_ROOT`, `AGENTPACK_SKIP_RUNNING_CHECK`).
/// ccswitch and backup tests both touch these, so a per-module lock isn't enough —
/// they'd race across modules. Holding this serializes them.
#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  #[cfg(desktop)]
  {
    builder = builder
      .plugin(tauri_plugin_updater::Builder::new().build())
      // Persist and restore the window's size/position across launches.
      .plugin(tauri_plugin_window_state::Builder::new().build());
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
    .invoke_handler(tauri::generate_handler![
      commands::greet,
      paths::get_paths,
      exec::run_command,
      exec::cancel_command,
      exec::launch_app,
      exec::detect_cli,
      exec::latest_version,
      exec::is_process_running,
      fsops::read_text_file,
      fsops::write_text_file,
      fsops::path_exists,
      fsops::remove_dir,
      fsops::list_dir,
      fsops::install_skill,
      ccswitch::cc_load_providers,
      ccswitch::cc_write_provider,
      backup::backup_snapshot,
      backup::backup_list,
      backup::backup_restore,
      history::history_list_sessions,
      history::history_get_session,
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
