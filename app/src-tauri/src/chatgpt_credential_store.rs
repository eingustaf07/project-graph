use std::{fs, io, path::{Path, PathBuf}, time::SystemTime};

pub fn directory(home: &Path) -> PathBuf {
    home.join(".project-graph").join("credentials").join("chatgpt")
}

pub fn legacy_paths(home: &Path, app_data: &Path) -> Vec<PathBuf> {
    let profile = "eingustaf07.project-graph-pg11";
    vec![
        app_data.join("chatgpt-auth.dpapi"),
        home.join("AppData/Roaming").join(profile).join("chatgpt-auth.dpapi"),
        home.join("AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming")
            .join(profile).join("chatgpt-auth.dpapi"),
    ]
}

pub fn newest_legacy(paths: &[PathBuf]) -> io::Result<Option<PathBuf>> {
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for path in paths {
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if !metadata.is_file() { continue; }
        let modified = metadata.modified()?;
        if newest.as_ref().map_or(true, |(time, _)| modified > *time) {
            newest = Some((modified, path.clone()));
        }
    }
    Ok(newest.map(|(_, path)| path))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_location_is_independent_of_version_and_launch_context() {
        let home = Path::new("user-home");
        let stable = directory(home);
        assert_eq!(stable, home.join(".project-graph/credentials/chatgpt"));
        assert_ne!(stable, home.join("AppData/Roaming/eingustaf07.project-graph-pg11"));
        assert_ne!(stable, home.join("AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/eingustaf07.project-graph-pg11"));
    }

    #[test]
    fn migration_chooses_latest_file_and_does_not_modify_legacy_files() {
        let folder = std::env::temp_dir().join(format!("pg-auth-path-test-{}-{}", std::process::id(),
            SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&folder).unwrap();
        let first = folder.join("native.dpapi");
        let second = folder.join("packaged.dpapi");
        fs::write(&first, b"older-encrypted-fixture").unwrap();
        fs::write(&second, b"newer-encrypted-fixture").unwrap();
        let first_file = fs::OpenOptions::new().write(true).open(&first).unwrap();
        first_file.set_times(fs::FileTimes::new().set_modified(SystemTime::UNIX_EPOCH +
            std::time::Duration::from_secs(100))).unwrap();
        drop(first_file);
        assert_eq!(newest_legacy(&[first.clone(), second.clone()]).unwrap(), Some(second.clone()));
        assert_eq!(fs::read(&first).unwrap(), b"older-encrypted-fixture");
        assert_eq!(fs::read(&second).unwrap(), b"newer-encrypted-fixture");
        // A recent signed-out record must win over an older signed-in record too.
        fs::write(&second, b"signed-out-encrypted-fixture").unwrap();
        assert_eq!(newest_legacy(&[first.clone(), second.clone()]).unwrap(), Some(second.clone()));
        assert_eq!(newest_legacy(&[folder.join("missing")]).unwrap(), None);
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
        fs::remove_dir(folder).unwrap();
    }
}
