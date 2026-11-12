// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardTableUnavailable, readClipboardTable } from "./clipboardTable";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

it("prefers Excel text cells without requesting clipboard image or HTML access", async () => {
  expect(await readClipboardTable("001\t中文\r\n", false)).toEqual([["001", "中文"]]);
  expect(invoke).not.toHaveBeenCalled();
});
it("reads single-column and single-cell native Excel HTML", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  vi.mocked(invoke).mockResolvedValue("<table><tr><td>001</td></tr><tr><td>002</td></tr></table>");
  expect(await readClipboardTable("001\n002", false)).toEqual([["001"], ["002"]]);
  expect(invoke).toHaveBeenCalledWith("read_clipboard_table_html");
});
it("allows ordinary clipboard formats to fall through and distinguishes unavailable HTML access", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  vi.mocked(invoke).mockResolvedValue(null);
  expect(await readClipboardTable("普通文字", false)).toBeUndefined();
  vi.mocked(invoke).mockRejectedValue(new Error("busy"));
  await expect(readClipboardTable("图片说明", false)).rejects.toBeInstanceOf(ClipboardTableUnavailable);
});
