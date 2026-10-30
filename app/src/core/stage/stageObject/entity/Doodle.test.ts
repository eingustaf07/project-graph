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
beforeEach(() => vi.clearAllMocks());
describe("real PG doodles and fixed containers", () => {
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
