use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "macos")]
use std::process::Stdio;
use std::time::Duration;

fn extra_session_dirs_path(home: &Path) -> PathBuf {
  home.join(".agentpack").join("pi-session-dirs.json")
}

pub(crate) fn extra_session_dirs(home: &Path) -> Vec<PathBuf> {
  fs::read_to_string(extra_session_dirs_path(home))
    .ok()
    .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
    .unwrap_or_default()
    .into_iter()
    .map(PathBuf::from)
    .filter(|path| path.is_dir())
    .map(|path| path.canonicalize().unwrap_or(path))
    .collect::<BTreeSet<_>>()
    .into_iter()
    .collect()
}

#[tauri::command(async)]
pub fn pi_session_dirs_get() -> Result<Vec<String>, String> {
  let home = dirs::home_dir().ok_or("no home dir")?;
  Ok(
    extra_session_dirs(&home)
      .into_iter()
      .map(|path| path.to_string_lossy().into_owned())
      .collect(),
  )
}

#[tauri::command(async)]
pub fn pi_session_dirs_set(dirs: Vec<String>) -> Result<Vec<String>, String> {
  let home = dirs::home_dir().ok_or("no home dir")?;
  let mut normalized = BTreeSet::new();
  for value in dirs {
    let path = PathBuf::from(value);
    if !path.is_dir() {
      return Err(format!(
        "session directory does not exist: {}",
        path.display()
      ));
    }
    normalized.insert(path.canonicalize().map_err(|error| error.to_string())?);
  }
  let values: Vec<String> = normalized
    .into_iter()
    .map(|path| path.to_string_lossy().into_owned())
    .collect();
  let path = extra_session_dirs_path(&home);
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  let content = serde_json::to_vec_pretty(&values).map_err(|error| error.to_string())?;
  fs::write(path, content).map_err(|error| error.to_string())?;
  Ok(values)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PiScope {
  Global,
  Project { cwd: String },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PiResourceState {
  enabled: bool,
  configured: bool,
  filters: Vec<String>,
  declared: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageRecord {
  source: String,
  identity: String,
  source_kind: String,
  pinned: bool,
  autoload: bool,
  scope: String,
  inherited: bool,
  overridden: bool,
  installed: bool,
  installed_path: Option<String>,
  version: Option<String>,
  resources: BTreeMap<String, PiResourceState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiTrustStatus {
  state: String,
  source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageSnapshot {
  installed: bool,
  scope: String,
  cwd: Option<String>,
  settings_path: String,
  packages: Vec<PiPackageRecord>,
  trust: PiTrustStatus,
  errors: Vec<String>,
}

fn settings_json(path: &Path, errors: &mut Vec<String>) -> Value {
  if !path.is_file() {
    return Value::Object(Default::default());
  }
  match fs::read_to_string(path)
    .map_err(|e| e.to_string())
    .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|e| e.to_string()))
  {
    Ok(value) if value.is_object() => value,
    Ok(_) => {
      errors.push(format!(
        "{}: settings root is not an object",
        path.display()
      ));
      Value::Object(Default::default())
    }
    Err(error) => {
      errors.push(format!("{}: {error}", path.display()));
      Value::Object(Default::default())
    }
  }
}

fn npm_identity(spec: &str) -> (String, bool, Option<String>) {
  let value = spec.strip_prefix("npm:").unwrap_or(spec);
  let split = if value.starts_with('@') {
    value
      .rfind('@')
      .filter(|index| *index > value.find('/').unwrap_or(usize::MAX))
  } else {
    value.rfind('@')
  };
  match split {
    Some(index) if index > 0 => (
      value[..index].to_string(),
      true,
      Some(value[index + 1..].to_string()),
    ),
    _ => (value.to_string(), false, None),
  }
}

fn git_identity(spec: &str) -> (String, bool, Option<String>) {
  let redacted = redact_package_source(spec);
  let value = redacted.strip_prefix("git:").unwrap_or(&redacted);
  let split = if let Some(scheme) = value.find("://") {
    let authority_start = scheme + 3;
    value[authority_start..]
      .find('/')
      .map(|offset| authority_start + offset)
      .and_then(|path_start| {
        value[path_start..]
          .find('@')
          .map(|offset| path_start + offset)
      })
  } else if let Some(colon) = value.find(':') {
    let slash = value.find('/').unwrap_or(usize::MAX);
    if colon < slash && value[..colon].contains('@') {
      value[colon + 1..]
        .find('@')
        .map(|offset| colon + 1 + offset)
    } else {
      value.rfind('@')
    }
  } else {
    value.rfind('@')
  };
  let (repository, pinned, version) = match split {
    Some(index) => (&value[..index], true, Some(value[index + 1..].to_string())),
    None => (value, false, None),
  };
  let mut identity = repository
    .trim_start_matches("https://")
    .trim_start_matches("http://")
    .trim_start_matches("ssh://")
    .trim_start_matches("git://")
    .trim_end_matches(".git")
    .to_string();
  let authority_end = identity.find(['/', ':']).unwrap_or(identity.len());
  if let Some(at) = identity[..authority_end].rfind('@') {
    identity.replace_range(..=at, "");
  }
  if let Some(colon) = identity.find(':') {
    identity.replace_range(colon..=colon, "/");
  }
  (identity, pinned, version)
}

fn redact_package_source(source: &str) -> String {
  let mut value = source.to_string();
  let prefix_len = usize::from(value.starts_with("git:")) * 4;
  if let Some(scheme_offset) = value[prefix_len..].find("://") {
    let authority_start = prefix_len + scheme_offset + 3;
    let authority_end = value[authority_start..]
      .find('/')
      .map(|offset| authority_start + offset)
      .unwrap_or(value.len());
    if let Some(at) = value[authority_start..authority_end].rfind('@') {
      value.replace_range(authority_start..authority_start + at, "***");
    }
  } else {
    let candidate = &value[prefix_len..];
    if let (Some(at), Some(colon)) = (candidate.find('@'), candidate.find(':')) {
      let slash = candidate.find('/').unwrap_or(usize::MAX);
      if at < colon && colon < slash {
        value.replace_range(prefix_len..prefix_len + at, "***");
      }
    }
  }
  if let Some(index) = value.find(['?', '#']) {
    value.truncate(index + 1);
    value.push_str("***");
  }
  value
}

fn safe_repository_url(source: &str) -> Option<String> {
  let parsed = url::Url::parse(source).ok()?;
  matches!(parsed.scheme(), "http" | "https").then(|| redact_package_source(source))
}

fn looks_like_local_source(source: &str) -> bool {
  let bytes = source.as_bytes();
  source.starts_with('/')
    || source.starts_with('\\')
    || source.starts_with("./")
    || source.starts_with("../")
    || source.starts_with("~/")
    || source.starts_with(".\\")
    || source.starts_with("..\\")
    || source.starts_with("~\\")
    || (bytes.len() >= 3
      && bytes[0].is_ascii_alphabetic()
      && bytes[1] == b':'
      && matches!(bytes[2], b'/' | b'\\'))
}

fn source_info(source: &str, base: &Path) -> (String, String, bool, Option<String>, PathBuf) {
  let looks_local = looks_like_local_source(source);
  let looks_git = source.starts_with("git:")
    || source.starts_with("https://")
    || source.starts_with("http://")
    || source.starts_with("ssh://")
    || source.starts_with("git://");
  if source.starts_with("npm:") || (!looks_local && !looks_git) {
    let (identity, pinned, version) = npm_identity(source);
    let path = identity
      .split('/')
      .fold(base.join("npm").join("node_modules"), |path, part| {
        path.join(part)
      });
    return ("npm".into(), identity, pinned, version, path);
  }
  if looks_git {
    let (identity, pinned, version) = git_identity(source);
    let path = identity
      .split(['/', ':'])
      .filter(|part| !part.is_empty())
      .fold(base.join("git"), |path, part| path.join(part));
    return ("git".into(), identity, pinned, version, path);
  }
  let raw = source
    .strip_prefix("~/")
    .or_else(|| source.strip_prefix("~\\"))
    .and_then(|relative| dirs::home_dir().map(|home| home.join(relative)))
    .unwrap_or_else(|| PathBuf::from(source));
  let path = if raw.is_absolute() {
    raw
  } else {
    base.join(raw)
  };
  let path = path.canonicalize().unwrap_or(path);
  (
    "local".into(),
    path.to_string_lossy().into_owned(),
    false,
    None,
    path,
  )
}

fn strings(value: Option<&Value>) -> Vec<String> {
  value
    .and_then(Value::as_array)
    .map(|values| {
      values
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
    })
    .unwrap_or_default()
}

fn manifest_resources(path: &Path) -> (Option<String>, BTreeMap<String, Vec<String>>) {
  let mut resources = BTreeMap::new();
  if path.is_file() {
    for kind in ["extensions", "skills", "prompts", "themes"] {
      let declared = if kind == "extensions"
        && matches!(
          path.extension().and_then(|value| value.to_str()),
          Some("ts" | "js")
        ) {
        path
          .file_name()
          .map(|name| vec![name.to_string_lossy().into_owned()])
          .unwrap_or_default()
      } else {
        Vec::new()
      };
      resources.insert(kind.to_string(), declared);
    }
    return (None, resources);
  }
  let manifest = fs::read_to_string(path.join("package.json"))
    .ok()
    .and_then(|text| serde_json::from_str::<Value>(&text).ok());
  let version = manifest
    .as_ref()
    .and_then(|v| v.get("version"))
    .and_then(Value::as_str)
    .map(str::to_string);
  for kind in ["extensions", "skills", "prompts", "themes"] {
    let declared = manifest
      .as_ref()
      .and_then(|v| v.get("pi"))
      .and_then(|pi| pi.get(kind));
    let values = if let Some(declared) = declared {
      manifest_declared_resources(path, kind, &strings(Some(declared)))
    } else if path.join(kind).exists() {
      convention_resources(path, kind)
    } else {
      Vec::new()
    };
    resources.insert(kind.to_string(), values);
  }
  (version, resources)
}

fn resource_file_matches(path: &Path, resource_root: &Path, kind: &str) -> bool {
  let extension = path.extension().and_then(|value| value.to_str());
  match kind {
    "extensions" => matches!(extension, Some("ts" | "js")),
    "skills" => {
      path.file_name().and_then(|value| value.to_str()) == Some("SKILL.md")
        || (extension == Some("md") && path.parent() == Some(resource_root))
    }
    "prompts" => extension == Some("md"),
    "themes" => extension == Some("json"),
    _ => false,
  }
}

fn visit_resource_files(
  package_root: &Path,
  resource_root: &Path,
  path: &Path,
  kind: &str,
  allow_declared_symlink_root: bool,
  out: &mut Vec<String>,
) {
  const MAX_RESOURCE_DEPTH: usize = 64;

  struct ResourceVisitor<'a> {
    canonical_scan_root: &'a Path,
    package_root: &'a Path,
    resource_root: &'a Path,
    kind: &'a str,
    allow_declared_symlink_root: bool,
    visited: HashSet<PathBuf>,
    out: &'a mut Vec<String>,
  }

  impl ResourceVisitor<'_> {
    fn visit(&mut self, path: &Path, depth: usize) {
      if depth > MAX_RESOURCE_DEPTH {
        return;
      }
      let Ok(link_metadata) = fs::symlink_metadata(path) else {
        return;
      };
      let root_symlink = depth == 0 && link_metadata.file_type().is_symlink();
      if link_metadata.file_type().is_symlink()
        && !(self.allow_declared_symlink_root && root_symlink)
      {
        return;
      }
      let metadata = if root_symlink {
        let Ok(metadata) = fs::metadata(path) else {
          return;
        };
        metadata
      } else {
        link_metadata
      };
      let Ok(canonical_path) = path.canonicalize() else {
        return;
      };
      if !canonical_path.starts_with(self.canonical_scan_root) {
        return;
      }
      if metadata.is_file() {
        if resource_file_matches(path, self.resource_root, self.kind) {
          if let Ok(relative) = path.strip_prefix(self.package_root) {
            self.out.push(relative.to_string_lossy().replace('\\', "/"));
          }
        }
        return;
      }
      if !metadata.is_dir() || !self.visited.insert(canonical_path) {
        return;
      }
      let Ok(entries) = fs::read_dir(path) else {
        return;
      };
      for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
          continue;
        };
        if file_type.is_symlink() {
          continue;
        }
        self.visit(&entry.path(), depth + 1);
      }
    }
  }

  let Ok(relative_root) = path.strip_prefix(package_root) else {
    return;
  };
  let components: Vec<_> = relative_root.components().collect();
  let mut cursor = package_root.to_path_buf();
  for (index, component) in components.iter().enumerate() {
    let std::path::Component::Normal(component) = component else {
      return;
    };
    cursor.push(component);
    let Ok(metadata) = fs::symlink_metadata(&cursor) else {
      return;
    };
    let is_declared_root = index + 1 == components.len();
    if metadata.file_type().is_symlink() && !(allow_declared_symlink_root && is_declared_root) {
      return;
    }
  }
  let Ok(canonical_scan_root) = path.canonicalize() else {
    return;
  };
  ResourceVisitor {
    canonical_scan_root: &canonical_scan_root,
    package_root,
    resource_root,
    kind,
    allow_declared_symlink_root,
    visited: HashSet::new(),
    out,
  }
  .visit(path, 0);
}

fn manifest_pattern_matches(path: &str, pattern: &str, kind: &str) -> bool {
  let normalized = pattern.strip_prefix("./").unwrap_or(pattern);
  let matches = |candidate: &str| {
    glob::Pattern::new(normalized)
      .map(|pattern| pattern.matches(candidate))
      .unwrap_or(false)
  };
  if matches(path)
    || Path::new(path)
      .file_name()
      .and_then(|name| name.to_str())
      .is_some_and(matches)
  {
    return true;
  }
  kind == "skills"
    && Path::new(path)
      .parent()
      .map(|parent| parent.to_string_lossy().replace('\\', "/"))
      .is_some_and(|parent| matches(&parent))
}

fn manifest_declared_resources(root: &Path, kind: &str, entries: &[String]) -> Vec<String> {
  let mut out = Vec::new();
  for entry in entries
    .iter()
    .filter(|entry| !matches!(entry.chars().next(), Some('!' | '+' | '-')))
  {
    let normalized = entry.strip_prefix("./").unwrap_or(entry);
    if normalized.chars().any(|ch| matches!(ch, '*' | '?' | '[')) {
      let pattern = root.join(normalized).to_string_lossy().into_owned();
      if let Ok(paths) = glob::glob(&pattern) {
        for resolved in paths.flatten() {
          let resource_root = if resolved.is_dir() {
            resolved.as_path()
          } else {
            resolved.parent().unwrap_or(root)
          };
          visit_resource_files(root, resource_root, &resolved, kind, false, &mut out);
        }
      }
    } else {
      let resolved = root.join(normalized);
      let resource_root = if resolved.is_dir() {
        resolved.as_path()
      } else {
        resolved.parent().unwrap_or(root)
      };
      visit_resource_files(root, resource_root, &resolved, kind, true, &mut out);
    }
  }
  out.sort();
  out.dedup();
  out.retain(|path| {
    let mut enabled = true;
    for entry in entries {
      if let Some(pattern) = entry.strip_prefix('!') {
        if manifest_pattern_matches(path, pattern, kind) {
          enabled = false;
        }
      } else if let Some(exact) = entry.strip_prefix('+') {
        if manifest_pattern_matches(path, exact, kind) {
          enabled = true;
        }
      } else if let Some(exact) = entry.strip_prefix('-') {
        if manifest_pattern_matches(path, exact, kind) {
          enabled = false;
        }
      }
    }
    enabled
  });
  out
}

fn convention_resources(package_root: &Path, kind: &str) -> Vec<String> {
  let mut out = Vec::new();
  let resource_root = package_root.join(kind);
  visit_resource_files(
    package_root,
    &resource_root,
    &resource_root,
    kind,
    false,
    &mut out,
  );
  out.sort();
  out
}

fn resources_for(
  entry: &Value,
  path: &Path,
) -> (Option<String>, BTreeMap<String, PiResourceState>) {
  let (version, declared) = manifest_resources(path);
  let mut out = BTreeMap::new();
  for kind in ["extensions", "skills", "prompts", "themes"] {
    let configured = entry.get(kind);
    let filters = strings(configured);
    out.insert(
      kind.to_string(),
      PiResourceState {
        enabled: configured.map_or(true, |value| {
          value.as_array().map_or(true, |a| !a.is_empty())
        }),
        configured: configured.is_some(),
        filters,
        declared: declared.get(kind).cloned().unwrap_or_default(),
      },
    );
  }
  (version, out)
}

fn resource_path_enabled(kind: &str, path: &str, state: &PiResourceState) -> bool {
  if !state.enabled {
    return false;
  }
  if !state.configured {
    return true;
  }
  let selectors: Vec<&str> = state
    .filters
    .iter()
    .map(String::as_str)
    .filter(|pattern| !matches!(pattern.chars().next(), Some('!' | '+' | '-')))
    .collect();
  let mut enabled = selectors.is_empty()
    || selectors
      .iter()
      .any(|pattern| manifest_pattern_matches(path, pattern, kind));
  for pattern in &state.filters {
    if let Some(pattern) = pattern.strip_prefix('!') {
      if manifest_pattern_matches(path, pattern, kind) {
        enabled = false;
      }
    } else if let Some(pattern) = pattern.strip_prefix('+') {
      if manifest_pattern_matches(path, pattern, kind) {
        enabled = true;
      }
    } else if let Some(pattern) = pattern.strip_prefix('-') {
      if manifest_pattern_matches(path, pattern, kind) {
        enabled = false;
      }
    }
  }
  enabled
}

fn merge_delta_resource(
  kind: &str,
  global: &PiResourceState,
  delta: &PiResourceState,
) -> PiResourceState {
  let mut filters = Vec::with_capacity(global.declared.len());
  let mut any_enabled = false;
  for path in &global.declared {
    let mut enabled = resource_path_enabled(kind, path, global);
    for pattern in &delta.filters {
      let target = pattern
        .strip_prefix(['!', '+', '-'])
        .unwrap_or(pattern.as_str());
      if manifest_pattern_matches(path, target, kind) {
        enabled = !matches!(pattern.chars().next(), Some('!' | '-'));
      }
    }
    any_enabled |= enabled;
    filters.push(format!("{}{path}", if enabled { '+' } else { '-' }));
  }
  PiResourceState {
    enabled: any_enabled,
    configured: true,
    filters,
    declared: global.declared.clone(),
  }
}

fn packages_from_settings(settings: &Value, base: &Path, scope: &str) -> Vec<PiPackageRecord> {
  let parsed: Vec<PiPackageRecord> = settings
    .get("packages")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(|raw| {
      let source = raw
        .as_str()
        .or_else(|| raw.get("source").and_then(Value::as_str))?
        .to_string();
      let object = if raw.is_object() {
        raw.clone()
      } else {
        serde_json::json!({"source":source})
      };
      let (source_kind, identity, pinned, requested_version, installed_path) =
        source_info(&source, base);
      let installed = installed_path.exists();
      let (installed_version, resources) = resources_for(&object, &installed_path);
      Some(PiPackageRecord {
        source: redact_package_source(&source),
        identity: redact_package_source(&identity),
        source_kind,
        pinned,
        autoload: object
          .get("autoload")
          .and_then(Value::as_bool)
          .unwrap_or(true),
        scope: scope.into(),
        inherited: false,
        overridden: false,
        installed,
        installed_path: installed.then(|| installed_path.to_string_lossy().into_owned()),
        version: installed_version.or(requested_version),
        resources,
      })
    })
    .collect();
  let mut deduped = Vec::new();
  for package in parsed {
    if let Some(index) = deduped
      .iter()
      .position(|existing: &PiPackageRecord| existing.identity == package.identity)
    {
      deduped[index] = package;
    } else {
      deduped.push(package);
    }
  }
  deduped
}

fn is_pi_package(path: &Path) -> bool {
  let manifest = fs::read_to_string(path.join("package.json"))
    .ok()
    .and_then(|text| serde_json::from_str::<Value>(&text).ok());
  manifest
    .as_ref()
    .and_then(|value| value.get("pi"))
    .is_some()
    || ["extensions", "skills", "prompts", "themes"]
      .into_iter()
      .any(|kind| path.join(kind).is_dir())
}

fn discovered_record(
  path: &Path,
  source: String,
  identity: String,
  source_kind: &str,
  scope: &str,
) -> PiPackageRecord {
  let (version, resources) = resources_for(&serde_json::json!({"source": source}), path);
  PiPackageRecord {
    source,
    identity,
    source_kind: source_kind.into(),
    pinned: false,
    autoload: true,
    scope: scope.into(),
    inherited: false,
    overridden: false,
    installed: true,
    installed_path: Some(path.to_string_lossy().into_owned()),
    version,
    resources,
  }
}

fn add_discovered_packages(packages: &mut Vec<PiPackageRecord>, base: &Path, scope: &str) {
  let npm_root = base.join("npm").join("node_modules");
  if let Ok(entries) = fs::read_dir(&npm_root) {
    for entry in entries.flatten() {
      let path = entry.path();
      if entry.file_name().to_string_lossy().starts_with('@') {
        if let Ok(scoped) = fs::read_dir(path) {
          for package in scoped.flatten() {
            let package_path = package.path();
            if !is_pi_package(&package_path) {
              continue;
            }
            let identity = format!(
              "{}/{}",
              entry.file_name().to_string_lossy(),
              package.file_name().to_string_lossy()
            );
            if !packages
              .iter()
              .any(|existing| existing.identity == identity)
            {
              packages.push(discovered_record(
                &package_path,
                format!("npm:{identity}"),
                identity,
                "npm",
                scope,
              ));
            }
          }
        }
      } else if is_pi_package(&path) {
        let identity = entry.file_name().to_string_lossy().into_owned();
        if !packages
          .iter()
          .any(|existing| existing.identity == identity)
        {
          packages.push(discovered_record(
            &path,
            format!("npm:{identity}"),
            identity,
            "npm",
            scope,
          ));
        }
      }
    }
  }

  fn visit_git(root: &Path, dir: &Path, scope: &str, packages: &mut Vec<PiPackageRecord>) {
    if dir.join(".git").exists() {
      if is_pi_package(dir) {
        let identity = dir
          .strip_prefix(root)
          .unwrap_or(dir)
          .to_string_lossy()
          .replace('\\', "/");
        if !packages
          .iter()
          .any(|existing| existing.identity == identity)
        {
          packages.push(discovered_record(
            dir,
            format!("git:{identity}"),
            identity,
            "git",
            scope,
          ));
        }
      }
      return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
      return;
    };
    for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
      visit_git(root, &entry.path(), scope, packages);
    }
  }
  let git_root = base.join("git");
  if git_root.is_dir() {
    visit_git(&git_root, &git_root, scope, packages);
  }
}

fn project_trust(cwd: &Path, agent_dir: &Path, global: &Value) -> PiTrustStatus {
  let canonical = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
  if let Ok(text) = fs::read_to_string(agent_dir.join("trust.json")) {
    if let Ok(store) = serde_json::from_str::<Value>(&text) {
      let mut current = Some(canonical.as_path());
      while let Some(path) = current {
        if let Some(value) = store
          .get(path.to_string_lossy().as_ref())
          .and_then(Value::as_bool)
        {
          return PiTrustStatus {
            state: if value { "trusted" } else { "untrusted" }.into(),
            source: "saved".into(),
          };
        }
        current = path.parent();
      }
    }
  }
  let fallback = global
    .get("defaultProjectTrust")
    .and_then(Value::as_str)
    .unwrap_or("ask");
  PiTrustStatus {
    state: fallback.into(),
    source: "default".into(),
  }
}

#[tauri::command(async)]
pub fn pi_management_scan(scope: PiScope) -> Result<PiPackageSnapshot, String> {
  let home = dirs::home_dir().ok_or("no home dir")?;
  let agent_dir = crate::paths::pi_home(&home);
  let global_path = agent_dir.join("settings.json");
  let mut errors = Vec::new();
  let global = settings_json(&global_path, &mut errors);
  let installed = crate::exec::on_path("pi");
  match scope {
    PiScope::Global => Ok(PiPackageSnapshot {
      installed,
      scope: "global".into(),
      cwd: None,
      settings_path: global_path.to_string_lossy().into_owned(),
      packages: {
        let mut packages = packages_from_settings(&global, &agent_dir, "global");
        add_discovered_packages(&mut packages, &agent_dir, "global");
        packages
      },
      trust: PiTrustStatus {
        state: "trusted".into(),
        source: "global".into(),
      },
      errors,
    }),
    PiScope::Project { cwd } => {
      let cwd_path = PathBuf::from(&cwd);
      if !cwd_path.is_dir() {
        return Err(format!("project directory does not exist: {cwd}"));
      }
      let local_dir = cwd_path.join(".pi");
      let local_path = local_dir.join("settings.json");
      let local = settings_json(&local_path, &mut errors);
      let mut packages = packages_from_settings(&global, &agent_dir, "global");
      add_discovered_packages(&mut packages, &agent_dir, "global");
      for package in &mut packages {
        package.inherited = true;
      }
      let mut local_packages = packages_from_settings(&local, &local_dir, "project");
      add_discovered_packages(&mut local_packages, &local_dir, "project");
      for local_package in &mut local_packages {
        if let Some(global_package) = packages
          .iter_mut()
          .find(|package| package.identity == local_package.identity)
        {
          if local_package.autoload {
            global_package.overridden = true;
          } else {
            local_package.inherited = true;
            if !local_package.installed && global_package.installed {
              local_package.installed = true;
              local_package.installed_path = global_package.installed_path.clone();
              local_package.version = global_package.version.clone();
            }
            for kind in ["extensions", "skills", "prompts", "themes"] {
              let configured = local_package
                .resources
                .get(kind)
                .is_some_and(|resource| resource.configured);
              if !configured {
                if let Some(inherited) = global_package.resources.get(kind).cloned() {
                  local_package.resources.insert(kind.into(), inherited);
                }
              } else if let (Some(local), Some(global)) = (
                local_package.resources.get(kind).cloned(),
                global_package.resources.get(kind),
              ) {
                local_package
                  .resources
                  .insert(kind.into(), merge_delta_resource(kind, global, &local));
              }
            }
          }
        }
      }
      packages.extend(local_packages);
      Ok(PiPackageSnapshot {
        installed,
        scope: "project".into(),
        cwd: Some(cwd.clone()),
        settings_path: local_path.to_string_lossy().into_owned(),
        packages,
        trust: project_trust(&cwd_path, &agent_dir, &global),
        errors,
      })
    }
  }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageSearchItem {
  source: String,
  name: String,
  version: String,
  description: String,
  publisher: String,
  license: String,
  repository: Option<String>,
  published_at: Option<String>,
  resources: Vec<String>,
}

fn http_agent() -> ureq::Agent {
  let mut builder = ureq::AgentBuilder::new()
    .timeout(Duration::from_secs(15))
    .redirects(3);
  if let Some(proxy) = crate::net::proxy_from_env() {
    builder = builder.proxy(proxy);
  }
  builder.build()
}

fn fetch_json(agent: &ureq::Agent, url: &str) -> Result<Value, String> {
  let response = agent.get(url).call().map_err(|error| error.to_string())?;
  let text = response.into_string().map_err(|error| error.to_string())?;
  serde_json::from_str(&text).map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn pi_package_search(query: String) -> Result<Vec<PiPackageSearchItem>, String> {
  let query = query.trim();
  if query.is_empty() {
    return Ok(Vec::new());
  }
  let encoded: String =
    url::form_urlencoded::byte_serialize(format!("{query} keywords:pi-package").as_bytes())
      .collect();
  let agent = http_agent();
  let result = fetch_json(
    &agent,
    &format!("https://registry.npmjs.org/-/v1/search?text={encoded}&size=20"),
  )?;
  let mut out = Vec::new();
  for package in result
    .get("objects")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
  {
    let Some(meta) = package.get("package") else {
      continue;
    };
    let keywords = strings(meta.get("keywords"));
    if !keywords.iter().any(|keyword| keyword == "pi-package") {
      continue;
    }
    let Some(name) = meta.get("name").and_then(Value::as_str) else {
      continue;
    };
    let encoded_name: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
    let Ok(latest) = fetch_json(
      &agent,
      &format!("https://registry.npmjs.org/{encoded_name}/latest"),
    ) else {
      continue;
    };
    let Some(manifest) = latest.get("pi").and_then(Value::as_object) else {
      continue;
    };
    let resources = ["extensions", "skills", "prompts", "themes"]
      .into_iter()
      .filter(|kind| manifest.contains_key(*kind))
      .map(str::to_string)
      .collect();
    out.push(PiPackageSearchItem {
      source: format!("npm:{name}"),
      name: name.into(),
      version: latest
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("")
        .into(),
      description: latest
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .into(),
      publisher: meta
        .get("publisher")
        .and_then(|v| v.get("username"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .into(),
      license: latest
        .get("license")
        .and_then(Value::as_str)
        .unwrap_or("")
        .into(),
      repository: meta
        .get("links")
        .and_then(|v| v.get("repository"))
        .and_then(Value::as_str)
        .and_then(safe_repository_url),
      published_at: meta.get("date").and_then(Value::as_str).map(str::to_string),
      resources,
    });
    if out.len() >= 12 {
      break;
    }
  }
  Ok(out)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PiAuthProviderStatus {
  provider: String,
  status: String,
  reason: Option<String>,
  auth_type: Option<String>,
  expires_at: Option<i64>,
  source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAuthReport {
  installed: bool,
  providers: Vec<PiAuthProviderStatus>,
}

fn auth_metadata(auth: &Value) -> Vec<PiAuthProviderStatus> {
  auth
    .as_object()
    .into_iter()
    .flat_map(|object| object.iter())
    .filter_map(|(provider, value)| {
      let provider = safe_provider_id(provider)?;
      let expires = value.get("expires").and_then(Value::as_i64).map(|value| {
        if value < 10_000_000_000 {
          value * 1000
        } else {
          value
        }
      });
      Some(PiAuthProviderStatus {
        provider,
        status: "configured".into(),
        reason: None,
        auth_type: value.get("type").and_then(safe_auth_type),
        expires_at: expires,
        source: "authFile".into(),
      })
    })
    .collect()
}

fn configured_providers(settings: &Value) -> BTreeSet<String> {
  let mut providers = BTreeSet::new();
  if let Some(provider) = settings
    .get("defaultProvider")
    .and_then(Value::as_str)
    .and_then(safe_provider_id)
  {
    providers.insert(provider);
  }
  if let Some(levels) = settings
    .get("modelThinkingLevels")
    .and_then(Value::as_object)
  {
    providers.extend(levels.keys().filter_map(|model| {
      model
        .split_once('/')
        .and_then(|(provider, _)| safe_provider_id(provider))
    }));
  }
  if let Some(models) = settings.get("models").and_then(Value::as_array) {
    for model in models {
      if let Some(provider) = model
        .get("provider")
        .and_then(Value::as_str)
        .and_then(safe_provider_id)
      {
        providers.insert(provider);
      } else if let Some(provider) = model
        .as_str()
        .and_then(|value| value.split_once('/').map(|(provider, _)| provider))
      {
        if let Some(provider) = safe_provider_id(provider) {
          providers.insert(provider);
        }
      }
    }
  }
  if let Some(configured) = settings.get("providers").and_then(Value::as_object) {
    providers.extend(
      configured
        .keys()
        .filter_map(|provider| safe_provider_id(provider)),
    );
  }
  providers
}

fn safe_reason(value: &Value) -> Option<String> {
  let reason = value.as_str()?;
  matches!(
    reason,
    "credentials_not_configured"
      | "auth_check_failed"
      | "pi_not_installed"
      | "expired"
      | "token_expired"
      | "missing_credentials"
      | "invalid_credentials"
      | "refresh_failed"
  )
  .then(|| reason.to_string())
}

fn safe_provider_id(value: &str) -> Option<String> {
  let lower = value.to_ascii_lowercase();
  let looks_like_secret = [
    "sk-", "sk_", "token-", "token_", "access-", "access_", "refresh-", "refresh_", "bearer-",
  ]
  .iter()
  .any(|prefix| lower.starts_with(prefix));
  (!looks_like_secret
    && !value.is_empty()
    && value.len() <= 64
    && value
      .chars()
      .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.')))
  .then(|| value.to_string())
}

fn safe_status(value: Option<&Value>) -> String {
  match value.and_then(Value::as_str) {
    Some("ready") => "ready",
    Some("valid") => "valid",
    Some("configured") => "configured",
    Some("expired") => "expired",
    Some("missing") => "missing",
    Some("not_ready") => "not_ready",
    _ => "invalid",
  }
  .into()
}

fn safe_auth_type(value: &Value) -> Option<String> {
  match value.as_str()? {
    "oauth" => Some("oauth".into()),
    "api_key" | "apiKey" => Some("api_key".into()),
    "environment" => Some("environment".into()),
    _ => None,
  }
}

fn safe_auth_source(value: &Value) -> Option<String> {
  let source = value.as_str()?.to_ascii_lowercase();
  if matches!(
    source.as_str(),
    "authfile" | "auth_file" | "oauth" | "subscription"
  ) {
    Some("authFile".into())
  } else if source == "environment" || source == "env" || source.starts_with("env:") {
    Some("environment".into())
  } else if source == "settings" || source == "models" || source == "models.json" {
    Some("settings".into())
  } else if source == "builtin" || source == "built_in" {
    Some("builtin".into())
  } else {
    None
  }
}

fn auth_check_args(provider: &str, refresh: bool) -> Vec<&str> {
  let mut args = vec!["auth", "check", "--provider", provider, "--json"];
  if !refresh {
    args.push("--no-refresh");
  }
  args
}

const SUBSCRIPTION_PROVIDERS: [&str; 6] = [
  "openai-codex",
  "anthropic",
  "github-copilot",
  "xai",
  "openrouter",
  "radius",
];

const ENV_PROVIDERS: &[(&str, &str)] = &[
  ("anthropic", "ANTHROPIC_API_KEY"),
  ("anthropic", "ANTHROPIC_AUTH_TOKEN"),
  ("anthropic", "ANTHROPIC_OAUTH_TOKEN"),
  ("ant-ling", "ANT_LING_API_KEY"),
  ("azure-openai-responses", "AZURE_OPENAI_API_KEY"),
  ("openai", "OPENAI_API_KEY"),
  ("github-copilot", "COPILOT_GITHUB_TOKEN"),
  ("deepseek", "DEEPSEEK_API_KEY"),
  ("nvidia", "NVIDIA_API_KEY"),
  ("google", "GEMINI_API_KEY"),
  ("amazon-bedrock", "AWS_BEARER_TOKEN_BEDROCK"),
  ("amazon-bedrock", "AWS_PROFILE"),
  ("amazon-bedrock", "AWS_ACCESS_KEY_ID"),
  ("amazon-bedrock", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"),
  ("amazon-bedrock", "AWS_CONTAINER_CREDENTIALS_FULL_URI"),
  ("amazon-bedrock", "AWS_WEB_IDENTITY_TOKEN_FILE"),
  ("mistral", "MISTRAL_API_KEY"),
  ("groq", "GROQ_API_KEY"),
  ("cerebras", "CEREBRAS_API_KEY"),
  ("cloudflare-ai-gateway", "CLOUDFLARE_API_KEY"),
  ("cloudflare-workers-ai", "CLOUDFLARE_API_KEY"),
  ("xai", "XAI_API_KEY"),
  ("openrouter", "OPENROUTER_API_KEY"),
  ("vercel-ai-gateway", "AI_GATEWAY_API_KEY"),
  ("zai", "ZAI_API_KEY"),
  ("zai-coding-cn", "ZAI_CODING_CN_API_KEY"),
  ("opencode", "OPENCODE_API_KEY"),
  ("opencode-go", "OPENCODE_API_KEY"),
  ("radius", "RADIUS_API_KEY"),
  ("huggingface", "HF_TOKEN"),
  ("fireworks", "FIREWORKS_API_KEY"),
  ("together", "TOGETHER_API_KEY"),
  ("baseten", "BASETEN_API_KEY"),
  ("kimi-coding", "KIMI_API_KEY"),
  ("moonshotai", "MOONSHOT_API_KEY"),
  ("moonshotai-cn", "MOONSHOT_API_KEY"),
  ("minimax", "MINIMAX_API_KEY"),
  ("minimax-cn", "MINIMAX_CN_API_KEY"),
  ("qwen-token-plan", "QWEN_TOKEN_PLAN_API_KEY"),
  ("qwen-token-plan-individual", "QWEN_TOKEN_PLAN_API_KEY"),
  ("qwen-token-plan-cn", "QWEN_TOKEN_PLAN_CN_API_KEY"),
  ("xiaomi", "XIAOMI_API_KEY"),
  ("xiaomi-token-plan-cn", "XIAOMI_TOKEN_PLAN_CN_API_KEY"),
  ("xiaomi-token-plan-ams", "XIAOMI_TOKEN_PLAN_AMS_API_KEY"),
  ("xiaomi-token-plan-sgp", "XIAOMI_TOKEN_PLAN_SGP_API_KEY"),
  ("google-vertex", "GOOGLE_APPLICATION_CREDENTIALS"),
  ("google-vertex", "GOOGLE_CLOUD_API_KEY"),
];

#[tauri::command(async)]
pub fn pi_auth_status(refresh: bool) -> Result<PiAuthReport, String> {
  let installed = crate::exec::on_path("pi");
  let home = dirs::home_dir().ok_or("no home dir")?;
  let auth = fs::read_to_string(crate::paths::pi_home(&home).join("auth.json"))
    .ok()
    .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    .unwrap_or_else(|| Value::Object(Default::default()));
  let agent_dir = crate::paths::pi_home(&home);
  let settings = fs::read_to_string(agent_dir.join("settings.json"))
    .ok()
    .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    .unwrap_or_else(|| Value::Object(Default::default()));
  let models = fs::read_to_string(agent_dir.join("models.json"))
    .ok()
    .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    .unwrap_or_else(|| Value::Object(Default::default()));
  let mut metadata: BTreeMap<String, PiAuthProviderStatus> = auth_metadata(&auth)
    .into_iter()
    .map(|status| (status.provider.clone(), status))
    .collect();
  for provider in SUBSCRIPTION_PROVIDERS {
    metadata
      .entry(provider.into())
      .or_insert(PiAuthProviderStatus {
        provider: provider.into(),
        status: "not_ready".into(),
        reason: Some("credentials_not_configured".into()),
        auth_type: None,
        expires_at: None,
        source: "builtin".into(),
      });
  }
  for provider in configured_providers(&settings) {
    metadata
      .entry(provider.clone())
      .or_insert(PiAuthProviderStatus {
        provider,
        status: "not_ready".into(),
        reason: Some("credentials_not_configured".into()),
        auth_type: None,
        expires_at: None,
        source: "settings".into(),
      });
  }
  for provider in configured_providers(&models) {
    metadata
      .entry(provider.clone())
      .or_insert(PiAuthProviderStatus {
        provider,
        status: "not_ready".into(),
        reason: Some("credentials_not_configured".into()),
        auth_type: None,
        expires_at: None,
        source: "settings".into(),
      });
  }
  for &(provider, env) in ENV_PROVIDERS {
    if std::env::var_os(env).is_some() {
      metadata
        .entry(provider.into())
        .and_modify(|status| {
          if status.source != "authFile" {
            status.status = "configured".into();
            status.reason = None;
            status.auth_type = Some("environment".into());
            status.source = "environment".into();
          }
        })
        .or_insert(PiAuthProviderStatus {
          provider: provider.into(),
          status: "configured".into(),
          reason: None,
          auth_type: Some("environment".into()),
          expires_at: None,
          source: "environment".into(),
        });
    }
  }
  if installed {
    for status in metadata.values_mut() {
      let args = auth_check_args(status.provider.as_str(), refresh);
      let output = crate::exec::build_command("pi", args).output();
      let parsed = output
        .ok()
        .and_then(|output| serde_json::from_slice::<Value>(&output.stdout).ok());
      if let Some(value) = parsed {
        status.status = safe_status(value.get("status"));
        status.reason = value.get("reason").and_then(safe_reason);
        if let Some(auth_type) = value
          .get("authType")
          .or_else(|| value.get("type"))
          .and_then(safe_auth_type)
        {
          status.auth_type = Some(auth_type);
        }
        if let Some(source) = value.get("source").and_then(safe_auth_source) {
          status.source = source;
        }
        status.expires_at = value
          .get("expiresAt")
          .or_else(|| value.get("expires"))
          .and_then(Value::as_i64)
          .map(|value| {
            if value < 10_000_000_000 {
              value * 1000
            } else {
              value
            }
          });
      } else {
        status.status = "invalid".into();
        status.reason = Some("auth_check_failed".into());
      }
    }
  } else {
    for status in metadata.values_mut() {
      status.status = "not_ready".into();
      status.reason = Some("pi_not_installed".into());
    }
  }
  Ok(PiAuthReport {
    installed,
    providers: metadata.into_values().collect(),
  })
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
  format!("'{}'", value.replace('\'', "'\\''"))
}

#[tauri::command(async)]
pub fn launch_pi_interactive(cwd: Option<String>) -> Result<(), String> {
  if !crate::exec::on_path("pi") {
    return Err("command not found: pi".into());
  }
  let cwd = match cwd.filter(|value| !value.trim().is_empty()) {
    Some(value) => PathBuf::from(value),
    None => dirs::home_dir().ok_or("no home dir")?,
  };
  if !cwd.is_dir() {
    return Err(format!(
      "working directory does not exist: {}",
      cwd.display()
    ));
  }
  #[cfg(target_os = "macos")]
  {
    let command = format!("cd {} && exec pi", shell_quote(&cwd.to_string_lossy()));
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    let status = Command::new("osascript")
      .args([
        "-e",
        &format!("tell application \"Terminal\" to do script \"{escaped}\""),
      ])
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status()
      .map_err(|error| error.to_string())?;
    status
      .success()
      .then_some(())
      .ok_or_else(|| "could not launch Pi in Terminal".into())
  }
  #[cfg(windows)]
  {
    if crate::exec::on_path("wt") {
      Command::new("wt")
        .args(["-d", cwd.to_string_lossy().as_ref(), "pi"])
        .spawn()
        .map_err(|e| e.to_string())?;
    } else {
      Command::new("cmd")
        .args(["/c", "start", "", "cmd", "/K", "pi"])
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
  }
  #[cfg(all(not(windows), not(target_os = "macos")))]
  {
    for terminal in ["x-terminal-emulator", "gnome-terminal", "konsole"] {
      if !crate::exec::on_path(terminal) {
        continue;
      }
      let mut command = Command::new(terminal);
      command.current_dir(&cwd);
      match terminal {
        "gnome-terminal" => {
          command.args(["--", "pi"]);
        }
        _ => {
          command.args(["-e", "pi"]);
        }
      }
      command.spawn().map_err(|e| e.to_string())?;
      return Ok(());
    }
    Err("no supported terminal application found".into())
  }
}

#[cfg(test)]
mod tests {
  use serde_json::json;

  #[test]
  fn auth_metadata_never_serializes_credentials() {
    let secret = "sk-secret-sentinel";
    let providers = super::auth_metadata(&json!({
      "openai-codex": {
        "type": "oauth",
        "access": secret,
        "refresh": "refresh-secret-sentinel",
        "expires": 1_800_000_000_000i64
      },
      "anthropic": { "type": "api_key", "key": secret }
    }));
    let wire = serde_json::to_string(&providers).unwrap();
    assert!(wire.contains("openai-codex"));
    assert!(wire.contains("oauth"));
    assert!(!wire.contains(secret));
    assert!(!wire.contains("refresh-secret-sentinel"));
  }

  #[test]
  fn auth_wire_fields_reject_injected_credentials() {
    let secret = "sk-secret-sentinel";
    let providers = super::auth_metadata(&json!({
      (secret): { "type": secret, "expires": 1_800_000_000_000i64 },
      "anthropic": { "type": "oauth" }
    }));
    let mut status = providers
      .into_iter()
      .find(|item| item.provider == "anthropic")
      .unwrap();
    let fake_output = json!({
      "status": secret,
      "authType": secret,
      "reason": secret
    });
    status.status = super::safe_status(fake_output.get("status"));
    status.auth_type = fake_output.get("authType").and_then(super::safe_auth_type);
    status.reason = fake_output.get("reason").and_then(super::safe_reason);
    let wire = serde_json::to_string(&status).unwrap();
    assert!(!wire.contains(secret));
    assert_eq!(status.status, "invalid");
  }

  #[test]
  fn package_sources_and_registry_links_are_redacted() {
    let secret = "sk-secret-sentinel";
    let source = format!("git:https://{secret}@github.com/acme/demo?token={secret}");
    let redacted = super::redact_package_source(&source);
    assert_eq!(redacted, "git:https://***@github.com/acme/demo?***");
    assert!(!redacted.contains(secret));
    assert_eq!(
      super::redact_package_source(&format!("git:ssh://{secret}@github.com/acme/demo")),
      "git:ssh://***@github.com/acme/demo"
    );
    assert_eq!(
      super::redact_package_source(&format!("git:{secret}@github.com:acme/demo")),
      "git:***@github.com:acme/demo"
    );
    let packages = super::packages_from_settings(
      &json!({"packages":[format!("git:{secret}@github.com:acme/demo")]}),
      std::path::Path::new("/missing"),
      "global",
    );
    let wire = serde_json::to_string(&packages).unwrap();
    assert!(!wire.contains(secret));
    assert!(wire.contains("github.com/acme/demo"));
  }

  #[test]
  fn parses_package_identity_pin_and_resource_filters() {
    let packages = super::packages_from_settings(
      &json!({
        "packages": [
          "npm:plain",
          {"source":"npm:@scope/pinned@1.2.3","skills":[],"themes":["themes/*.json"]},
          "git:github.com/acme/demo@v1"
        ]
      }),
      std::path::Path::new("/agent"),
      "global",
    );
    assert_eq!(packages.len(), 3);
    assert_eq!(packages[0].identity, "plain");
    assert!(!packages[0].pinned);
    assert_eq!(packages[1].identity, "@scope/pinned");
    assert!(packages[1].pinned);
    assert!(!packages[1].resources["skills"].enabled);
    assert_eq!(
      packages[1].resources["themes"].filters,
      vec!["themes/*.json"]
    );
    assert!(packages[2].pinned);
  }

  #[test]
  fn normalizes_bare_npm_scp_git_and_duplicate_package_entries() {
    let packages = super::packages_from_settings(
      &json!({
        "packages": [
          "plain-package",
          "npm:plain-package@2.0.0",
          "git:git@github.com:acme/demo@v2"
        ]
      }),
      std::path::Path::new("/agent"),
      "global",
    );
    assert_eq!(packages.len(), 2);
    assert_eq!(packages[0].identity, "plain-package");
    assert_eq!(packages[0].version.as_deref(), Some("2.0.0"));
    assert_eq!(packages[1].identity, "github.com/acme/demo");
    assert!(packages[1].installed_path.is_none());
    let (_, _, _, _, git_path) = super::source_info(
      "git:git@github.com:acme/demo@v2",
      std::path::Path::new("/agent"),
    );
    assert_eq!(
      git_path,
      std::path::Path::new("/agent/git/github.com/acme/demo")
    );
    let (_, identity, pinned, version, git_path) = super::source_info(
      "git:github.com/acme/demo@release/v1",
      std::path::Path::new("/agent"),
    );
    assert_eq!(identity, "github.com/acme/demo");
    assert!(pinned);
    assert_eq!(version.as_deref(), Some("release/v1"));
    assert_eq!(
      git_path,
      std::path::Path::new("/agent/git/github.com/acme/demo")
    );
  }

  #[test]
  fn recognizes_cross_platform_local_package_sources() {
    for source in [
      "./demo.ts",
      "../pkg",
      "~/pkg",
      r".\demo.ts",
      r"..\pkg",
      r"~\pkg",
      r"\\server\share\pkg",
      r"C:\packages\demo",
      "C:/packages/demo",
    ] {
      assert!(super::looks_like_local_source(source), "{source}");
    }
    for source in ["plain-package", "npm:@scope/pkg", "git:github.com/acme/pkg"] {
      assert!(!super::looks_like_local_source(source), "{source}");
    }
  }

  #[test]
  fn inventories_conventional_package_resources() {
    let root = std::env::temp_dir().join(format!(
      "agentpack-pi-package-resources-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("skills/demo")).unwrap();
    std::fs::create_dir_all(root.join("themes")).unwrap();
    std::fs::write(root.join("skills/demo/SKILL.md"), "# demo").unwrap();
    std::fs::write(root.join("themes/dark.json"), "{}").unwrap();
    std::fs::write(
      root.join("package.json"),
      r#"{"name":"demo","version":"1.0.0"}"#,
    )
    .unwrap();
    let (_, resources) = super::manifest_resources(&root);
    assert_eq!(resources["skills"], vec!["skills/demo/SKILL.md"]);
    assert_eq!(resources["themes"], vec!["themes/dark.json"]);
    let _ = std::fs::remove_dir_all(root);
  }

  #[test]
  fn expands_manifest_directories_and_globs_to_actual_resources() {
    let root = std::env::temp_dir().join(format!(
      "agentpack-pi-manifest-resources-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("skills/demo")).unwrap();
    std::fs::create_dir_all(root.join("themes")).unwrap();
    std::fs::write(root.join("skills/demo/SKILL.md"), "# demo").unwrap();
    std::fs::write(root.join("themes/dark.json"), "{}").unwrap();
    std::fs::write(root.join("themes/legacy.json"), "{}").unwrap();
    std::fs::write(
      root.join("package.json"),
      r#"{"name":"demo","pi":{"skills":["skills"],"themes":["themes/*.json","!themes/legacy.json"]}}"#,
    )
    .unwrap();
    let (_, resources) = super::manifest_resources(&root);
    assert_eq!(resources["skills"], vec!["skills/demo/SKILL.md"]);
    assert_eq!(resources["themes"], vec!["themes/dark.json"]);
    let _ = std::fs::remove_dir_all(root);
  }

  #[cfg(unix)]
  #[test]
  fn package_resource_inventory_rejects_symlinks_and_parent_traversal() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!(
      "agentpack-pi-resource-boundary-{}",
      std::process::id()
    ));
    let root = base.join("package");
    let outside = base.join("outside");
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(root.join("themes")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(root.join("themes/safe.json"), "{}").unwrap();
    std::fs::write(outside.join("secret.json"), "{}").unwrap();
    symlink(&outside, root.join("themes/external")).unwrap();
    symlink(&root, root.join("themes/loop")).unwrap();
    std::fs::write(
      root.join("package.json"),
      r#"{"name":"demo","pi":{"themes":["themes","../outside","themes/**"]}}"#,
    )
    .unwrap();

    let (_, resources) = super::manifest_resources(&root);
    assert_eq!(resources["themes"], vec!["themes/safe.json"]);
    let _ = std::fs::remove_dir_all(base);
  }

  #[cfg(unix)]
  #[test]
  fn package_resource_inventory_allows_only_an_explicit_symlink_root() {
    use std::os::unix::fs::symlink;

    let base = std::env::temp_dir().join(format!(
      "agentpack-pi-explicit-symlink-{}",
      std::process::id()
    ));
    let root = base.join("package");
    let shared = base.join("shared-themes");
    let nested = base.join("nested-themes");
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&shared).unwrap();
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(shared.join("shared.json"), "{}").unwrap();
    std::fs::write(nested.join("hidden.json"), "{}").unwrap();
    symlink(&nested, shared.join("nested")).unwrap();
    symlink(&shared, root.join("linked-themes")).unwrap();
    std::fs::write(
      root.join("package.json"),
      r#"{"name":"demo","pi":{"themes":["linked-themes"]}}"#,
    )
    .unwrap();

    let (_, resources) = super::manifest_resources(&root);
    assert_eq!(resources["themes"], vec!["linked-themes/shared.json"]);
    let _ = std::fs::remove_dir_all(base);
  }

  #[test]
  fn local_single_file_package_is_one_extension() {
    let base = std::env::temp_dir().join(format!(
      "agentpack-pi-single-extension-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    let extension = base.join("demo.ts");
    std::fs::write(&extension, "export default {};").unwrap();
    let packages = super::packages_from_settings(
      &json!({"packages":[extension.to_string_lossy()]}),
      &base,
      "global",
    );

    assert_eq!(packages.len(), 1);
    assert!(packages[0].installed);
    assert_eq!(
      packages[0].resources["extensions"].declared,
      vec!["demo.ts"]
    );
    let _ = std::fs::remove_dir_all(base);
  }

  #[test]
  fn project_delta_filters_override_each_declared_global_resource() {
    let global = super::PiResourceState {
      enabled: true,
      configured: false,
      filters: Vec::new(),
      declared: vec!["themes/a.json".into(), "themes/b.json".into()],
    };
    let delta = super::PiResourceState {
      enabled: true,
      configured: true,
      filters: vec!["-themes/a.json".into()],
      declared: Vec::new(),
    };
    let merged = super::merge_delta_resource("themes", &global, &delta);
    assert!(merged.enabled);
    assert_eq!(merged.filters, vec!["-themes/a.json", "+themes/b.json"]);
  }

  #[test]
  fn automatic_auth_checks_cannot_refresh_and_reasons_cannot_echo_secrets() {
    assert_eq!(
      super::auth_check_args("anthropic", false),
      vec![
        "auth",
        "check",
        "--provider",
        "anthropic",
        "--json",
        "--no-refresh"
      ]
    );
    assert_eq!(
      super::auth_check_args("anthropic", true),
      vec!["auth", "check", "--provider", "anthropic", "--json"]
    );
    assert_eq!(
      super::safe_reason(&json!("token_expired")),
      Some("token_expired".into())
    );
    assert_eq!(
      super::safe_reason(&json!("request failed for sk-secret-sentinel")),
      None
    );
    assert_eq!(super::safe_status(Some(&json!("ready"))), "ready");
    assert_eq!(
      super::safe_auth_source(&json!("env:ANTHROPIC_API_KEY")),
      Some("environment".into())
    );
    assert_eq!(super::safe_auth_source(&json!("sk-secret-sentinel")), None);
  }

  #[test]
  fn discovers_provider_ids_from_models_without_returning_model_configuration() {
    let providers = super::configured_providers(&json!({
      "defaultProvider": "google",
      "modelThinkingLevels": {"xai/grok": "high"},
      "models": [{"provider":"anthropic","id":"secret-model-config"}, "openrouter/model"],
      "providers": {"custom": {"apiKey":"sk-secret-sentinel"}}
    }));
    assert_eq!(
      providers.into_iter().collect::<Vec<_>>(),
      vec!["anthropic", "custom", "google", "openrouter", "xai"]
    );
  }
}
