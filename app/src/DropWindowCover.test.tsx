// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DropWindowCover } from "./DropWindowCover";
import { Project } from "./core/Project";
import { Vector } from "@graphif/data-structures";

const h = vi.hoisted(() => ({
  listen: vi.fn(async (_name: string, _handler: (event: any) => void) => () => {}),
  tabs: [] as unknown[],
  top: vi.fn(),
  middle: vi.fn(),
  bottom: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: h.listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("./state", () => ({ store: { get: () => h.tabs }, tabsAtom: {} }));
vi.mock("./core/Project", () => ({ Project: class {} }));
vi.mock("./core/stage/stageObject/entity/TextNode", () => ({
  TextNode: class {
    constructor(
      public project: unknown,
      public options: unknown,
    ) {}
  },
}));
vi.mock("./core/service/dataManageService/dragFileIntoStageEngine/dragFileIntoStageEngine", () => ({
  DragFileIntoStageEngine: {
    handleDrop: h.top,
    handleDropFileRelativePath: h.middle,
    handleDropFileAbsolutePath: h.bottom,
  },
}));

it("keeps one listener across tab switches, targets the canvas under the drop, and preserves both path zones", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const projects = [0, 1].map(() =>
    Object.assign(Object.create(Project.prototype), {
      canvas: { element: document.createElement("canvas"), clientToView: (x: number, y: number) => new Vector(x, y) },
      renderer: { transformView2World: (v: Vector) => v },
      stageManager: { add: vi.fn() },
      historyManager: { recordStep: vi.fn() },
    }),
  );
  h.tabs = projects;
  const host = document.createElement("div"),
    root = createRoot(host);
  const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => projects[0].canvas.element });
  try {
    for (const project of projects) await act(() => root.render(<DropWindowCover project={project} />));
    expect(h.listen).toHaveBeenCalledTimes(1);
    const drop = (paths: string[], text: string | null, y: number) =>
      act(() => h.listen.mock.calls[0][1]({ payload: { kind: "drop", paths, text, x: 100, y } }));
    await drop(["sound.mp3", "video.mp4"], null, 20);
    expect(h.top).toHaveBeenCalledExactlyOnceWith(projects[0], ["sound.mp3", "video.mp4"], new Vector(100, 20));
    await drop(["sound.mp3"], null, window.innerHeight / 2);
    expect(h.middle).toHaveBeenCalledExactlyOnceWith(projects[0], ["sound.mp3"]);
    await drop(["video.mp4"], null, window.innerHeight - 1);
    expect(h.bottom).toHaveBeenCalledExactlyOnceWith(projects[0], ["video.mp4"]);
    await drop([], "  line one\nline two  ", 30);
    expect(projects[0].stageManager.add.mock.calls[0][0].options.text).toBe("  line one\nline two  ");
    expect(projects[0].historyManager.recordStep).toHaveBeenCalledTimes(1);
    expect(projects[1].stageManager.add).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    if (original) Object.defineProperty(document, "elementFromPoint", original);
    else Reflect.deleteProperty(document, "elementFromPoint");
  }
});
