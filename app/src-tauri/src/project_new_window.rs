use serde_json::Value;
use std::{fs, path::PathBuf, process::Command, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::Manager;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const SESSION_ENV: &str = "PG_E_DETACHED_PROJECT_SESSION";

#[tauri::command]
pub(crate) async fn open_project_in_new_window(app: tauri::AppHandle, session: Value) -> Result<(), String> {
    let path = session.get("path").and_then(Value::as_str).ok_or("缺少工程路径")?;
    if !std::path::Path::new(path).is_file() || !path.to_lowercase().ends_with(".prg") {
        return Err("请选择已保存的 prg 文件".into());
    }
    let directory = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("window-transfers");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let session_path = directory.join(format!("{}-{stamp}.json", std::process::id()));
    fs::write(&session_path, serde_json::to_vec(&session).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let result_path = session_path.with_extension("result");
        let launch = (|| {
            let executable = std::env::current_exe().map_err(|e| e.to_string())?;
            let mut command = Command::new(executable);
            command.env(SESSION_ENV, &session_path);
            #[cfg(target_os = "windows")]
            command.creation_flags(0x08000000);
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            let deadline = std::time::Instant::now() + Duration::from_secs(90);
            let result = loop {
                if result_path.exists() {
                    let result = fs::read(&result_path).map_err(|e| e.to_string())
                        .and_then(|bytes| serde_json::from_slice::<Option<String>>(&bytes).map_err(|e| e.to_string()));
                    break match result {
                        Ok(None) => Ok(()),
                        Ok(Some(error)) => Err(error),
                        Err(error) => Err(error),
                    };
                }
                match child.try_wait() {
                    Ok(Some(_)) => break Err("新窗口在完成加载前已退出".into()),
                    Err(error) => break Err(error.to_string()),
                    Ok(None) => {}
                }
                if std::time::Instant::now() >= deadline {
                    break Err("新窗口加载超时，已保留保存的工程".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            if result.is_err() {
                child.kill().map_err(|e| format!("新窗口失败且无法关闭：{e}"))?;
                child.wait().map_err(|e| e.to_string())?;
            }
            result
        })();
        for path in [&session_path, &result_path] {
            if path.exists() {
                if let Err(error) = fs::remove_file(path) {
                    eprintln!("Window transfer cache cleanup failed: {error}");
                }
            }
        }
        launch
    }).await.map_err(|e| e.to_string())?
}

fn incoming_session_path(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let Some(value) = std::env::var_os(SESSION_ENV) else { return Ok(None) };
    let path = PathBuf::from(value);
    let directory = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("window-transfers");
    if path.parent() != Some(directory.as_path()) || path.extension().and_then(|s| s.to_str()) != Some("json") {
        return Err("新窗口会话路径无效".into());
    }
    Ok(Some(path))
}

#[tauri::command]
pub(crate) fn get_detached_project_session(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    incoming_session_path(&app)?.map(|path| {
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }).transpose()
}

#[tauri::command]
pub(crate) fn finish_detached_project_window(app: tauri::AppHandle, error: Option<String>) -> Result<(), String> {
    let path = incoming_session_path(&app)?.ok_or("当前窗口没有待接收的工程")?;
    let temporary = path.with_extension("writing");
    let result = path.with_extension("result");
    fs::write(&temporary, serde_json::to_vec(&error).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temporary, result).map_err(|e| e.to_string())?;
    std::env::remove_var(SESSION_ENV);
    Ok(())
}
