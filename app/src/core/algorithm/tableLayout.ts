import { getTextSize, textToTextArray } from "@/utils/font";
import { parseTableText } from "./tableData";

export function layoutTable(
  text: string,
  fontSize: number,
  padding: number,
  fontFamily: string,
  fontWeight: string,
  width?: number,
) {
  const cells = parseTableText(text);
  let columnWidths = cells[0].map((_, c) => {
    let natural = fontSize * 3;
    for (const row of cells)
      for (const line of row[c].split(/\r?\n/))
        natural = Math.max(natural, getTextSize(line, fontSize, fontFamily, fontWeight).x);
    return Math.min(fontSize * 15, natural) + padding * 2;
  });
  if (width !== undefined) {
    const natural = columnWidths.reduce((sum, value) => sum + value, 0);
    columnWidths = columnWidths.map((value) => Math.max(fontSize * 2 + padding * 2, (value * width) / natural));
  }
  const lines = cells.map((row) =>
    row.map((cell, c) => textToTextArray(cell, fontSize, columnWidths[c] - padding * 2, fontFamily, fontWeight)),
  );
  const rowHeights = lines.map((row) => Math.max(1, ...row.map((cell) => cell.length)) * fontSize * 1.5 + padding * 2);
  return {
    cells,
    lines,
    columnWidths,
    rowHeights,
    width: columnWidths.reduce((sum, value) => sum + value, 0),
    height: rowHeights.reduce((sum, value) => sum + value, 0),
  };
}
