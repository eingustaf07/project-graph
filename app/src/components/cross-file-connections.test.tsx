vi.mock("@/sub/FindWindow", () => ({ default: { open: vi.fn() } }));
import FindWindow from "@/sub/FindWindow";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 32 }),
  })) as never;
  return {
    active: undefined as unknown,
    projects: [] as unknown[],
    watchers: new Map<string, Set<(value: unknown) => void>>(),
    settings: {
      enableCrossFileConnections: true,
      enableRightClickConnect: true,
      mouseLeftMode: "selectAndMove",
      viewerMode: false,
      textNodeMaxCharWidth: 15,
      defaultFontFamily: "sans-serif",
    },
  };
});
vi.mock("@/core/Project", () => ({ Project: class {}, ProjectState: { Saved: 0 } }));
vi.mock("@/core/TabWorkspace", () => ({ TabWorkspace: { focus: vi.fn(), moveTab: vi.fn(() => true) } }));
vi.mock("@/state", () => ({
  tabsAtom: "tabs",
  activeResourceTabAtom: "active",
  tabGroupRootAtom: "groups",
  store: {
    get: (atom: string) =>
      atom === "active"
        ? fixture.active
        : { id: "first", type: "group", tabIds: ["file:///C:/a.prg"], activeTabId: "file:///C:/a.prg" },
  },
}));
vi.mock("jotai", () => ({ useAtomValue: (atom: string) => (atom === "tabs" ? fixture.projects : fixture.active) }));
vi.mock("@/core/service/Settings", () => ({
  Settings: Object.assign(fixture.settings, {
    watch: (key: string, fn: (value: unknown) => void) => {
      const callbacks = fixture.watchers.get(key) ?? new Set();
      callbacks.add(fn);
      fixture.watchers.set(key, callbacks);
      return () => {
        callbacks.delete(fn);
      };
    },
  }),
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: { play: {} } }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
import { Project } from "@/core/Project";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { TabWorkspace } from "@/core/TabWorkspace";
import { URI } from "vscode-uri";
import { Vector } from "@graphif/data-structures";
import { getMultiLineTextSize } from "@/utils/font";
import CrossFileConnections, { endpointAtPoint, endpointOnScreen } from "./cross-file-connections";

it("connects across split canvases, tracks scaled positions, respects floating occlusion and hides without deleting", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const makeProject = (left: number, top: number, file: string) => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = () => new DOMRect(left, top, 300, 300);
    document.body.append(canvas);
    const project = Object.assign(Object.create(Project.prototype), {
      id: file,
      uri: URI.parse(file),
      stage: [],
      canvas: {
        element: canvas,
        clientToView: (x: number, y: number) => new Vector((x - left) / 2, (y - top) / 2),
        viewToClient: (p: Vector) => new Vector(p.x * 2 + left, p.y * 2 + top),
      },
      renderer: { transformView2World: (p: Vector) => p, transformWorld2View: (p: Vector) => p },
      textRenderer: {
        measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
          getMultiLineTextSize(text, size, height, width),
      },
      sectionMethods: { isObjectBeLockedBySection: () => false },
      on: vi.fn(),
      off: vi.fn(),
      layout: "docked",
      historyManager: { recordStep: vi.fn() },
    }) as Project;
    const node = new TextNode(project, { text: "节点" });
    project.stage.push(node);
    Object.assign(project, {
      stageManager: {
        getSelectedEntities: () => (node.isSelected ? [node] : []),
        findConnectableEntityByLocation: (p: Vector) => (node.rectangle.isPointIn(p) ? node : null),
      },
    });
    return { project, node, canvas };
  };
  const a = makeProject(20, 60, "file:///C:/a.prg"),
    b = makeProject(400, 60, "file:///C:/b.prg");
  fixture.projects = [a.project, b.project];
  fixture.active = a.project;
  document.elementFromPoint = (x, y) =>
    [b.canvas, a.canvas].find((c) => {
      const r = c.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) ?? null;
  const source = { project: a.project, nodeId: a.node.uuid };
  const point = endpointOnScreen(source)!;
  expect(point.x).toBe(a.node.geometryCenter.x * 2 + 20);
  expect(endpointAtPoint([a.project, b.project], point.x, point.y)?.nodeId).toBe(a.node.uuid);
  const hitTest = document.elementFromPoint;
  document.elementFromPoint = () => document.createElement("div");
  expect(endpointOnScreen(source)).toBeUndefined();
  document.elementFromPoint = hitTest;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<CrossFileConnections />));
    a.node.isSelected = true;
    const targetPoint = endpointOnScreen({ project: b.project, nodeId: b.node.uuid })!;
    const dispatch = async (canvas: HTMLCanvasElement, type: string, p: { x: number; y: number }) => {
      await act(() =>
        canvas.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, button: 2, clientX: p.x, clientY: p.y }),
        ),
      );
    };
    await dispatch(b.canvas, "pointerdown", targetPoint);
    await dispatch(b.canvas, "pointermove", targetPoint);
    await dispatch(b.canvas, "pointerup", targetPoint);
    expect(a.node.crossFileLinks).toHaveLength(1);
    const commit = a.project.on as ReturnType<typeof vi.fn>;
    commit.mock.calls.find(([name]) => name === "stage-commit")?.[1]();
    expect(a.project.historyManager.recordStep).toHaveBeenCalledOnce();
    expect(b.project.historyManager.recordStep).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 130));
    });
    expect(document.querySelectorAll('svg[aria-label="跨文件连接线"] g[data-cross-edge]')).toHaveLength(1);
    const linksBefore = JSON.stringify(a.node.crossFileLinks);
    await act(() => fixture.watchers.get("showBidirectionalArrows")?.forEach((fn) => fn(true)));
    expect(document.querySelector('svg[aria-label="跨文件连接线"] path[marker-start][marker-end]')).not.toBeNull();
    expect(document.querySelector('svg[aria-label="跨文件连接线"] circle')).toBeNull();
    expect(JSON.stringify(a.node.crossFileLinks)).toBe(linksBefore);
    await act(() => fixture.watchers.get("showBidirectionalArrows")?.forEach((fn) => fn(false)));
    expect(document.querySelector('svg[aria-label="跨文件连接线"] path[marker-start]')).toBeNull();
    await act(() => document.querySelector<HTMLButtonElement>('[aria-label="查看关联文件"]')!.click());
    expect(document.querySelector("[data-cross-file-controls]")?.textContent).toContain("b.prg");
    const destination = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-cross-file-controls] button"),
    ).find((b) => b.textContent?.includes("向右拆分"))!;
    await act(() => destination.click());
    expect(TabWorkspace.moveTab).toHaveBeenCalledWith(b.project.id, { groupId: "first", edge: "right" });
    fixture.settings.enableCrossFileConnections = false;
    await act(() => fixture.watchers.get("enableCrossFileConnections")?.forEach((fn) => fn(false)));
    expect(document.querySelector("[data-cross-file-controls]")).toBeNull();
    expect(a.node.crossFileLinks).toHaveLength(1);
    const query = document.querySelector<HTMLButtonElement>('[aria-label="查询"]');
    expect(query).not.toBeNull();
    await act(async () => {
      query!.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(FindWindow.open).toHaveBeenCalledTimes(1);
  } finally {
    await act(() => root.unmount());
    host.remove();
    a.canvas.remove();
    b.canvas.remove();
  }
});
