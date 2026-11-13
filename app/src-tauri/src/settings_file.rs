use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FILE: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsSnapshot {
    revision: String,
    values: Option<Map<String, Value>>,
}

pub(crate) fn access(
    path: &Path,
    known_revision: Option<&str>,
    update: Option<(String, Value)>,
) -> Result<SettingsSnapshot, String> {
    let operation = || -> Result<SettingsSnapshot, Box<dyn std::error::Error>> {
        let parent = path.parent().ok_or("设置文件位置无效")?;
        fs::create_dir_all(parent)?;
        // Separate OS processes share this lock; a stale renderer must never save its whole cache.
        let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true)
            .open(path.with_extension("json.lock"))?;
        lock.lock()?;
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => b"{}".to_vec(),
            Err(error) => return Err(error.into()),
        };
        let mut revision = format!("{:x}", Sha256::digest(&bytes));
        if update.is_none() && known_revision == Some(revision.as_str()) {
            return Ok(SettingsSnapshot { revision, values: None });
        }
        let mut values: Map<String, Value> = serde_json::from_slice(&bytes)?;
        if let Some((key, value)) = update {
            values.insert(key, value);
            let serialized = serde_json::to_vec_pretty(&values)?;
            if path.exists() { OpenOptions::new().write(true).open(path)?; }
            let temporary = parent.join(format!(".settings-{}-{}.tmp", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
            let write_result = (|| -> io::Result<()> {
                let mut file = OpenOptions::new().create_new(true).write(true).open(&temporary)?;
                file.write_all(&serialized)?;
                file.sync_all()?;
                drop(file);
                fs::rename(&temporary, path)
            })();
            if write_result.is_err() { let _ = fs::remove_file(&temporary); }
            write_result?;
            revision = format!("{:x}", Sha256::digest(&serialized));
        }
        Ok(SettingsSnapshot { revision, values: Some(values) })
    };
    operation().map_err(|_| "无法同步或保存设置；原配置未被重置，请检查文件权限及设置文件格式".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier};

    #[test]
    fn child_writer() {
        let Some(path) = std::env::var_os("PG_SETTINGS_TEST_PATH") else { return; };
        let key = std::env::var("PG_SETTINGS_TEST_KEY").unwrap();
        for i in 0..30 { access(Path::new(&path), None, Some((key.clone(), json!(i)))).unwrap(); }
    }

    #[test]
    fn multiple_os_processes_do_not_lose_each_others_settings() {
        let dir = std::env::temp_dir().join(format!("pge-settings-process-{}-{}", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&dir).unwrap(); let path = dir.join("settings.json");
        let mut children: Vec<_> = (0..4).map(|index| {
            let module = module_path!().split_once("::").unwrap().1;
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", &format!("{module}::child_writer"), "--nocapture"])
                .env("PG_SETTINGS_TEST_PATH", &path).env("PG_SETTINGS_TEST_KEY", format!("key{index}"))
                .spawn().unwrap()
        }).collect();
        for child in &mut children { assert!(child.wait().unwrap().success()); }
        let values = access(&path, None, None).unwrap().values.unwrap();
        assert_eq!(values.len(), 4);
        for index in 0..4 { assert_eq!(values[&format!("key{index}")], json!(29)); }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn independent_writers_merge_latest_values_and_preserve_unknown_fields() {
        let dir = std::env::temp_dir().join(format!("pge-settings-{}-{}", std::process::id(), NEXT_FILE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, br#"{"old":false,"extension":{"keep":true}}"#).unwrap();
        let before = access(&path, None, None).unwrap();
        assert!(access(&path, Some(&before.revision), None).unwrap().values.is_none());
        let barrier = Arc::new(Barrier::new(8));
        let threads: Vec<_> = (0..8).map(|index| {
            let path = path.clone(); let barrier = barrier.clone();
            std::thread::spawn(move || { barrier.wait(); access(&path, None, Some((format!("key{index}"), json!(index)))).unwrap(); })
        }).collect();
        for thread in threads { thread.join().unwrap(); }
        let result = access(&path, Some(&before.revision), None).unwrap().values.unwrap();
        assert_eq!(result.len(), 10);
        assert_eq!(result["extension"], json!({"keep":true}));
        assert_eq!(result["old"], json!(false));
        for index in 0..8 { assert_eq!(result[&format!("key{index}")], json!(index)); }
        fs::write(&path, b"broken").unwrap();
        assert!(access(&path, None, Some(("old".into(), json!(true)))).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken");
        fs::remove_dir_all(dir).unwrap();
    }
}
