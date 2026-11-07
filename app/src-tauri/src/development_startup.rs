use std::os::windows::process::CommandExt;
use std::process::Command;

pub fn start() -> Result<(), Box<dyn std::error::Error>> {
    let script = std::env::current_exe()?
        .parent()
        .ok_or("Missing executable directory")?
        .join("start-server.ps1");
    if !script.is_file() {
        return Err("Missing development server launcher".into());
    }
    let status = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .creation_flags(0x08000000)
        .status()?;
    if !status.success() {
        return Err(format!("Development server launcher exited with {status}").into());
    }
    Ok(())
}
