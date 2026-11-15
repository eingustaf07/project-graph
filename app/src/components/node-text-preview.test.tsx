// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import NodeTextPreview, { centerPreviewNode } from "./node-text-preview";
import { Vector } from "@graphif/data-structures";
import type { Project } from "@/core/Project";

it.each(["pointerdown", "click"])(
  "closes preview on %s without passing the press to canvas controls",
  async (eventType) => {
    const host = document.createElement("div");
    host.style.pointerEvents = "none";
    document.body.append(host);
    const root = createRoot(host);
    const mouse = vi.fn();
    const pointer = vi.fn();
    const navigate = vi.fn();
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
          onNavigate={navigate}
        />
      ) : null;
    }
    try {
      await act(() => root.render(<Harness />));
      const panel = document.querySelector("aside")!;
      expect(panel.parentElement).toBe(document.body);
      expect(panel.textContent).toContain("结论");
      expect(panel.textContent).toContain("问题？");
      const rows = panel.querySelectorAll<HTMLElement>("[data-preview-node]");
      await act(() => rows[1].click());
      expect(navigate).toHaveBeenLastCalledWith("b");
      await act(() => rows[0].click());
      expect(navigate).toHaveBeenLastCalledWith("a");
      navigate.mockClear();
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
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
      host.remove();
      window.removeEventListener("mousedown", mouse);
      window.removeEventListener("pointerdown", pointer);
    }
  },
);

it.each([0.05, 1, 4])("centers the preview node while preserving zoom %s", (scale) => {
  const center = new Vector(1234, -567);
  const camera = {
    currentScale: scale,
    targetScale: scale * 2,
    location: new Vector(1, 2),
    targetLocationByScale: new Vector(3, 4),
    stopImmediately: vi.fn(),
  };
  const node = { collisionBox: { getRectangle: () => ({ center }) } };
  const project = {
    stageManager: { getTextNodeByUUID: (id: string) => (id === "node" ? node : null) },
    camera,
    controller: { resetCountdownTimer: vi.fn() },
  } as unknown as Project;
  expect(centerPreviewNode(project, "node")).toBe(true);
  expect(camera.location).toEqual(center);
  expect(camera.location).not.toBe(center);
  expect(camera.currentScale).toBe(scale);
  expect(camera.targetScale).toBe(scale);
  expect(camera.stopImmediately).toHaveBeenCalledOnce();
  expect(project.controller.resetCountdownTimer).toHaveBeenCalledOnce();
  expect(centerPreviewNode(project, "deleted-node")).toBe(false);
  expect(camera.stopImmediately).toHaveBeenCalledOnce();
});
