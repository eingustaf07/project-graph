// @vitest-environment jsdom
import { expect, it } from "vitest";
import { normalizeTable, parseClipboardTableText, parseHtmlTable, parseTableText, tableToText } from "./tableData";

it("keeps Excel rows, blank cells, leading zeros, quotes and multiline values", () => {
  expect(parseTableText('编号\t内容\t\r\n001\t"一\n二"\t\r\n')).toEqual([
    ["编号", "内容", ""],
    ["001", "一\n二", ""],
  ]);
  const cells = [
    ["a\tb", '引号"内容', "首行\n次行"],
    ["", "", ""],
  ];
  expect(parseTableText(tableToText(cells))).toEqual(cells);
});
it("does not mistake ordinary text or quoted tabs in a single cell for a spreadsheet", () => {
  expect(parseClipboardTableText("图片说明")).toBeUndefined();
  expect(parseClipboardTableText('"一个\t单元格"')).toBeUndefined();
  expect(parseClipboardTableText("a\tb")).toEqual([["a", "b"]]);
});
it("retains blank last rows, columns and single-cell HTML tables", () => {
  expect(parseTableText("a\tb\r\n\t\r\n")).toEqual([
    ["a", "b"],
    ["", ""],
  ]);
  expect(parseHtmlTable("<table><tr><td>001</td></tr></table>")).toEqual([["001"]]);
});
it("reads only inert cell text and preserves merged-cell grid positions", () => {
  expect(
    parseHtmlTable(
      'Version:1.0\r\n<table><tr><td rowspan="2">中文<br>第二行<script>bad()</script></td><td>2</td></tr><tr><td>3</td></tr></table>',
    ),
  ).toEqual([
    ["中文\n第二行", "2"],
    ["", "3"],
  ]);
  expect(parseHtmlTable('<table><tr><td colspan="2">合并</td></tr><tr><td>A</td><td>B</td></tr></table>')).toEqual([
    ["合并", ""],
    ["A", "B"],
  ]);
});
it("rejects oversized or malformed input without recursively processing it", () => {
  expect(() => parseTableText("x\t".repeat(1001))).toThrow(/过大/);
  expect(() => normalizeTable(Array.from({ length: 10001 }, () => [""]))).toThrow(/行数/);
  expect(() => parseTableText('"missing\tquote')).toThrow(/引号/);
  expect(() => parseHtmlTable('<table><tr><td colspan="1000000">x</td></tr></table>')).toThrow(/过大/);
});
