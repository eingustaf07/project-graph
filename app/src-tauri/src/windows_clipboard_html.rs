use std::{ffi::c_void, ptr};

const MAX_HTML_BYTES: usize = 16 * 1024 * 1024;

#[link(name = "user32")]
extern "system" {
    fn RegisterClipboardFormatW(name: *const u16) -> u32;
    fn IsClipboardFormatAvailable(format: u32) -> i32;
    fn OpenClipboard(window: *mut c_void) -> i32;
    fn CloseClipboard() -> i32;
    fn GetClipboardData(format: u32) -> *mut c_void;
}
#[link(name = "kernel32")]
extern "system" {
    fn GlobalSize(memory: *mut c_void) -> usize;
    fn GlobalLock(memory: *mut c_void) -> *mut c_void;
    fn GlobalUnlock(memory: *mut c_void) -> i32;
}

fn decode_html(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_HTML_BYTES { return Err("表格内容过大，请分批复制".into()); }
    let end = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
    String::from_utf8(bytes[..end].to_vec()).map_err(|_| "表格剪贴板不是有效的UTF-8文本，请重新复制".into())
}

pub fn read_html() -> Result<Option<String>, String> {
    // CF_HTML is UTF-8 HTML in clipboard-owned movable memory; do not free the handle.
    let name: Vec<u16> = "HTML Format\0".encode_utf16().collect();
    let format = unsafe { RegisterClipboardFormatW(name.as_ptr()) };
    if format == 0 { return Err("无法读取表格剪贴板格式".into()); }
    if unsafe { IsClipboardFormatAvailable(format) } == 0 { return Ok(None); }
    if unsafe { OpenClipboard(ptr::null_mut()) } == 0 { return Err("剪贴板正被其他程序占用，请稍后再粘贴".into()); }
    let result = (|| {
        let memory = unsafe { GetClipboardData(format) };
        if memory.is_null() { return Err("无法读取表格剪贴板".into()); }
        let length = unsafe { GlobalSize(memory) };
        if length == 0 || length > MAX_HTML_BYTES { return Err("表格剪贴板为空或过大，请分批复制".into()); }
        let address = unsafe { GlobalLock(memory) };
        if address.is_null() { return Err("无法锁定表格剪贴板数据".into()); }
        let bytes = unsafe { std::slice::from_raw_parts(address.cast::<u8>(), length).to_vec() };
        unsafe { GlobalUnlock(memory); }
        decode_html(&bytes).map(Some)
    })();
    if unsafe { CloseClipboard() } == 0 { return Err("无法释放表格剪贴板读取锁".into()); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_unicode_headers_and_stops_at_the_clipboard_terminator() {
        assert_eq!(decode_html("Version:1.0\r\n<table><td>中文</td></table>\0padding".as_bytes()).unwrap(), "Version:1.0\r\n<table><td>中文</td></table>");
    }
    #[test]
    fn rejects_invalid_encoding() { assert!(decode_html(&[0xff, 0xfe]).is_err()); }
    #[test]
    fn rejects_oversized_payloads() { assert!(decode_html(&vec![0; MAX_HTML_BYTES + 1]).is_err()); }
}
