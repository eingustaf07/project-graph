import { beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() =>
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ font: "", measureText: (text: string) => ({ width: [...text].length * 32 }) }),
    }),
  }),
);
vi.mock("@/core/Project", () => ({
  Project: class {},
  ProjectState: { Saved: "saved", Unsaved: "unsaved" },
  service: () => (target: unknown) => target,
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    textNodeMaxCharWidth: 15,
    containerAutoExpand: false,
    containerNBoundary: false,
    defaultFontFamily: "sans-serif",
    isEnableEntityCollision: true,
    historyManagerMode: "memoryEfficient",
    historySize: 100,
    watch: () => () => {},
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: { play: { packEntityToSectionSoundFile: vi.fn() } },
}));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { GraphMethods } from "@/core/stage/stageManager/basicMethods/GraphMethods";
import { SectionInOutManager } from "@/core/stage/stageManager/concreteMethods/StageSectionInOutManager";
import { SectionPackManager } from "@/core/stage/stageManager/concreteMethods/StageSectionPackManager";
import { EntityMoveManager } from "@/core/stage/stageManager/concreteMethods/StageEntityMoveManager";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { TextNode } from "./TextNode";
import { Section } from "./Section";
import { ImageNode } from "./ImageNode";
import { HyperedgeCenterDrag } from "@/core/service/controlService/controller/HyperedgeCenterDrag";
import { MultiTargetUndirectedEdge } from "../association/MutiTargetUndirectedEdge";
import { LineEdge } from "../association/LineEdge";
import { MultiTargetEdgeMove } from "@/core/stage/stageManager/concreteMethods/StageMultiTargetEdgeMove";
import { NodeAdder } from "@/core/stage/stageManager/concreteMethods/StageNodeAdder";
import { Doodle, containPastedEntities } from "./Doodle";
import { fitDoodleBounds } from "@/core/algorithm/doodleBounds";
import { CollisionBox } from "../collisionBox/collisionBox";
import { Vector, Color } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { deserialize, serialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";
import { getMultiLineTextSize } from "@/utils/font";

function fixture() {
  const p: any = {
    stage: [],
    renderer: { frameIndex: 0 },
    controller: { pressingKeySet: new Set<string>() },
    attachments: new Map(),
    emit: vi.fn(),
    effects: { addEffect: vi.fn() },
    sectionCollisionSolver: { solveOverlaps: vi.fn() },
    syncAssociationManager: { syncFrom: vi.fn() },
    stageUtils: { replaceAutoNameTemplate: () => "容器" },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
  };
  p.stageManager = new StageManager(p);
  p.graphMethods = new GraphMethods(p);
  p.sectionMethods = new SectionMethods(p);
  p.sectionInOutManager = new SectionInOutManager(p);
  p.sectionPackManager = new SectionPackManager(p);
  p.entityMoveManager = new EntityMoveManager(p);
  p.historyManager = new HistoryManager(p);
  return p as Project;
}
function node(p: Project, text = "节点", at = new Vector(180, 160)) {
  return new TextNode(p, {
    text,
    collisionBox: new CollisionBox([new Rectangle(at, Vector.getZero())]),
    color: new Color(80, 100, 180),
  });
}
function cage(p: Project, shape: "rectangle" | "circle" = "rectangle", bounded = true) {
  const d = new Doodle(p, {
    frame: new Rectangle(Vector.getZero(), new Vector(600, 600)),
    shape,
    bounded,
    text: "测试容器",
  });
  d.captureEnclosed();
  p.stageManager.add(d);
  return d;
}

describe("zoom-aware frame pointer targeting", () => {
  it.each(["rectangle", "circle"] as const)(
    "uses screen distance for %s borders without changing physical bounds",
    (shape) => {
      const p = fixture();
      p.camera = { currentScale: 0.1 } as Project["camera"];
      const frame = new Doodle(p, { shape, bounded: false, frame: new Rectangle(Vector.getZero(), Vector.same(1000)) });
      p.stage.push(frame);
      p.stageManager.updateReferences();
      const near = new Vector(500, -70);
      expect(frame.isFrameHit(near)).toBe(true);
      expect(frame.collisionBox.isContainsPoint(near)).toBe(false);
      expect(p.stageManager.findEntityByLocation(near)).toBe(frame);
      expect(p.stageManager.findEntityByLocation(new Vector(500, -90))).toBeNull();
      expect(frame.isFrameHit(frame.frame.center)).toBe(false);
      p.camera.currentScale = 0.01;
      expect(frame.frameHitTolerancePixels).toBe(2.5);
      expect(frame.isFrameHit(new Vector(500, -240))).toBe(true);
      expect(frame.isFrameHit(new Vector(500, -260))).toBe(false);
    },
  );
  it("prefers a real node over a nearby border and refuses ambiguous neighboring borders", () => {
    const p = fixture();
    p.camera = { currentScale: 0.1 } as Project["camera"];
    const first = new Doodle(p, { frame: new Rectangle(Vector.getZero(), Vector.same(1000)) });
    const second = new Doodle(p, { frame: new Rectangle(new Vector(0, 40), Vector.same(1000)) });
    p.stage = [first, second];
    p.stageManager.updateReferences();
    expect(p.stageManager.findEntityByLocation(new Vector(500, 20))).toBeNull();
    const n = node(p, "node", new Vector(460, 5));
    p.stage.unshift(n);
    p.stageManager.updateReferences();
    expect(p.stageManager.findEntityByLocation(n.rectangle.center)).toBe(n);
  });
});
function inside(d: Doodle, rect: Rectangle) {
  const delta = fitDoodleBounds(d.frame, d.shape, rect);
  expect(delta).not.toBeNull();
  expect(delta!.magnitude()).toBeLessThan(0.001);
}

it("grows a real hyperedge only on right drag from its center, with one undo step", async () => {
  vi.stubGlobal("window", new EventTarget());
  const previousMode = Settings.mouseLeftMode;
  Settings.mouseLeftMode = "selectAndMove";
  const p = fixture();
  const canvas = new EventTarget();
  const coords = (x: number, y: number) => new Vector(x, y);
  Object.assign(p, {
    canvas: { element: canvas, clientToView: coords, viewToClient: (v: Vector) => v },
    camera: { currentScale: 1 },
    stageUtils: { replaceAutoNameTemplate: () => "新节点" },
    multiTargetEdgeMove: new MultiTargetEdgeMove(p),
    nodeAdder: new NodeAdder(p),
  });
  Object.assign(p.renderer, { transformView2World: (v: Vector) => v });
  Object.assign(p.controller, { resetCountdownTimer: vi.fn() });
  const members = [0, 1, 2].map((i) => node(p, "A", new Vector(i * 400, i === 1 ? 400 : 0)));
  members.forEach((n) => p.stageManager.add(n));
  const edge = MultiTargetUndirectedEdge.createFromSomeEntity(p, members);
  p.stageManager.add(edge);
  p.historyManager = new HistoryManager(p);
  const center = edge.centerLocation;
  const send = (type: string, button: number, at: Vector) =>
    canvas.dispatchEvent(Object.assign(new Event(type), { button, pointerId: 1, clientX: at.x, clientY: at.y }));
  const gesture = new HyperedgeCenterDrag(p);
  try {
    send("pointerdown", 0, center);
    expect(gesture.preview).toBeUndefined();
    send("pointerdown", 2, center);
    send("pointerup", 2, center);
    expect(p.stageManager.getTextNodes()).toHaveLength(3);
    send("pointerdown", 2, center);
    expect(gesture.preview?.edge).toBe(edge);
    const end = center.add(new Vector(700, 300));
    send("pointermove", 2, end);
    expect(gesture.preview?.end).toEqual(end);
    send("pointerup", 2, end);
    await vi.waitFor(() => expect(edge.associationList).toHaveLength(4));
    expect(edge.centerLocation.distance(center)).toBeLessThan(0.001);
    expect(edge.rectRates).toHaveLength(4);
    expect(edge.associationList[3].collisionBox.getRectangle().center).toEqual(end);
    p.historyManager.undo();
    expect(p.stageManager.getTextNodes()).toHaveLength(3);
    expect((p.stage.find((item) => item.uuid === edge.uuid) as MultiTargetUndirectedEdge).associationList).toHaveLength(
      3,
    );
    p.historyManager.redo();
    expect(p.stageManager.getTextNodes()).toHaveLength(4);
  } finally {
    gesture.dispose();
    Settings.mouseLeftMode = previousMode;
    vi.unstubAllGlobals();
  }
});
beforeEach(() => {
  vi.clearAllMocks();
  Settings.containerAutoExpand = false;
  Settings.containerNBoundary = false;
});
describe("real PG doodles and fixed containers", () => {
  it("packs selected real nodes into a bounded Ctrl+G container, preserves edges and supports undo/redo and reload", async () => {
    const p = fixture();
    const a = node(p, "a", new Vector(200, 200)), b = node(p, "b", new Vector(350, 250));
    const edge = new LineEdge(p, { associationList: [a, b] });
    p.stage.push(a, b, edge);
    p.stageManager.updateReferences();
    p.historyManager.recordStep();
    a.isSelected = b.isSelected = true;
    const container = await p.sectionPackManager.packSelectedEntitiesToSection(true) as Doodle;
    expect(container).toBeInstanceOf(Doodle);
    expect(container.bounded).toBe(true);
    expect(container.children).toEqual([a, b]);
    expect(a.parentSection).toBe(container);
    expect(b.parentSection).toBe(container);
    expect(p.stageManager.getAssociations()).toEqual([edge]);
    p.historyManager.undo();
    expect(p.stageManager.getSections()).toHaveLength(0);
    p.historyManager.redo();
    const restored = p.stageManager.getSections()[0] as Doodle;
    expect(restored.bounded).toBe(true);
    expect(restored.children).toHaveLength(2);
    const reloaded = deserialize(structuredClone(serialize(restored)), p) as Doodle;
    expect(reloaded).toBeInstanceOf(Doodle);
    expect(reloaded.bounded).toBe(true);
    expect(reloaded.children).toHaveLength(2);
  });
  it("creates an empty rectangular Ctrl+G container without artificial anchor nodes", () => {
    const p = fixture();
    const rect = new Rectangle(new Vector(100, 100), new Vector(600, 400));
    p.rectangleSelect = { getRectangle: () => rect, shutDown: vi.fn() } as unknown as Project["rectangleSelect"];
    const container = p.sectionPackManager.createSectionFromSelectionRectangle(true) as Doodle;
    expect(container.bounded).toBe(true);
    expect(container.frame).toEqual(rect);
    expect(p.stageManager.getEntities()).toEqual([container]);
    expect(container.children).toHaveLength(0);
    expect(p.rectangleSelect.shutDown).toHaveBeenCalledOnce();
    p.historyManager.undo();
    expect(p.stage).toHaveLength(0);
    p.historyManager.redo();
    expect(p.stageManager.getSections()[0]).toBeInstanceOf(Doodle);
  });
  it("applies normal container drag, V transfer, nested movement and resizing to Ctrl+G containers", async () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const outer = cage(p);
    const a = node(p, "inside", new Vector(200, 200));
    p.stageManager.add(a);
    outer.adopt(a);
    a.isSelected = true;
    const inner = await p.sectionPackManager.packSelectedEntitiesToSection(true) as Doodle;
    expect(inner.parentSection).toBe(outer);
    expect(outer.children).toEqual([inner]);
    expect(a.parentSection).toBe(inner);
    const initial = a.rectangle.location.clone();
    outer.move(new Vector(100, 100));
    expect(a.rectangle.location).toEqual(initial.add(new Vector(100, 100)));
    inner.resizeFrame(new Rectangle(inner.frame.location, inner.frame.size.add(new Vector(100, 100))));
    inside(inner, a.rectangle);
    p.stageManager.clearSelectAll();
    a.isSelected = true;
    const originalFrame = serialize(inner.frame);
    p.entityMoveManager.beginPointerDrag(a);
    p.entityMoveManager.dragSelection(new Vector(1200, 0), false);
    expect(a.parentSection).toBe(inner);
    expect(serialize(inner.frame)).toEqual(originalFrame);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(1200, 0), false);
    expect(a.parentSection).toBeNull();
    p.entityMoveManager.dragSelection(inner.frame.center.subtract(a.rectangle.center), false);
    expect(a.parentSection).toBe(inner);
    inside(inner, a.rectangle);
  });
  it("undoes, redoes and reloads independently resized images without resetting their dimensions", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
    );
    try {
      const p = fixture();
      p.attachments.set("screenshot", new Blob(["image"]));
      const image = new ImageNode(p, { attachmentId: "screenshot" });
      await image.waitForClipboardBitmap();
      p.stageManager.add(image);
      p.historyManager.recordStep();
      const before = serialize(p.stage);
      image.resizeHandle(new Vector(130, 83));
      p.historyManager.recordStep();
      const after = serialize(p.stage);
      p.historyManager.undo();
      await Promise.all(p.stageManager.getImageNodes().map((n) => n.waitForClipboardBitmap()));
      expect(serialize(p.stage)).toEqual(before);
      p.historyManager.redo();
      await Promise.all(p.stageManager.getImageNodes().map((n) => n.waitForClipboardBitmap()));
      expect(serialize(p.stage)).toEqual(after);
      const restored = deserialize(decode(new Encoder().encode(after)), p) as ImageNode[];
      await Promise.all(restored.map((n) => n.waitForClipboardBitmap()));
      expect(restored[0].rectangle.size).toEqual(new Vector(230, 183));
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("pushes existing text aside on creation and drag inside a fixed container", () => {
    const p = fixture();
    const d = cage(p);
    const old = node(p);
    const fresh = node(p);
    p.stageManager.add(old);
    p.stageManager.add(fresh);
    expect(fresh.rectangle.location).toEqual(new Vector(180, 160));
    expect(old.rectangle.isCollideWith(fresh.rectangle)).toBe(false);
    const target = old.rectangle.location.clone();
    p.entityMoveManager.moveEntityToUtils(fresh, target);
    expect(fresh.rectangle.location).toEqual(target);
    expect(old.rectangle.isCollideWith(fresh.rectangle)).toBe(false);
    inside(d, old.rectangle);
    inside(d, fresh.rectangle);
  });
  it("grows for new content but keeps dragged members inside until V is held, then supports reentry", () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const d = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    d.adopt(n);
    const original = serialize(d.frame);
    p.entityMoveManager.moveEntityUtils(n, new Vector(800, 0));
    inside(d, n.rectangle);
    expect(serialize(d.frame)).toEqual(original);
    expect(n.parentSection).toBe(d);
    p.entityMoveManager.moveEntityToUtils(n, new Vector(800, 800));
    inside(d, n.rectangle);
    expect(serialize(d.frame)).toEqual(original);
    n.isSelected = true;
    p.entityMoveManager.beginPointerDrag(n);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(800, 0), false);
    expect(n.parentSection).toBeNull();
    expect(d.children).not.toContain(n);
    const destination = new Vector(200, 200).subtract(n.rectangle.center);
    p.entityMoveManager.dragSelection(destination, false);
    expect(n.parentSection).toBe(d);
    expect(d.children).toContain(n);
    expect(serialize(d.frame)).toEqual(original);
    p.controller.pressingKeySet.clear();
    const outside = node(p, "新增的内容", new Vector(d.frame.right - 5, 300));
    p.stageManager.add(outside);
    expect(outside.parentSection).toBe(d);
    expect(d.frame.right).toBeGreaterThan(600);
    inside(d, outside.rectangle);
  });
  it.each(["rectangle", "circle"] as const)(
    "blocks normal drags and transfers only a preselected node with V (%s)",
    (shape) => {
      Settings.containerNBoundary = true;
      const p = fixture();
      const d = cage(p, shape);
      const n = node(p, "外部节点", new Vector(900, 300));
      p.stageManager.add(n);
      p.entityMoveManager.beginPointerDrag(n);
      n.isSelected = true;
      p.controller.pressingKeySet.add("v");
      p.entityMoveManager.dragSelection(new Vector(-1500, 0), false);
      expect(n.parentSection).toBeNull();
      expect(n.rectangle.left).toBeCloseTo(d.frame.right, 0);
      p.entityMoveManager.endPointerDrag();
      p.entityMoveManager.beginPointerDrag(n);
      for (const key of ["n", "b"]) {
        p.controller.pressingKeySet.clear();
        p.controller.pressingKeySet.add(key);
        p.entityMoveManager.dragSelection(new Vector(-500, 0), false);
        expect(n.parentSection).toBeNull();
        expect(n.rectangle.left).toBeCloseTo(d.frame.right, 0);
      }
      p.entityMoveManager.moveAlignedEntity(n, new Vector(-50, 0));
      expect(n.rectangle.left).toBeCloseTo(d.frame.right, 0);
      p.controller.pressingKeySet.clear();
      p.controller.pressingKeySet.add("v");
      for (let i = 0; i < 40; i++) p.entityMoveManager.dragSelection(new Vector(-5, 0), false);
      expect(n.parentSection).toBe(d);
      const original = serialize(d.frame);
      for (let i = 0; i < 100; i++) p.entityMoveManager.dragSelection(new Vector(8, 0), false);
      expect(n.parentSection).toBeNull();
      expect(serialize(d.frame)).toEqual(original);
    },
  );
  it.each(["rectangle", "circle"] as const)(
    "transfers a pasted image at the grabbed point across a %s boundary",
    (shape) => {
      Settings.containerNBoundary = true;
      const p = fixture();
      const frame = cage(p, shape);
      const image = new ImageNode(p, {
        collisionBox: new CollisionBox([new Rectangle(new Vector(130, 250), new Vector(340, 100))]),
      });
      p.stageManager.add(image);
      containPastedEntities(p, [image], frame.frame.center);
      image.isSelected = true;
      // Grab near the right edge. The pointer crosses the border before the image center.
      p.entityMoveManager.beginPointerDrag(image, new Vector(460, 300));
      p.controller.pressingKeySet.add("v");
      for (let i = 0; i < 15; i++) p.entityMoveManager.dragSelection(new Vector(10, 0), false);
      expect(image.parentSection).toBeNull();
      expect(frame.children).not.toContain(image);
      expect(image.rectangle.left).toBeGreaterThanOrEqual(frame.frame.right - 0.001);
      p.entityMoveManager.endPointerDrag();
      // Re-grab at the opposite edge and move a short distance back across the wall.
      p.entityMoveManager.beginPointerDrag(image, new Vector(image.rectangle.left + 10, 300));
      p.entityMoveManager.dragSelection(new Vector(-30, 0), false);
      expect(image.parentSection).toBe(frame);
      inside(frame, image.rectangle);
      p.controller.pressingKeySet.clear();
      p.entityMoveManager.dragSelection(new Vector(900, 0), false);
      expect(image.parentSection).toBe(frame);
      inside(frame, image.rectangle);
    },
  );
  it.each(["rectangle", "circle"] as const)(
    "moves a root and its unselected descendants through a %s wall together",
    (shape) => {
      Settings.containerNBoundary = true;
      const p = fixture();
      const frame = cage(p, shape);
      const root = node(p, "A", new Vector(605, 260));
      const children = [node(p, "B", new Vector(729, 180)), node(p, "C", new Vector(729, 345))];
      const tree = [root, ...children];
      tree.forEach((entity) => p.stageManager.add(entity));
      const edges = children.map((child) => new LineEdge(p, { associationList: [root, child] }));
      edges.forEach((edge) => p.stageManager.add(edge));
      const offsets = () => children.map((child) => child.rectangle.center.subtract(root.rectangle.center));
      const original = offsets();
      const checkOffsets = () =>
        offsets().forEach((offset, index) => expect(offset.distance(original[index])).toBeLessThan(1e-8));
      const grab = root.rectangle.center.clone();
      root.isSelected = true;
      p.entityMoveManager.beginPointerDrag(root, grab);
      p.controller.pressingKeySet.add("v");
      p.entityMoveManager.dragSelection(new Vector(592 - grab.x, 300 - grab.y), true);
      expect(frame.children.map((n) => n.uuid).sort()).toEqual(tree.map((n) => n.uuid).sort());
      tree.forEach((n) => inside(frame, n.rectangle));
      checkOffsets();
      p.controller.pressingKeySet.delete("v");
      p.entityMoveManager.dragSelection(new Vector(30, 0), true);
      tree.forEach((n) => inside(frame, n.rectangle));
      p.controller.pressingKeySet.add("v");
      p.entityMoveManager.dragSelection(new Vector(1, 0), true);
      expect(frame.children).toHaveLength(0);
      expect(tree.every((n) => n.parentSection === null)).toBe(true);
      checkOffsets();
      expect(edges.map((e) => e.target)).toEqual(children);
    },
  );

  it("keeps a multi-selection together when the target cannot fit its full width", () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const frame = cage(p);
    const a = node(p, "A", new Vector(605, 200));
    const b = node(p, "B", new Vector(1300, 200));
    for (const n of [a, b]) {
      p.stageManager.add(n);
      n.isSelected = true;
    }
    const width = b.rectangle.left - a.rectangle.left;
    p.entityMoveManager.beginPointerDrag(a, a.rectangle.center);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(-150, 0), false);
    expect(frame.children).toHaveLength(0);
    expect(b.rectangle.left - a.rectangle.left).toBe(width);
    expect(a.rectangle.left).toBeGreaterThanOrEqual(frame.frame.right);
  });

  it("transfers a fully selected tree in one hierarchy refresh and restores membership on undo and redo", () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const frame = cage(p);
    const a = node(p, "A", new Vector(630, 200));
    const b = node(p, "B", new Vector(830, 200));
    const other = node(p, "旁边", new Vector(1200, 800));
    for (const n of [a, b, other]) p.stageManager.add(n);
    const edge = new LineEdge(p, { associationList: [a, b] });
    p.stageManager.add(edge);
    p.historyManager = new HistoryManager(p);
    const refresh = vi.spyOn(p.stageManager, "rebuildSectionRuntimeTree");
    a.isSelected = b.isSelected = true;
    p.entityMoveManager.beginPointerDrag(a, a.rectangle.center);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(-120, 0), false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(frame.children).toEqual([a, b]);
    expect(other.rectangle.location).toEqual(new Vector(1200, 800));
    p.entityMoveManager.endPointerDrag();
    p.historyManager.recordStep();
    p.historyManager.undo();
    expect(p.stageManager.getTextNodeByUUID(a.uuid)?.parentSection).toBeNull();
    expect(p.stageManager.getTextNodeByUUID(b.uuid)?.parentSection).toBeNull();
    p.historyManager.redo();
    expect(p.stageManager.getTextNodeByUUID(a.uuid)?.parentSection?.uuid).toBe(frame.uuid);
    expect(p.stageManager.getTextNodeByUUID(b.uuid)?.parentSection?.uuid).toBe(frame.uuid);
  });

  it("grows only the impacted wall on the third bounce and restores the frame on undo and redo", () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const frame = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    p.historyManager = new HistoryManager(p);
    n.isSelected = true;
    const move = (x: number) => p.entityMoveManager.dragSelection(new Vector(x, 0), false);
    p.entityMoveManager.beginPointerDrag(n);
    move(600);
    move(10);
    move(10);
    expect(frame.frame.right).toBe(600);
    move(-20);
    move(40);
    expect(frame.frame.right).toBe(600);
    move(-20);
    move(40);
    expect(frame.frame.right).toBe(632);
    expect(p.entityMoveManager.resizedContainerDuringDrag).toBe(true);
    expect(n.parentSection).toBe(frame);
    p.entityMoveManager.endPointerDrag();
    p.historyManager.recordStep();
    p.historyManager.undo();
    expect((p.stageManager.get(frame.uuid) as Doodle).frame.right).toBe(600);
    p.historyManager.redo();
    expect((p.stageManager.get(frame.uuid) as Doodle).frame.right).toBe(632);
  });
  it("allows V dragging a selection spanning a container boundary", () => {
    Settings.containerNBoundary = true;
    const p = fixture(), frame = cage(p);
    const a = node(p, "inside", new Vector(210, 215)), b = node(p, "outside", new Vector(900, 215));
    for (const n of [a, b]) { p.stageManager.add(n); n.isSelected = true; }
    expect(a.parentSection).toBe(frame);
    expect(b.parentSection).toBeNull();
    const before = [a, b].map(n => n.rectangle.center.clone());
    p.entityMoveManager.beginPointerDrag(a, before[0]);
    p.controller.pressingKeySet.add("v");
    const delta = new Vector(12, 0);
    p.entityMoveManager.dragSelection(delta, false);
    for (const [i, n] of [a, b].entries()) expect(n.rectangle.center).toEqual(before[i].add(delta));
  });

  it("requires V at the inner wall and returns an exiting node to the outer container", () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const outer = cage(p);
    const inner = new Doodle(p, { bounded: true, frame: new Rectangle(new Vector(230, 180), new Vector(300, 300)) });
    inner.captureEnclosed();
    p.stageManager.add(inner);
    const n = node(p, "A", new Vector(30, 245));
    p.stageManager.add(n);
    expect(n.parentSection).toBe(outer);
    n.isSelected = true;
    p.entityMoveManager.beginPointerDrag(n);
    p.entityMoveManager.dragSelection(new Vector(300, 0), false);
    expect(n.rectangle.right).toBeCloseTo(inner.frame.left);
    expect(n.parentSection).toBe(outer);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(120, 0), false);
    expect(n.parentSection).toBe(inner);
    expect(outer.children).not.toContain(n);
    p.controller.pressingKeySet.clear();
    p.entityMoveManager.dragSelection(new Vector(-400, 0), false);
    inside(inner, n.rectangle);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(-150, 0), false);
    expect(n.parentSection).toBe(outer);
    expect(inner.children).not.toContain(n);
    inside(outer, n.rectangle);
  });

  it("restores V-key transfer membership through undo, redo and file serialization", () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const d = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    d.adopt(n);
    p.historyManager = new HistoryManager(p);
    n.isSelected = true;
    p.entityMoveManager.beginPointerDrag(n);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(900, 0), false);
    p.historyManager.recordStep();
    p.historyManager.undo();
    expect((p.stage.find((e) => e.uuid === n.uuid) as TextNode).parentSection?.uuid).toBe(d.uuid);
    p.historyManager.redo();
    p.stage = deserialize(decode(new Encoder().encode(serialize(p.stage))), p);
    p.stageManager.updateReferences();
    expect((p.stage.find((e) => e.uuid === n.uuid) as TextNode).parentSection).toBeNull();
    expect((p.stage.find((e) => e.uuid === d.uuid) as Doodle).children).toHaveLength(0);
  });
  it("persists the latest decorative rectangle title after repeated renames and undo/redo", () => {
    const p = fixture();
    const d = cage(p, "rectangle", false);
    d.rename("第一次标题");
    p.historyManager = new HistoryManager(p);
    d.rename("第二次标题");
    p.historyManager.recordStep();
    p.historyManager.undo();
    expect((p.stage[0] as Doodle).text).toBe("第一次标题");
    p.historyManager.redo();
    p.stage = deserialize(decode(new Encoder().encode(serialize(p.stage))), p);
    expect((p.stage[0] as Doodle).text).toBe("第二次标题");
  });
  it.each(["rectangle", "circle"] as const)(
    "expands %s containers for new edge nodes without pushing them back",
    (shape) => {
      const p = fixture();
      const d = cage(p, shape);
      Settings.containerAutoExpand = true;
      p.historyManager = new HistoryManager(p);
      const before = serialize(p.stage);
      const n = node(p, "边缘节点", new Vector(590, 290));
      const at = n.rectangle.location.clone();
      p.stageManager.add(n);
      expect(n.parentSection).toBe(d);
      expect(n.rectangle.location).toEqual(at);
      expect(d.frame.width).toBeGreaterThan(600);
      inside(d, n.rectangle);
      p.historyManager.recordStep();
      const after = serialize(p.stage);
      p.historyManager.undo();
      expect(serialize(p.stage)).toEqual(before);
      p.historyManager.redo();
      expect(serialize(p.stage)).toEqual(after);
    },
  );

  it("propagates expansion through three containers and preserves all node positions", () => {
    const p = fixture();
    const outer = cage(p);
    const middle = new Doodle(p, { bounded: true, frame: new Rectangle(new Vector(50, 50), new Vector(450, 450)) });
    middle.captureEnclosed();
    p.stageManager.add(middle);
    const inner = new Doodle(p, { bounded: true, frame: new Rectangle(new Vector(100, 100), new Vector(300, 300)) });
    inner.captureEnclosed();
    p.stageManager.add(inner);
    const n = node(p);
    p.stageManager.add(n);
    Settings.containerAutoExpand = true;
    n.moveTo(new Vector(900, 900));
    expect(n.rectangle.location).toEqual(new Vector(900, 900));
    inside(inner, n.rectangle);
    inside(middle, inner.frame);
    inside(outer, middle.frame);
    const at = n.rectangle.location.clone();
    outer.move(new Vector(20, 30));
    expect(n.rectangle.location.subtract(at)).toEqual(new Vector(20, 30));
    Settings.containerAutoExpand = false;
    n.moveTo(new Vector(5000, 5000));
    inside(inner, n.rectangle);
    expect(n.rectangle.left).toBeLessThan(5000);
  });

  it("moves nested containers with their captured nodes, preserves siblings and round-trips history", () => {
    const p = fixture();
    const outer = cage(p);
    const n = node(p);
    const sibling = node(p, "外层节点", new Vector(450, 450));
    p.stageManager.add(n);
    p.stageManager.add(sibling);
    const inner = new Doodle(p, {
      bounded: true,
      frame: new Rectangle(new Vector(100, 100), new Vector(300, 300)),
    });
    inner.captureEnclosed();
    p.stageManager.add(inner);
    expect(inner.parentSection).toBe(outer);
    expect(n.parentSection).toBe(inner);
    expect(outer.children).not.toContain(n);
    expect(sibling.parentSection).toBe(outer);
    p.historyManager = new HistoryManager(p);
    const before = serialize(p.stage);
    const at = n.rectangle.location.clone();
    const siblingAt = sibling.rectangle.location.clone();
    inner.move(new Vector(30, 20));
    expect(n.rectangle.location.subtract(at)).toEqual(new Vector(30, 20));
    expect(sibling.rectangle.location).toEqual(siblingAt);
    outer.move(new Vector(70, 60));
    expect(n.rectangle.location.subtract(at)).toEqual(new Vector(100, 80));
    p.historyManager.recordStep();
    const after = serialize(p.stage);
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(after);
    p.stage = deserialize(decode(new Encoder().encode(after)), p);
    p.stageManager.updateReferences();
    const loaded = p.stage.find((entity) => entity.uuid === inner.uuid) as Doodle;
    const child = loaded.children[0];
    const loadedAt = child.collisionBox.getRectangle().location.clone();
    loaded.move(new Vector(10, 10));
    expect(child.collisionBox.getRectangle().location.subtract(loadedAt)).toEqual(new Vector(10, 10));
    loaded.move(new Vector(10000, 10000));
    inside(loaded.parentSection as Doodle, loaded.frame);
    inside(loaded, child.collisionBox.getRectangle());
    expect(loaded.acceptsChild(loaded.parentSection!)).toBe(false);
  });

  it("keeps decorative shapes fixed without capturing or restricting nodes", () => {
    const p = fixture();
    const d = cage(p, "rectangle", false);
    const n = node(p);
    p.stageManager.add(n);
    expect(n.parentSection).toBeNull();
    expect(d.children).toEqual([]);
    n.move(new Vector(1000, 1000));
    expect(n.rectangle.left).toBeGreaterThan(600);
    expect(d.frame.width).toBe(600);
    expect(p.sectionMethods.getSectionsByInnerLocation(new Vector(50, 50))).not.toContain(d);
  });
  it.each(["rectangle", "circle"] as const)(
    "captures fully enclosed nodes and clamps all corners inside a %s",
    (shape) => {
      const p = fixture();
      const n = node(p);
      p.stageManager.add(n);
      const before = { text: n.text, color: serialize(n.color) };
      const d = cage(p, shape);
      expect(n.parentSection).toBe(d);
      n.moveTo(new Vector(5000, -900));
      inside(d, n.rectangle);
      expect(n.text).toBe(before.text);
      expect(serialize(n.color)).toEqual(before.color);
      expect(d.frame.size).toEqual(new Vector(600, 600));
    },
  );
  it("adopts new nodes created inside while rejecting oversized nodes before insertion", () => {
    const p = fixture();
    const d = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    expect(n.parentSection).toBe(d);
    const huge = node(p, "大内容".repeat(1500));
    expect(() => p.stageManager.add(huge)).toThrow("放不进");
    expect(p.stage).not.toContain(huge);
  });
  it("rejects text growth outside the boundary and preserves the last accepted content", () => {
    const p = fixture();
    const d = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    n.rename("新的正常内容");
    const saved = serialize(n);
    n.rename("无法容纳的内容".repeat(2000));
    expect(n.text).toBe("新的正常内容");
    inside(d, n.rectangle);
    expect(serialize(n)).toEqual(saved);
  });
  it("constrains image resizing using the existing image node", () => {
    const p = fixture();
    const d = cage(p);
    const image = new ImageNode(p, {
      collisionBox: new CollisionBox([new Rectangle(new Vector(150, 150), new Vector(100, 100))]),
    });
    image.bitmap = { width: 100, height: 100 } as ImageBitmap;
    p.stageManager.add(image);
    image.scaleUpdate(1);
    inside(d, image.rectangle);
    expect(image.scale).toBe(2);
    image.scaleUpdate(7);
    expect(image.scale).toBe(2);
    inside(d, image.rectangle);
  });
  it("supports resize, naming, release and re-enabling containment without changing node coordinates", () => {
    const p = fixture();
    const d = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    d.resizeFrame(new Rectangle(Vector.getZero(), new Vector(700, 500)));
    d.rename("知识区");
    const saved = n.rectangle.location.clone();
    d.setBounded(false);
    p.stageManager.updateReferences();
    expect(n.parentSection).toBeNull();
    expect(n.rectangle.location).toEqual(saved);
    d.setBounded(true);
    p.stageManager.updateReferences();
    expect(n.parentSection).toBe(d);
    expect(d.text).toBe("知识区");
    expect(() => d.resizeFrame(new Rectangle(Vector.getZero(), new Vector(40, 40)))).toThrow();
    expect(d.frame.width).toBe(700);
  });
  it("prevents direct and indirect escape through existing section commands", () => {
    const p = fixture();
    const d = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    const other = new Section(p, {
      text: "外部组",
      collisionBox: new CollisionBox([new Rectangle(new Vector(900, 900), new Vector(200, 200))]),
    });
    p.stageManager.add(other);
    p.sectionInOutManager.goInSections([n], []);
    expect(n.parentSection).toBe(d);
    p.sectionInOutManager.goOutSection([n], d);
    expect(n.parentSection).toBe(d);
    p.sectionInOutManager.goInSection([n], other);
    expect(n.parentSection).toBe(d);
  });
  it("preserves ordinary nested groups and rejects additions that would enlarge them beyond fixed walls", () => {
    const p = fixture();
    const a = node(p, "甲"),
      b = node(p, "乙", new Vector(290, 160));
    p.stageManager.add(a);
    p.stageManager.add(b);
    const group = Section.fromEntities(p, [a, b]);
    p.stageManager.add(group);
    const d = cage(p);
    expect(group.parentSection).toBe(d);
    expect(a.parentSection).toBe(group);
    a.move(new Vector(10000, 10000));
    inside(d, group.rectangle);
    expect(a.parentSection).toBe(group);
    expect(b.parentSection).toBe(group);
    const before = serialize(p.stage);
    const extra = node(p, "新节点", new Vector(1200, 160));
    expect(() => p.sectionInOutManager.goInSection([extra], group)).toThrow();
    expect(serialize(p.stage)).toEqual(before);
    const n = node(p, "新成员", new Vector(250, 200));
    p.stageManager.add(n);
    p.sectionInOutManager.goInSection([n], group);
    expect(n.parentSection).toBe(group);
    inside(d, group.rectangle);
    p.sectionInOutManager.goOutSection([n], group);
    expect(n.parentSection).toBe(d);
    expect(group.children).toContain(a);
    inside(d, n.rectangle);
  });
  it("moves a container and its tree once, without moving outside nodes", () => {
    const p = fixture();
    const n = node(p);
    p.stageManager.add(n);
    const d = cage(p);
    const outside = node(p, "外部", new Vector(900, 900));
    p.stageManager.add(outside);
    const before = n.rectangle.location.clone();
    const originalOutside = serialize(outside);
    d.move(new Vector(60, 45));
    expect(n.rectangle.location.subtract(before)).toEqual(new Vector(60, 45));
    expect(serialize(outside)).toEqual(originalOutside);
    inside(d, n.rectangle);
  });
  it.each(["moveSelectedEntities", "moveEntitiesWithChildren"] as const)(
    "moves selected containers and selected descendants exactly once via %s",
    (command) => {
      const p = fixture();
      const n = node(p);
      p.stageManager.add(n);
      const group = Section.fromEntities(p, [n]);
      p.stageManager.add(group);
      const d = cage(p);
      n.isSelected = group.isSelected = d.isSelected = true;
      const at = n.rectangle.location.clone();
      const groupAt = group.rectangle.location.clone();
      const manager = new EntityMoveManager(p);
      manager[command](new Vector(1000, 1000));
      expect(n.rectangle.location.subtract(at)).toEqual(new Vector(1000, 1000));
      expect(group.rectangle.location.subtract(groupAt)).toEqual(new Vector(1000, 1000));
      inside(d, group.rectangle);
    },
  );
  it("preserves containers, membership, geometry and content through undo, redo and MsgPack", () => {
    const p = fixture();
    const n = node(p);
    p.stageManager.add(n);
    const d = cage(p, "circle");
    p.historyManager = new HistoryManager(p);
    const before = serialize(p.stage);
    d.resizeFrame(new Rectangle(new Vector(10, 20), new Vector(750, 750)));
    d.rename("圆形知识区");
    p.historyManager.recordStep();
    const after = serialize(p.stage);
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(after);
    p.stage = deserialize(decode(new Encoder().encode(serialize(p.stage))), p);
    p.stageManager.updateReferences();
    const loaded = p.stage.find((e) => e instanceof Doodle) as Doodle;
    const child = p.stage.find((e) => e instanceof TextNode) as TextNode;
    expect(child.parentSection).toBe(loaded);
    expect(loaded.text).toBe("圆形知识区");
    child.moveTo(new Vector(10000, 10000));
    inside(loaded, child.rectangle);
  });
  it("constrains a pasted group as a whole and refuses an oversized group without mutation", () => {
    const p = fixture();
    const d = cage(p);
    const a = node(p, "甲", new Vector(550, 550)),
      b = node(p, "乙", new Vector(650, 550));
    const relative = b.rectangle.location.subtract(a.rectangle.location);
    containPastedEntities(p, [a, b], new Vector(590, 590));
    p.stage.push(a, b);
    p.stageManager.updateReferences();
    expect(b.rectangle.location.subtract(a.rectangle.location)).toEqual(relative);
    inside(d, a.rectangle);
    inside(d, b.rectangle);
    const huge = node(p, "巨大".repeat(2000));
    const saved = serialize(p.stage);
    expect(() => containPastedEntities(p, [huge], new Vector(200, 200))).toThrow();
    expect(serialize(p.stage)).toEqual(saved);
  });
});
