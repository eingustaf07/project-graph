// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import NodeTextPreview from "./node-text-preview";

it.each(["pointerdown", "click"])(
  "closes preview on %s without passing the press to canvas controls",
  async (eventType) => {
    const host = document.createElement("div");
    host.style.pointerEvents = "none";
    document.body.append(host);
    const root = createRoot(host);
    const mouse = vi.fn();
    const pointer = vi.fn();
    window.addEventListener("mousedown", mouse);
    window.addEventListener("pointerdown", pointer);
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <NodeTextPreview
          items={[
            { id: "a", text: "结论" },
            { id: "b", text: "问题？" },
          ]}
          onClose={() => setOpen(false)}
        />
      ) : null;
    }
    try {
      await act(() => root.render(<Harness />));
      const panel = document.querySelector("aside")!;
      expect(panel.parentElement).toBe(document.body);
      expect(panel.textContent).toContain("结论");
      expect(panel.textContent).toContain("问题？");
      const close = panel.querySelector<HTMLButtonElement>('button[aria-label="关闭节点文字预览"]')!;
      await act(() => {
        close.dispatchEvent(new MouseEvent("pointerdown", { button: 2, bubbles: true }));
      });
      expect(document.querySelector("aside")).not.toBeNull();
      await act(() => {
        if (eventType === "pointerdown") {
          close.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));
          return;
        }
        close.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        close.click();
      });
      expect(document.querySelector("aside")).toBeNull();
      expect(mouse).not.toHaveBeenCalled();
      expect(pointer).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
      host.remove();
      window.removeEventListener("mousedown", mouse);
      window.removeEventListener("pointerdown", pointer);
    }
  },
);
