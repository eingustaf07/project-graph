// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod development_startup;

fn main() {
    #[cfg(target_os = "windows")]
    if option_env!("PG_DEVELOPMENT_SHELL") == Some("1") {
        if let Err(error) = development_startup::start() {
            eprintln!("Development server startup failed: {error}");
            std::process::exit(1);
        }
    }
    // 测试发现可以给run函数增加一些自定义的参数。
    // 当时是想传一个时间戳来测试时间，但想想好像没必要 ——littlefean
    project_graph_lib::run()
}
