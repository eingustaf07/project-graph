// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  project: undefined as any,
  tabs: [] as any[],
  channels: [] as any[],
  settings: {
    enableCrossFileConnections: true,
    enableRightClickConnect: true,
    viewerMode: false,
    mouseLeftMode: "selectAndMove",
    lineStyle: "straight",
  },
}));
vi.mock("@/core/Project", () => ({ Project: class {} }));
vi.mock("@/state", () => ({
  tabsAtom: "tabs",
  activeResourceTabAtom: "active",
  store: { get: () => fixture.project },
}));
vi.mock("jotai", () => ({ useAtomValue: () => fixture.tabs }));
vi.mock("@/utils/platform", () => ({ isDesktop: true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    innerPosition: async () => ({ x: 1000, y: 0 }),
    outerPosition: async () => ({ x: 1000, y: 0 }),
    outerSize: async () => ({ width: 1000, height: 800 }),
    innerSize: async () => ({ width: 1000, height: 800 }),
    scaleFactor: async () => 1,
    isMinimized: async () => false,
    isVisible: async () => true,
  }),
}));
vi.mock("@/core/service/Settings", () => ({ Settings: fixture.settings }));
vi.mock("@/core/service/dataManageService/crossFileHighlight", () => ({ setRemoteHighlightGraphs: vi.fn() }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({ ConnectableEntity: class {} }));
vi.mock("@/core/stage/stageObject/abstract/Association", () => ({ ConnectableAssociation: class {} }));
vi.mock("@/core/stage/stageObject/association/Edge", () => ({ Edge: class {} }));
import { Project } from "@/core/Project";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import {
  CrossWindowConnectionBus,
  type WindowGraphSnapshot,
} from "@/core/service/dataManageService/CrossWindowConnections";
import { addCrossFileConnectionToReference, fileKey } from "@/core/service/dataManageService/CrossFileConnections";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { URI } from "vscode-uri";
import CrossWindowConnections from "./cross-window-connections";

it.each([1, 1.5])(
  "connects adjacent windows at source scale %s, edits in the source and rejects a gap",
  async (sourceScale) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    class Channel {
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor() {
        fixture.channels.push(this);
      }
      postMessage(data: any) {
        for (const other of fixture.channels)
          if (other !== this) queueMicrotask(() => other.onmessage?.({ data: structuredClone(data) }));
      }
      close() {
        fixture.channels.splice(fixture.channels.indexOf(this), 1);
      }
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    const canvas = document.createElement("canvas"),
      host = document.createElement("div");
    document.body.append(canvas, host);
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => canvas });
    const node = Object.assign(Object.create(ConnectableEntity.prototype), {
      uuid: "b",
      isSelected: false,
      geometryCenter: new Vector(100, 200),
      collisionBox: { getRectangle: () => new Rectangle(new Vector(70, 180), new Vector(60, 40)) },
    });
    const target = Object.assign(new Project({} as never), {
      uri: URI.parse("file:///c:/b.prg"),
      stage: [node],
      canvas: {
        element: canvas,
        clientToView: (x: number, y: number) => new Vector(x, y),
        viewToClient: (v: Vector) => v,
      },
      camera: { currentScale: 1 },
      renderer: { transformWorld2View: (v: Vector) => v, transformView2World: (v: Vector) => v },
      stageManager: { getSelectedEntities: () => [], findConnectableEntityByLocation: () => node },
      on: vi.fn(),
      off: vi.fn(),
    });
    fixture.project = target;
    fixture.tabs = [target];
    const sourceNode = Object.assign(Object.create(ConnectableEntity.prototype), {
      uuid: "a",
      isSelected: true,
      crossFileLinks: undefined as any,
    });
    const record = vi.fn();
    const source = Object.assign(new Project({} as never), {
      uri: URI.parse("file:///c:/a.prg"),
      stage: [sourceNode],
      historyManager: { recordStep: record },
      sectionMethods: { isObjectBeLockedBySection: () => false },
    });
    let snapshot: WindowGraphSnapshot = {
      id: "a",
      geometry: { outer: { x: 0, y: 0, width: 1000, height: 800 }, origin: { x: 0, y: 0 }, scale: sourceScale },
      files: [{ file: "file:///c:/a.prg", nodes: ["a"], members: [], directed: [], links: [], roots: [] }],
      points: [{ file: "file:///c:/a.prg", nodeId: "a", x: 900, y: 200, halfWidth: 30, halfHeight: 20 }],
      selection: { file: "file:///c:/a.prg", nodeId: "a", at: Date.now() },
    };
    const owner = new CrossWindowConnectionBus("a", new Channel(), vi.fn(), (request) => {
      if (request.action === "connect")
        addCrossFileConnectionToReference({ project: source, nodeId: "a" }, request.target!);
      else if (request.action === "edit") {
        Object.assign(sourceNode.crossFileLinks[0], request.patch);
        record();
      }
      snapshot = {
        ...snapshot,
        files: [
          {
            ...snapshot.files[0],
            links: (sourceNode.crossFileLinks ?? []).map((link: any) => ({ source: "a", link })),
          },
        ],
      };
      owner.publish(snapshot);
    });
    const root = createRoot(host);
    const pause = async () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 250));
      });
    const click = async () =>
      act(async () => {
        for (const type of ["pointerdown", "pointerup"]) {
          const e = new MouseEvent(type, { button: 2, bubbles: true, cancelable: true, clientX: 100, clientY: 200 });
          Object.defineProperty(e, "pointerId", { value: 1 });
          canvas.dispatchEvent(e);
        }
        await new Promise((r) => setTimeout(r, 30));
      });
    try {
      await act(() => root.render(<CrossWindowConnections />));
      await act(() => owner.publish(snapshot));
      await pause();
      await click();
      await pause();
      expect(sourceNode.crossFileLinks).toHaveLength(1);
      expect(fileKey(sourceNode.crossFileLinks[0].targetFile)).toBe(fileKey("file:///c:/b.prg"));
      expect(record).toHaveBeenCalledTimes(1);
      const line =
        host.querySelector('path[stroke="transparent"]') ??
        document.querySelector('svg[data-cross-window-edges] path[stroke="transparent"]');
      expect(line).not.toBeNull();
      expect(
        document.querySelector("svg[data-cross-window-edges] path[marker-end]")?.getAttribute("stroke-width"),
      ).toBe(String(2 * sourceScale));
      await act(() => line!.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true })));
      for (const [key, modifiers] of [
        ["g", { ctrlKey: true }],
        ["h", { ctrlKey: true }],
        ["Backspace", { altKey: true }],
      ] as const) {
        const event = new KeyboardEvent("keydown", { key, ...modifiers, bubbles: true, cancelable: true });
        await act(() => window.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
        expect(sourceNode.crossFileLinks[0].direction).not.toBe("undirected");
        await act(() => line!.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true })));
      }
      const undirected = [...document.querySelectorAll("button")].find((b) => b.textContent === "无向")!;
      await act(async () => {
        undirected.click();
        await new Promise((r) => setTimeout(r, 30));
      });
      await pause();
      expect(sourceNode.crossFileLinks[0].direction).toBe("undirected");
      snapshot = { ...snapshot, geometry: { ...snapshot.geometry!, outer: { ...snapshot.geometry!.outer, x: -100 } } };
      await act(() => owner.publish(snapshot));
      await pause();
      expect(document.querySelector('svg[data-cross-window-edges] path[stroke="transparent"]')).toBeNull();
      await click();
      expect(record).toHaveBeenCalledTimes(2);
    } finally {
      await act(() => root.unmount());
      owner.dispose();
      canvas.remove();
      host.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
