use crate::settings_file::{access, SettingsSnapshot};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn resolve_path(app: &tauri::AppHandle, requested: &str) -> Result<PathBuf, String> {
    if requested == "settings.json" {
        return app.path().app_data_dir().map(|dir| dir.join(requested)).map_err(|e| e.to_string());
    }
    if let Some(home) = dirs::home_dir() {
        let root = home.join(".project-graph-e").join("preferences");
        let path = root.join("settings.json");
        if root.join("profile-ready-v1").is_file() && Path::new(requested) == path {
            return Ok(path);
        }
    }
    Err("设置文件位置与当前应用配置不一致".into())
}

#[tauri::command]
pub(crate) async fn read_shared_settings(app: tauri::AppHandle, path: String, revision: Option<String>) -> Result<SettingsSnapshot, String> {
    let path = resolve_path(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || access(&path, revision.as_deref(), None))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn write_shared_setting(app: tauri::AppHandle, path: String, key: String, value: Value) -> Result<SettingsSnapshot, String> {
    let path = resolve_path(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || access(&path, None, Some((key, value))))
        .await.map_err(|e| e.to_string())?
}
