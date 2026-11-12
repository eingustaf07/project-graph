export const MAX_TABLE_CELLS = 100000;
export const MAX_TABLE_ROWS = 10000;
export const MAX_TABLE_COLUMNS = 1000;

export function normalizeTable(rows: string[][]): string[][] {
  if (rows.length > MAX_TABLE_ROWS) throw new Error("表格行数过多，请分批复制");
  let columns = 1;
  for (const row of rows) columns = Math.max(columns, row.length);
  if (columns > MAX_TABLE_COLUMNS || rows.length * columns > MAX_TABLE_CELLS)
    throw new Error("表格过大，请分批复制（最多10万个单元格）");
  return (rows.length ? rows : [[""]]).map((row) => Array.from({ length: columns }, (_, c) => row[c] ?? ""));
}

export function parseTableText(text: string): string[][] {
  if (text.length > 16 * 1024 * 1024) throw new Error("表格内容过大，请分批复制");
  const rows: string[][] = [[]];
  let cell = "",
    quoted = false,
    atStart = true;
  let cellCount = 0;
  const push = () => {
    if (++cellCount > MAX_TABLE_CELLS || rows.at(-1)!.length >= MAX_TABLE_COLUMNS)
      throw new Error("表格过大，请分批复制");
    rows.at(-1)!.push(cell);
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && (quoted || atStart)) {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && ch === "\t") {
      push();
      atStart = true;
      continue;
    } else if (!quoted && (ch === "\r" || ch === "\n")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      push();
      rows.push([]);
      atStart = true;
      if (rows.length > MAX_TABLE_ROWS + 1) throw new Error("表格行数过多，请分批复制");
      continue;
    } else cell += ch;
    atStart = false;
  }
  if (quoted) throw new Error("表格中的引号不完整，请重新复制");
  if (rows.length > 1 && rows.at(-1)!.length === 0 && cell === "" && /[\r\n]$/.test(text)) rows.pop();
  else push();
  return normalizeTable(rows);
}

export function tableToText(rows: string[][]): string {
  return normalizeTable(rows)
    .map((row) =>
      row.map((cell) => (/[\t\r\n"]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell)).join("\t"),
    )
    .join("\n");
}

export function parseClipboardTableText(text: string): string[][] | undefined {
  if (!text.includes("\t")) return;
  const rows = parseTableText(text);
  return rows[0].length > 1 ? rows : undefined;
}

export function parseHtmlTable(html: string): string[][] | undefined {
  if (!/<table[\s>]/i.test(html)) return;
  if (html.length > 16 * 1024 * 1024) throw new Error("表格内容过大，请分批复制");
  // Template contents stay inert: clipboard markup is never attached to the document.
  const template = document.createElement("template");
  template.innerHTML = html;
  const table = template.content.querySelector("table");
  if (!table) return;
  const rows: string[][] = [];
  const occupied = new Set<string>();
  const sourceRows = [...table.querySelectorAll("tr")].filter((row) => row.closest("table") === table);
  if (sourceRows.length > MAX_TABLE_ROWS) throw new Error("表格行数过多，请分批复制");
  sourceRows.forEach((row, r) => {
    rows[r] ??= [];
    let c = 0;
    for (const cell of [...row.children].filter((cell) => cell.matches("td,th"))) {
      while (occupied.has(r + ":" + c)) c++;
      const width = Math.max(1, Number.parseInt(cell.getAttribute("colspan") ?? "1") || 1);
      const height = Math.max(1, Number.parseInt(cell.getAttribute("rowspan") ?? "1") || 1);
      if (c + width > MAX_TABLE_COLUMNS || r + height > MAX_TABLE_ROWS || (r + height) * (c + width) > MAX_TABLE_CELLS)
        throw new Error("表格过大，请分批复制");
      const content = cell.cloneNode(true) as Element;
      content.querySelectorAll("script,style,iframe,object").forEach((element) => element.remove());
      content.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
      for (let y = r; y < r + height; y++) {
        rows[y] ??= [];
        for (let x = c; x < c + width; x++) {
          occupied.add(y + ":" + x);
          rows[y][x] = "";
        }
      }
      rows[r][c] = content.textContent?.replaceAll("\u00a0", " ") ?? "";
      c += width;
    }
  });
  return rows.length ? normalizeTable(rows) : undefined;
}
