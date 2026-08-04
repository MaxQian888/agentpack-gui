use crate::ccswitch::{Provider, ProviderForm, WriteReq};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const STORE_VERSION: u8 = 1;
const APPS: &[&str] = &["claude", "codex", "opencode"];

#[derive(Serialize, Deserialize)]
struct NativeStore {
  version: u8,
  providers: Vec<Provider>,
}

impl Default for NativeStore {
  fn default() -> Self {
    Self {
      version: STORE_VERSION,
      providers: Vec::new(),
    }
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWriteReq {
  backend: String,
  op: String,
  dry_run: bool,
  id: Option<String>,
  app: String,
  form: Option<ProviderForm>,
  settings_config: Option<String>,
}

pub(crate) fn native_store_path() -> PathBuf {
  if let Ok(path) = std::env::var("AGENTPACK_NATIVE_PROVIDERS") {
    return PathBuf::from(path);
  }
  dirs::home_dir()
    .unwrap_or_default()
    .join(".agentpack/providers.json")
}

fn validate_app(app: &str) -> Result<(), String> {
  if APPS.contains(&app) {
    Ok(())
  } else {
    Err(format!("unsupported provider app: {app}"))
  }
}

fn read_native_store() -> Result<NativeStore, String> {
  let path = native_store_path();
  let text = match fs::read_to_string(&path) {
    Ok(text) => text,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(NativeStore::default()),
    Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
  };
  let store: NativeStore = serde_json::from_str(&text)
    .map_err(|error| format!("cannot parse {}: {error}", path.display()))?;
  if store.version != STORE_VERSION {
    return Err(format!(
      "unsupported native provider store version {} (expected {STORE_VERSION})",
      store.version
    ));
  }
  if let Some(provider) = store
    .providers
    .iter()
    .find(|provider| !APPS.contains(&provider.app_type.as_str()))
  {
    return Err(format!(
      "unsupported provider app in native store: {}",
      provider.app_type
    ));
  }
  Ok(store)
}

fn write_private(path: &Path, content: &str) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  let temp = PathBuf::from(format!("{}.agentpack.tmp", path.to_string_lossy()));
  fs::write(&temp, content).map_err(|error| error.to_string())?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))
      .map_err(|error| error.to_string())?;
  }
  fs::rename(&temp, path).map_err(|error| error.to_string())
}

fn save_native_store(store: &NativeStore) -> Result<(), String> {
  let mut content = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
  content.push('\n');
  write_private(&native_store_path(), &content)
}

#[tauri::command(async)]
pub fn provider_load(backend: String) -> Result<Vec<Provider>, String> {
  match backend.as_str() {
    "native" => Ok(read_native_store()?.providers),
    "ccswitch" => crate::ccswitch::cc_load_providers(),
    _ => Err(format!("unknown provider backend: {backend}")),
  }
}

fn required_form(req: &ProviderWriteReq) -> Result<&ProviderForm, String> {
  req.form.as_ref().ok_or_else(|| "missing form".to_string())
}

fn required_settings(req: &ProviderWriteReq) -> Result<&String, String> {
  req
    .settings_config
    .as_ref()
    .ok_or_else(|| "missing settings_config".to_string())
}

fn run_native_op(store: &mut NativeStore, req: &ProviderWriteReq) -> Result<Vec<String>, String> {
  match req.op.as_str() {
    "add" => {
      let form = required_form(req)?;
      let settings = required_settings(req)?;
      let is_current = !store
        .providers
        .iter()
        .any(|provider| provider.app_type == req.app && provider.is_current);
      store.providers.push(Provider {
        id: crate::ccswitch::unique_id(),
        app_type: req.app.clone(),
        name: form.name.clone(),
        settings_config: settings.clone(),
        website_url: form.website_url.clone(),
        notes: form.notes.clone(),
        is_current,
      });
      Ok(vec![format!(
        "added provider \"{}\" ({}) to agentpack",
        form.name, req.app
      )])
    }
    "update" => {
      let form = required_form(req)?;
      let settings = required_settings(req)?;
      let id = req.id.as_ref().ok_or_else(|| "missing id".to_string())?;
      let provider = store
        .providers
        .iter_mut()
        .find(|provider| provider.id == *id && provider.app_type == req.app)
        .ok_or_else(|| {
          "provider not found — it may have been removed. Reload and try again.".to_string()
        })?;
      provider.name = form.name.clone();
      provider.settings_config = settings.clone();
      provider.website_url = form.website_url.clone();
      provider.notes = form.notes.clone();
      Ok(vec![format!(
        "updated provider \"{}\" ({}) in agentpack",
        form.name, req.app
      )])
    }
    "delete" => {
      let id = req.id.as_ref().ok_or_else(|| "missing id".to_string())?;
      let index = store
        .providers
        .iter()
        .position(|provider| provider.id == *id && provider.app_type == req.app)
        .ok_or_else(|| {
          "provider not found — it may have been removed. Reload and try again.".to_string()
        })?;
      if store.providers[index].is_current {
        return Err("cannot delete the active provider — switch to another provider first.".into());
      }
      store.providers.remove(index);
      Ok(vec![format!(
        "deleted provider ({}) from agentpack",
        req.app
      )])
    }
    "setCurrent" => {
      let id = req.id.as_ref().ok_or_else(|| "missing id".to_string())?;
      if !store
        .providers
        .iter()
        .any(|provider| provider.id == *id && provider.app_type == req.app)
      {
        return Err("provider not found — it may have been removed. Reload and try again.".into());
      }
      for provider in &mut store.providers {
        if provider.app_type == req.app {
          provider.is_current = provider.id == *id;
        }
      }
      Ok(vec![format!(
        "set current provider ({}) in agentpack",
        req.app
      )])
    }
    other => Err(format!("unknown op {other}")),
  }
}

#[tauri::command(async)]
pub fn provider_write(req: ProviderWriteReq) -> Result<Vec<String>, String> {
  match req.backend.as_str() {
    "ccswitch" => crate::ccswitch::cc_write_provider(WriteReq {
      op: req.op,
      dry_run: req.dry_run,
      id: req.id,
      app: req.app,
      form: req.form,
      settings_config: req.settings_config,
    }),
    "native" => {
      validate_app(&req.app)?;
      if req.dry_run {
        return Ok(vec![format!(
          "would run: {} provider ({}) in agentpack",
          req.op, req.app
        )]);
      }
      let mut store = read_native_store()?;
      let snapshot = crate::backup::snapshot_native("provider write")?;
      let mut lines = vec![format!("backed up → {}", snapshot.id)];
      lines.append(&mut run_native_op(&mut store, &req)?);
      save_native_store(&store)?;
      Ok(lines)
    }
    _ => Err(format!("unknown provider backend: {}", req.backend)),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::{TestEnvGuard, TEST_ENV_LOCK};

  fn setup() -> (PathBuf, TestEnvGuard) {
    let root =
      std::env::temp_dir().join(format!("native-providers-{}", crate::ccswitch::unique_id()));
    let store = root.join("providers.json");
    std::env::set_var("AGENTPACK_NATIVE_PROVIDERS", &store);
    std::env::set_var("AGENTPACK_BACKUP_ROOT", root.join("backups"));
    std::env::set_var("AGENTPACK_SKIP_RUNNING_CHECK", "1");
    (root, TestEnvGuard)
  }

  fn add(name: &str, app: &str) -> ProviderWriteReq {
    ProviderWriteReq {
      backend: "native".into(),
      op: "add".into(),
      dry_run: false,
      id: None,
      app: app.into(),
      form: Some(ProviderForm {
        name: name.into(),
        website_url: None,
        notes: None,
      }),
      settings_config: Some("{}".into()),
    }
  }

  #[test]
  fn native_store_crud_and_current_selection_round_trip() {
    let _lock = TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|error| error.into_inner());
    let (root, _env) = setup();

    provider_write(add("First", "claude")).unwrap();
    provider_write(add("Second", "claude")).unwrap();
    let rows = provider_load("native".into()).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows[0].is_current);
    assert!(!rows[1].is_current);

    provider_write(ProviderWriteReq {
      backend: "native".into(),
      op: "setCurrent".into(),
      dry_run: false,
      id: Some(rows[1].id.clone()),
      app: "claude".into(),
      form: None,
      settings_config: None,
    })
    .unwrap();
    let rows = provider_load("native".into()).unwrap();
    assert!(!rows[0].is_current);
    assert!(rows[1].is_current);

    let _ = fs::remove_dir_all(root);
  }

  #[test]
  fn native_store_rejects_unknown_apps_and_active_deletion() {
    let _lock = TEST_ENV_LOCK
      .lock()
      .unwrap_or_else(|error| error.into_inner());
    let (root, _env) = setup();
    assert!(provider_write(add("Unknown", "gemini")).is_err());
    provider_write(add("Only", "codex")).unwrap();
    let row = provider_load("native".into()).unwrap().remove(0);
    let error = provider_write(ProviderWriteReq {
      backend: "native".into(),
      op: "delete".into(),
      dry_run: false,
      id: Some(row.id),
      app: "codex".into(),
      form: None,
      settings_config: None,
    })
    .unwrap_err();
    assert!(error.contains("active"));
    let _ = fs::remove_dir_all(root);
  }
}
