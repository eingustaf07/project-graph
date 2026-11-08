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
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: {} }));
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
import { EntityMoveManager } from "@/core/stage/stageManager/concreteMethods/StageEntityMoveManager";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { TextNode } from "./TextNode";
import { Section } from "./Section";
import { ImageNode } from "./ImageNode";
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
    controller: { pressingKeySet: new Set<string>() },
    attachments: new Map(),
    emit: vi.fn(),
    effects: { addEffect: vi.fn() },
    sectionCollisionSolver: { solveOverlaps: vi.fn() },
    syncAssociationManager: { syncFrom: vi.fn() },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
  };
  p.stageManager = new StageManager(p);
  p.graphMethods = new GraphMethods(p);
  p.sectionMethods = new SectionMethods(p);
  p.sectionInOutManager = new SectionInOutManager(p);
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
function inside(d: Doodle, rect: Rectangle) {
  const delta = fitDoodleBounds(d.frame, d.shape, rect);
  expect(delta).not.toBeNull();
  expect(delta!.magnitude()).toBeLessThan(0.001);
}
beforeEach(() => {
  vi.clearAllMocks();
  Settings.containerAutoExpand = false;
  Settings.containerNBoundary = false;
});
describe("real PG doodles and fixed containers", () => {
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
  it("grows for new content but keeps dragged members inside until K is held, then supports reentry", () => {
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
    p.controller.pressingKeySet.add("k");
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
    "blocks normal drags and transfers only a preselected node with K (%s)",
    (shape) => {
      Settings.containerNBoundary = true;
      const p = fixture();
      const d = cage(p, shape);
      const n = node(p, "外部节点", new Vector(900, 300));
      p.stageManager.add(n);
      p.entityMoveManager.beginPointerDrag(n);
      n.isSelected = true;
      p.controller.pressingKeySet.add("k");
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
      p.controller.pressingKeySet.add("k");
      for (let i = 0; i < 40; i++) p.entityMoveManager.dragSelection(new Vector(-5, 0), false);
      expect(n.parentSection).toBe(d);
      const original = serialize(d.frame);
      for (let i = 0; i < 100; i++) p.entityMoveManager.dragSelection(new Vector(8, 0), false);
      expect(n.parentSection).toBeNull();
      expect(serialize(d.frame)).toEqual(original);
    },
  );
  it("requires K at the inner wall and returns an exiting node to the outer container", () => {
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
    p.controller.pressingKeySet.add("k");
    p.entityMoveManager.dragSelection(new Vector(120, 0), false);
    expect(n.parentSection).toBe(inner);
    expect(outer.children).not.toContain(n);
    p.controller.pressingKeySet.clear();
    p.entityMoveManager.dragSelection(new Vector(-400, 0), false);
    inside(inner, n.rectangle);
    p.controller.pressingKeySet.add("k");
    p.entityMoveManager.dragSelection(new Vector(-150, 0), false);
    expect(n.parentSection).toBe(outer);
    expect(inner.children).not.toContain(n);
    inside(outer, n.rectangle);
  });

  it("restores K-key transfer membership through undo, redo and file serialization", () => {
    Settings.containerNBoundary = true;
    const p = fixture();
    const d = cage(p);
    const n = node(p);
    p.stageManager.add(n);
    d.adopt(n);
    p.historyManager = new HistoryManager(p);
    n.isSelected = true;
    p.entityMoveManager.beginPointerDrag(n);
    p.controller.pressingKeySet.add("k");
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
