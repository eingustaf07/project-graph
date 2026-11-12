// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TableEditor, editTableNode } from "./tableEditor";
import type { Project } from "@/core/Project";
import type { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { commitTableEdit } from "./tableEditActions";

const overlays = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));

vi.mock("./tableEditActions", () => ({ commitTableEdit: vi.fn() }));
vi.mock("@/components/overlay-host", () => ({ OverlayHost: overlays }));

it("edits cell values, adds rows and columns, and isolates editing keys from canvas commands", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    save = vi.fn(),
    cancel = vi.fn(),
    canvasKey = vi.fn();
  document.addEventListener("keydown", canvasKey);
  try {
    await act(() => root.render(<TableEditor initial={[["001", "中文"]]} onSave={save} onCancel={cancel} />));
    const cell = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="第1行第1列"]')!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(cell, "002");
      cell.dispatchEvent(new Event("input", { bubbles: true }));
      cell.dispatchEvent(new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true }));
    });
    expect(canvasKey).not.toHaveBeenCalled();
    const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
    await act(() => button("增加一行").click());
    await act(() => button("增加一列").click());
    await act(() => button("保存").click());
    expect(save).toHaveBeenCalledWith([
      ["002", "中文", ""],
      ["", "", ""],
    ]);
    await act(() =>
      cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    );
    expect(cancel).toHaveBeenCalled();
  } finally {
    document.removeEventListener("keydown", canvasKey);
    await act(() => root.unmount());
    host.remove();
  }
});

it("pages large tables instead of mounting every cell at once", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <TableEditor
          initial={Array.from({ length: 100 }, () => Array(30).fill("值"))}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      ),
    );
    expect(document.querySelectorAll("textarea")).toHaveLength(800);
    await act(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "下一页行")!.click());
    expect(document.querySelector('textarea[aria-label="第41行第1列"]')).not.toBeNull();
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("restores camera and keyboard state after save, cancel or a failed save without leaving an input interceptor", async () => {
  const project = {
    controller: { isCameraLocked: false },
    camera: { stopImmediately: vi.fn() },
    keyboardOnlyEngine: { isOpenning: () => true, setOpenning: vi.fn() },
  } as unknown as Project;
  const node = { text: "A\tB" } as TextNode;
  for (const action of ["save", "cancel", "failure"]) {
    vi.mocked(commitTableEdit).mockReset();
    if (action === "failure")
      vi.mocked(commitTableEdit).mockImplementation(() => {
        throw new Error("closed");
      });
    overlays.open.mockReset().mockReturnValue({ id: "table" });
    const pending = editTableNode(project, node);
    expect(project.controller.isCameraLocked).toBe(true);
    await editTableNode(project, node);
    expect(overlays.open).toHaveBeenCalledTimes(1);
    const props = overlays.open.mock.calls[0][0].props;
    if (action === "cancel") props.onCancel();
    else props.onSave([["C", "D"]]);
    await pending;
    expect(project.controller.isCameraLocked).toBe(false);
    expect(project.keyboardOnlyEngine.setOpenning).toHaveBeenLastCalledWith(true);
    expect(overlays.close).toHaveBeenCalledWith("table");
    expect(commitTableEdit).toHaveBeenCalledTimes(action === "cancel" ? 0 : 1);
  }
});
