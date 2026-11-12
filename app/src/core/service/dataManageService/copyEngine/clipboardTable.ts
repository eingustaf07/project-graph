import { invoke } from "@tauri-apps/api/core";
import { parseClipboardTableText, parseHtmlTable } from "@/core/algorithm/tableData";

export class ClipboardTableUnavailable extends Error {
  constructor(cause: unknown) {
    super("当前剪贴板表格格式无法读取", { cause });
  }
}

export async function readClipboardTable(text: string, web: boolean): Promise<string[][] | undefined> {
  const cells = parseClipboardTableText(text);
  if (cells) return cells;
  let html: string | null = null;
  try {
    if (!web && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      html = await invoke<string | null>("read_clipboard_table_html");
    } else if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes("text/html")) {
          html = await (await item.getType("text/html")).text();
          break;
        }
      }
    }
  } catch (error) {
    throw new ClipboardTableUnavailable(error);
  }
  return html ? parseHtmlTable(html) : undefined;
}
