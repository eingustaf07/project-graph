import { invoke } from "@tauri-apps/api/core";
export { readFile } from "@tauri-apps/plugin-fs";

export function readClipboardImagePaths(): Promise<string[]> {
  return invoke<string[]>("read_clipboard_image_paths");
}
