use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU64, Ordering};

#[tauri::command]
pub(crate) fn supports_ai_popup() -> bool {
    cfg!(target_os = "windows")
}

pub(crate) fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let config = app.config().app.windows.first().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "缺少主窗口配置")
    })?;
    let builder = WebviewWindowBuilder::from_config(app, config)?;
    #[cfg(target_os = "windows")]
    let builder = {
        let app = app.clone();
        builder.on_new_window(move |url, features| {
            use tauri::webview::NewWindowResponse;
            if url.as_str() != "about:blank#pg-ai-popup" {
                return NewWindowResponse::Allow;
            }
            static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);
            let label = format!("ai-popup-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
            let popup = WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
                .window_features(features)
                .title("AI 助手 · Project Graph E")
                .min_inner_size(360.0, 420.0)
                .on_navigation(|url| url.as_str() == "about:blank#pg-ai-popup")
                .on_document_title_changed(|window, title| {
                    if let Err(error) = window.set_title(&title) { eprintln!("AI 窗口标题更新失败：{error}"); }
                });
            let popup = if let Some(icon) = app.default_window_icon() {
                match popup.icon(icon.clone()) {
                    Ok(builder) => builder,
                    Err(error) => { eprintln!("AI 窗口图标加载失败：{error}"); return NewWindowResponse::Deny; }
                }
            } else { popup };
            match popup.build() {
                Ok(window) => NewWindowResponse::Create { window },
                Err(error) => { eprintln!("AI 独立窗口创建失败：{error}"); NewWindowResponse::Deny }
            }
        })
    };
    builder.build()?;
    Ok(())
}
