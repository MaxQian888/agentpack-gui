mod ccswitch;
mod commands;
mod exec;
mod fsops;
mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
  }

  builder
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      commands::greet,
      paths::get_paths,
      exec::run_command,
      exec::detect_cli,
      exec::is_process_running,
      fsops::read_text_file,
      fsops::write_text_file,
      fsops::remove_dir,
      fsops::install_skill,
      ccswitch::cc_load_providers,
      ccswitch::cc_write_provider,
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
