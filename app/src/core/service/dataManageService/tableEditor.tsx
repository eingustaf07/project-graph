import { useState } from "react";
import type { Project } from "@/core/Project";
import type { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { parseTableText, normalizeTable } from "@/core/algorithm/tableData";
import { commitTableEdit } from "./tableEditActions";
import { OverlayHost } from "@/components/overlay-host";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function TableEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string[][];
  onSave: (cells: string[][]) => void;
  onCancel: () => void;
}) {
  const [cells, setCells] = useState(() => normalizeTable(initial));
  const [page, setPage] = useState(0),
    [columnsPage, setColumnsPage] = useState(0);
  const rowStart = page * 40,
    colStart = columnsPage * 20;
  const update = (r: number, c: number, value: string) =>
    setCells((old) => old.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)));
  const expand = (rows: string[][]) => {
    try {
      setCells(normalizeTable(rows));
    } catch (error) {
      toast.error(String(error));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] max-w-[95vw] flex-col sm:max-w-[95vw]"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onKeyUp={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>编辑表格</DialogTitle>
          <DialogDescription>直接编辑单元格，按 Tab 切换。保存后应用修改，Esc 取消。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
            上一页行
          </Button>
          <span>
            第 {rowStart + 1}–{Math.min(rowStart + 40, cells.length)} 行，共 {cells.length} 行
          </span>
          <Button variant="outline" disabled={rowStart + 40 >= cells.length} onClick={() => setPage(page + 1)}>
            下一页行
          </Button>
          <Button variant="outline" disabled={columnsPage === 0} onClick={() => setColumnsPage(columnsPage - 1)}>
            上一组列
          </Button>
          <span>
            第 {colStart + 1}–{Math.min(colStart + 20, cells[0].length)} 列，共 {cells[0].length} 列
          </span>
          <Button
            variant="outline"
            disabled={colStart + 20 >= cells[0].length}
            onClick={() => setColumnsPage(columnsPage + 1)}
          >
            下一组列
          </Button>
        </div>
        <div className="min-h-0 overflow-auto rounded border">
          <table className="border-collapse">
            <tbody>
              {cells.slice(rowStart, rowStart + 40).map((row, i) => (
                <tr key={rowStart + i}>
                  {row.slice(colStart, colStart + 20).map((cell, j) => (
                    <td key={colStart + j} className="border p-1">
                      <Textarea
                        aria-label={`第${rowStart + i + 1}行第${colStart + j + 1}列`}
                        className="min-h-12 min-w-36 resize-y font-sans text-sm"
                        value={cell}
                        onChange={(event) => update(rowStart + i, colStart + j, event.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => expand([...cells, cells[0].map(() => "")])}>
            增加一行
          </Button>
          <Button variant="outline" onClick={() => expand(cells.map((row) => [...row, ""]))}>
            增加一列
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={() => onSave(cells)}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const editing = new WeakSet<TextNode>();
export async function editTableNode(project: Project, node: TextNode): Promise<void> {
  if (editing.has(node)) return;
  editing.add(node);
  const locked = project.controller.isCameraLocked,
    keyboardOpen = project.keyboardOnlyEngine.isOpenning();
  project.controller.isCameraLocked = true;
  project.keyboardOnlyEngine.setOpenning(false);
  try {
    project.camera.stopImmediately();
    const cells = await new Promise<string[][] | undefined>((resolve) => {
      const overlay = OverlayHost.open(
        <TableEditor initial={parseTableText(node.text)} onCancel={() => finish()} onSave={(value) => finish(value)} />,
      );
      const finish = (value?: string[][]) => {
        OverlayHost.close(overlay.id);
        resolve(value);
      };
    });
    if (cells) commitTableEdit(project, node, cells);
  } catch (error) {
    toast.error(`表格编辑未保存：${String(error)}`);
  } finally {
    project.controller.isCameraLocked = locked;
    project.keyboardOnlyEngine.setOpenning(keyboardOpen);
    editing.delete(node);
  }
}
