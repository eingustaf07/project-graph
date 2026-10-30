use std::{ffi::c_void, path::Path, ptr};

const CF_HDROP: u32 = 15;
const MAX_FILES: u32 = 128;

#[link(name = "user32")]
extern "system" {
    fn IsClipboardFormatAvailable(format: u32) -> i32;
    fn OpenClipboard(window: *mut c_void) -> i32;
    fn CloseClipboard() -> i32;
    fn GetClipboardData(format: u32) -> *mut c_void;
}
#[link(name = "shell32")]
extern "system" {
    fn DragQueryFileW(drop: *mut c_void, index: u32, buffer: *mut u16, length: u32) -> u32;
}

fn supported_image_path(path: &str) -> bool {
    Path::new(path).extension().and_then(|ext| ext.to_str()).is_some_and(|ext| {
        matches!(ext.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp")
    })
}

// The handle remains owned by the clipboard. Copy the names while open; never free this handle.
unsafe fn paths_from_drop(drop: *mut c_void) -> Result<Vec<String>, String> {
    if drop.is_null() { return Err("无法读取剪贴板中的文件列表".into()); }
    let count = DragQueryFileW(drop, u32::MAX, ptr::null_mut(), 0);
    if count > MAX_FILES { return Err("一次最多粘贴128个文件，请分批复制".into()); }
    let mut paths = Vec::new();
    for index in 0..count {
        let length = DragQueryFileW(drop, index, ptr::null_mut(), 0);
        if length == 0 || length > 32767 { return Err("剪贴板文件名无效或过长".into()); }
        let mut buffer = vec![0u16; length as usize + 1];
        if DragQueryFileW(drop, index, buffer.as_mut_ptr(), buffer.len() as u32) != length {
            return Err("剪贴板文件列表读取不完整，请重新复制".into());
        }
        let path = String::from_utf16(&buffer[..length as usize]).map_err(|_| "剪贴板文件名编码无效".to_string())?;
        if supported_image_path(&path) && !paths.contains(&path) { paths.push(path); }
    }
    Ok(paths)
}

pub fn read_image_paths() -> Result<Vec<String>, String> {
    // Merely checking the format avoids locking the clipboard for ordinary text/image pastes.
    if unsafe { IsClipboardFormatAvailable(CF_HDROP) } == 0 { return Ok(Vec::new()); }
    if unsafe { OpenClipboard(ptr::null_mut()) } == 0 {
        return Err("剪贴板正被其他程序占用，请稍后再按一次粘贴".into());
    }
    let result = unsafe { paths_from_drop(GetClipboardData(CF_HDROP)) };
    if unsafe { CloseClipboard() } == 0 { return Err("无法释放剪贴板读取锁".into()); }
    let paths = result?;
    let mut total = 0u64;
    for path in &paths {
        let metadata = std::fs::metadata(path).map_err(|_| "复制的图片文件已移动、删除或不可读取".to_string())?;
        if !metadata.is_file() { return Err("复制的图片路径不是文件".into()); }
        if metadata.len() > 64 * 1024 * 1024 { return Err("单张图片文件不能超过64MiB".into()); }
        total += metadata.len();
        if total > 256 * 1024 * 1024 { return Err("一次复制的图片总大小不能超过256MiB，请分批粘贴".into()); }
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
    }
    struct DropFixture(*mut c_void);
    impl DropFixture {
        fn new(paths: &[&str]) -> Self {
            let mut wide = Vec::new();
            for path in paths { wide.extend(path.encode_utf16()); wide.push(0); }
            wide.extend([0, 0]);
            let handle = unsafe { GlobalAlloc(0x42, 20 + wide.len() * 2) };
            assert!(!handle.is_null());
            let address = unsafe { GlobalLock(handle) };
            assert!(!address.is_null());
            unsafe {
                // DROPFILES: pFiles=20, POINT=(0,0), fNC=0, fWide=1.
                ptr::write_unaligned(address.cast::<u32>(), 20);
                ptr::write_unaligned(address.cast::<u8>().add(16).cast::<i32>(), 1);
                ptr::copy_nonoverlapping(wide.as_ptr(), address.cast::<u8>().add(20).cast::<u16>(), wide.len());
                GlobalUnlock(handle);
            }
            Self(handle)
        }
    }
    impl Drop for DropFixture { fn drop(&mut self) { unsafe { GlobalFree(self.0); } } }

    #[test]
    fn reads_real_windows_hdrop_unicode_paths_and_filters_non_images() {
        let fixture = DropFixture::new(&[r"C:\图片\截图 一.PNG", r"D:\test\photo.jpg", r"C:\notes.txt"]);
        let paths = unsafe { paths_from_drop(fixture.0) }.unwrap();
        assert_eq!(paths, vec![r"C:\图片\截图 一.PNG", r"D:\test\photo.jpg"]);
    }
    #[test]
    fn accepts_supported_case_insensitive_extensions_only() {
        for ext in ["png", "JPG", "Jpeg", "webp", "gif", "BMP"] { assert!(supported_image_path(&format!("C:\\img.{ext}"))); }
        for path in ["C:\\img.exe", "C:\\img.png.exe", "C:\\folder", "C:\\doc.prg"] { assert!(!supported_image_path(path)); }
    }
    #[test]
    fn deduplicates_paths_and_preserves_clipboard_order() {
        let fixture = DropFixture::new(&[r"C:\b.png", r"C:\a.png", r"C:\b.png"]);
        assert_eq!(unsafe { paths_from_drop(fixture.0) }.unwrap(), vec![r"C:\b.png", r"C:\a.png"]);
    }
    #[test]
    fn rejects_null_handles() { assert!(unsafe { paths_from_drop(ptr::null_mut()) }.is_err()); }
    #[test]
    fn rejects_oversized_file_lists() {
        let names = vec![r"C:\img.png"; 129]; let fixture = DropFixture::new(&names);
        assert!(unsafe { paths_from_drop(fixture.0) }.is_err());
    }
    #[test]
    fn non_image_file_lists_have_no_image_paths() {
        let fixture = DropFixture::new(&[r"C:\note.txt", r"C:\book.pdf"]);
        assert!(unsafe { paths_from_drop(fixture.0) }.unwrap().is_empty());
    }
}
