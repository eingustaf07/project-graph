// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Project } from "@/core/Project";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: { playDoodleCreated: vi.fn() },
}));

const state = vi.hoisted(() => ({
  settings: {
    mouseLeftMode: "selectAndMove",
    viewerMode: false,
    penStrokeEraser: false,
    drawingToolbarPosition: "bottom",
  },
  watchers: new Map<string, (value: unknown) => void>(),
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: Object.assign(state.settings, {
    watch: (key: string, fn: (value: unknown) => void) => {
      state.watchers.set(key, fn);
      return () => state.watchers.delete(key);
    },
  }),
}));
vi.mock("@/core/stage/stageObject/entity/Doodle", () => ({ Doodle: class {} }));
vi.mock("@/core/service/controlService/MouseLocation", () => ({ MouseLocation: {} }));
import DoodleToolbar from "./doodle-toolbar";
import { doodleCommandEvent } from "@/core/service/controlService/shortcutKeysEngine/doodleCommands";

let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(() => root.unmount());
  host?.remove();
  state.watchers.clear();
  state.settings.mouseLeftMode = "selectAndMove";
});

it("commits repeated title edits and never replaces an externally updated title with a stale draft", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.settings.mouseLeftMode = "draw";
  const shape = Object.assign(new Doodle({} as Project), {
    uuid: "shape",
    text: "首次名称",
    bounded: false,
    isSelected: true,
    shape: "rectangle",
    color: new Color(0, 100, 80, 1),
    frame: new Rectangle(new Vector(50, 80), new Vector(300, 200)),
    rename(text: string) {
      this.text = text;
    },
    resizeFrame(frame: Rectangle) {
      this.frame = frame;
    },
  });
  const canvas = document.createElement("canvas");
  const history = vi.fn();
  const project = {
    canvas: { element: canvas, clientToView: (x: number, y: number) => new Vector(x, y) },
    renderer: { transformView2World: (v: Vector) => v, transformWorld2View: (v: Vector) => v },
    camera: { currentScale: 1 },
    controller: { resetCountdownTimer: vi.fn(), camera: {} },
    loop: vi.fn(),
    stageStyleManager: { currentStyle: { StageObjectBorder: new Color(0, 0, 0, 1) } },
    stageManager: {
      getSelectedEntities: () => [shape],
      clearSelectAll: vi.fn(),
      findEntityByLocation: () => shape,
      updateReferences: vi.fn(),
    },
    sectionMethods: { isObjectBeLockedBySection: () => false },
    historyManager: { recordStep: history },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Project;
  host = document.createElement("div");
  document.body.append(host, canvas);
  root = createRoot(host);
  await act(() => root.render(<DoodleToolbar project={project} />));
  const open = async () => {
    await act(() =>
      canvas.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true, clientX: 50, clientY: 80 })),
    );
    return host.querySelector<HTMLInputElement>('[aria-label="编辑图形标题"]')!;
  };
  for (const name of ["第二名称", "第三名称", ""]) {
    const input = await open();
    expect(input.value).toBe(shape.text);
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(shape.text).toBe(name);
    const handle = host.querySelector<HTMLButtonElement>('[aria-label="调整下右角"]')!;
    expect(handle).not.toBeNull();
    handle.setPointerCapture = vi.fn();
    const pointer = async (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { button: 0, bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      await act(() => handle.dispatchEvent(event));
    };
    const nextWidth = shape.frame.width + 20;
    await pointer("pointerdown", shape.frame.right, shape.frame.bottom);
    await pointer("pointerup", shape.frame.left + nextWidth, shape.frame.bottom + 10);
    expect(shape.frame.width).toBe(nextWidth);
    expect(shape.text).toBe(name);
  }
  expect(history).toHaveBeenCalledTimes(6);
  const input = await open();
  shape.text = "其他编辑入口的新标题";
  await act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(shape.text).toBe("其他编辑入口的新标题");
  expect(history).toHaveBeenCalledTimes(6);
  canvas.remove();
});

it("only activates drawing tools in draw mode and removes pending shapes when leaving it", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const listeners = new Map<string, (value: string) => void>();
  const project = {
    canvas: { element: document.createElement("canvas") },
    controller: { resetCountdownTimer: vi.fn() },
    loop: vi.fn(),
    stageStyleManager: { currentStyle: { StageObjectBorder: new Color(0, 0, 0, 1) } },
    stageManager: { getSelectedEntities: () => [], clearSelectAll: vi.fn() },
    on: (key: string, fn: (value: string) => void) => listeners.set(key, fn),
    off: (key: string) => listeners.delete(key),
  } as unknown as Project;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<DoodleToolbar project={project} />));
  expect(host.querySelector("aside")).toBeNull();
  expect(listeners.has(doodleCommandEvent)).toBe(false);

  const mode = async (value: string) => {
    state.settings.mouseLeftMode = value;
    await act(() => state.watchers.get("mouseLeftMode")?.(value));
  };
  await mode("draw");
  const panel = host.querySelector("aside")!;
  expect(panel.className).toContain("bottom-0");
  expect(panel.className).not.toContain("flex-col");
  expect(
    Array.from(panel.querySelectorAll("button"))
      .slice(1, 8)
      .map((b) => b.getAttribute("aria-label")),
  ).toEqual(["橡皮模式", "涂鸦参数", "容器模式", "涂鸦模式", "直线涂鸦", "长方形", "圆形"]);
  host.getBoundingClientRect = () => new DOMRect(100, 50, 800, 600);
  const handle = panel.querySelector("button")!;
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  const pointer = async (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    await act(() => handle.dispatchEvent(event));
  };
  for (const [dock, x, y] of [
    ["left", 101, 350],
    ["top", 500, 51],
    ["right", 899, 350],
    ["bottom", 500, 649],
  ] as const) {
    await pointer("pointerdown", 500, 350);
    await pointer("pointermove", x, y);
    await pointer("pointerup", x, y);
    expect(state.settings.drawingToolbarPosition).toBe(dock);
    expect(panel.className.includes("flex-col")).toBe(dock === "left" || dock === "right");
  }
  await pointer("pointerdown", 500, 649);
  await pointer("pointermove", 101, 350);
  await pointer("pointercancel", 101, 350);
  expect(state.settings.drawingToolbarPosition).toBe("bottom");
  expect(panel.className).toContain("bottom-0");
  await act(() => listeners.get(doodleCommandEvent)?.("rectangle"));
  expect(host.querySelector("[data-pg-doodle-layer]")).not.toBeNull();
  await mode("selectAndMove");
  expect(host.querySelector("[data-pg-doodle-layer]")).toBeNull();
  expect(listeners.has(doodleCommandEvent)).toBe(false);
  await mode("draw");
  expect(host.querySelector("[data-pg-doodle-layer]")).toBeNull();
  await mode("connectAndCut");
  expect(host.querySelector("aside")).toBeNull();
});
