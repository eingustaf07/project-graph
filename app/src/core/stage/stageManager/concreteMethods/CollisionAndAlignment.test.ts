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
const settings = vi.hoisted(() => ({
  isEnableSectionCollision: true,
  isEnableEntityCollision: false,
  enableDragAutoAlign: true,
  textNodeMaxCharWidth: 15,
  defaultFontFamily: "sans-serif",
  sectionInitBorderStyle: "solid",
  historyManagerMode: "memoryEfficient",
  historySize: 100,
  watch: () => () => {},
}));
vi.mock("@/core/service/Settings", () => ({ Settings: settings }));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: { play: { alignAndAttach: vi.fn() } } }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() }) }));

import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { TextNode } from "../../stageObject/entity/TextNode";
import { Section } from "../../stageObject/entity/Section";
import { CollisionBox } from "../../stageObject/collisionBox/collisionBox";
import { StageManager } from "../StageManager";
import { SectionMethods } from "../basicMethods/SectionMethods";
import { SectionCollisionSolver } from "./SectionCollisionSolver";
import { AutoAlign } from "./StageAutoAlignManager";
import { getMultiLineTextSize } from "@/utils/font";
import { HistoryManager } from "../StageHistoryManager";
import { serialize, deserialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";

function fixture() {
  const p: any = {
    stage: [],
    emit: vi.fn(),
    effects: { addEffect: vi.fn() },
    syncAssociationManager: { syncFrom: vi.fn() },
    renderer: { getCoverWorldRectangle: () => new Rectangle(new Vector(-10000, -10000), new Vector(20000, 20000)) },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
  };
  p.stageManager = new StageManager(p);
  p.sectionMethods = new SectionMethods(p);
  p.sectionCollisionSolver = new SectionCollisionSolver(p);
  p.autoAlign = new AutoAlign(p);
  p.historyManager = new HistoryManager(p);
  const node = (x: number, y = 0) => {
    const child = new TextNode(p, {
      text: "测试节点",
      collisionBox: new CollisionBox([new Rectangle(new Vector(x, y), Vector.getZero())]),
    });
    p.stageManager.add(child);
    return child;
  };
  const group = (x: number, y = 0) => {
    const child = node(x, y);
    const section = new Section(p, { text: "", children: [child] });
    p.stageManager.add(section);
    return { section, child };
  };
  return { p, group, node };
}
function overlap(a: Section | TextNode, b: Section | TextNode) {
  const size = a.rectangle.getOverlapSize(b.rectangle);
  return size.x > 0.001 && size.y > 0.001;
}
beforeEach(() => {
  settings.isEnableSectionCollision = true;
  settings.isEnableEntityCollision = false;
});
describe("section collision with real PG objects", () => {
  it("separates root sections after direct drag movement", () => {
    const { group } = fixture();
    const a = group(0),
      b = group(600);
    a.section.move(new Vector(550, 0));
    expect(overlap(a.section, b.section)).toBe(false);
  });
  it("does not push a sibling into a third section", () => {
    const { p, group } = fixture();
    const groups = [group(0), group(100), group(300)];
    p.sectionCollisionSolver.solveOverlaps(groups[0].section);
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        expect(overlap(groups[i].section, groups[j].section)).toBe(false);
      }
  });
  it("handles full containment rather than shifting only the intersection width", () => {
    const { p, group } = fixture();
    const a = group(0),
      b = group(0);
    a.child.rename("很长的节点文字".repeat(12));
    a.section.adjustLocationAndSize();
    p.sectionCollisionSolver.solveOverlaps(a.section);
    expect(overlap(a.section, b.section)).toBe(false);
  });
});

describe("text node collision with the user's collision and auto-align settings", () => {
  beforeEach(() => {
    settings.isEnableEntityCollision = true;
  });
  it("snaps newly created nodes only while both background grid lines are visible", () => {
    const { p, node } = fixture();
    p.backgroundRenderer = { getCurrentGap: () => 100 };
    Object.assign(settings, {
      snapNewNodesToGrid: true,
      showBackgroundHorizontalLines: true,
      showBackgroundVerticalLines: false,
    });
    try {
      expect(node(-147, 256).rectangle.location).toEqual(new Vector(-147, 256));
      Object.assign(settings, { showBackgroundVerticalLines: true });
      const snapped = node(147, 256);
      const r = snapped.rectangle;
      expect([r.left, r.right].some((x) => Math.abs(x / 100 - Math.round(x / 100)) < 1e-8)).toBe(true);
      expect([r.top, r.bottom].some((y) => Math.abs(y / 100 - Math.round(y / 100)) < 1e-8)).toBe(true);
    } finally {
      Object.assign(settings, {
        snapNewNodesToGrid: false,
        showBackgroundVerticalLines: false,
        showBackgroundHorizontalLines: false,
      });
    }
  });
  it("keeps snapped nodes on a grid corner after a drag collision and restores the full result on undo", () => {
    const { p, node } = fixture();
    p.backgroundRenderer = { getCurrentGap: () => 100 };
    Object.assign(settings, {
      snapNewNodesToGrid: true,
      showBackgroundHorizontalLines: true,
      showBackgroundVerticalLines: true,
    });
    try {
      const a = node(150, 150),
        b = node(600, 600),
        c = node(600, 700);
      const corner = (n: TextNode) => {
        const onGrid = (v: number) => Math.abs(v / 100 - Math.round(v / 100)) < 1e-8;
        expect([n.rectangle.left, n.rectangle.right].some(onGrid)).toBe(true);
        expect([n.rectangle.top, n.rectangle.bottom].some(onGrid)).toBe(true);
      };
      p.historyManager.recordStep();
      const before = serialize(p.stage);
      a.moveTo(b.rectangle.location.clone());
      p.historyManager.recordStep();
      const after = serialize(p.stage);
      for (const item of [a, b, c]) corner(item);
      expect(overlap(a, b)).toBe(false);
      expect(overlap(b, c)).toBe(false);
      p.historyManager.undo();
      expect(serialize(p.stage)).toEqual(before);
      p.historyManager.redo();
      expect(serialize(p.stage)).toEqual(after);
    } finally {
      Object.assign(settings, {
        snapNewNodesToGrid: false,
        showBackgroundHorizontalLines: false,
        showBackgroundVerticalLines: false,
      });
    }
  });
  it("moves a snapped batch together out of existing nodes, preserving layer alignment and branch spacing", () => {
    const { p, node } = fixture();
    const obstacle = node(100, 100);
    const a = node(700, 700),
      b = node(700, 900);
    settings.isEnableEntityCollision = false;
    a.moveTo(new Vector(115, 105));
    b.moveTo(new Vector(115, 305));
    settings.isEnableEntityCollision = true;
    p.backgroundRenderer = { getCurrentGap: () => 100 };
    Object.assign(settings, {
      snapNewNodesToGrid: true,
      showBackgroundHorizontalLines: true,
      showBackgroundVerticalLines: true,
    });
    try {
      p.stageManager.snapCreatedNodes([a, b]);
      expect(a.rectangle.left).toBe(b.rectangle.left);
      expect(a.rectangle.bottom).toBeLessThan(b.rectangle.top);
      expect(overlap(a, obstacle)).toBe(false);
      expect(overlap(b, obstacle)).toBe(false);
      const after = serialize(p.stage);
      p.stageManager.snapCreatedNodes([a, b]);
      expect(serialize(p.stage)).toEqual(after);
    } finally {
      Object.assign(settings, {
        snapNewNodesToGrid: false,
        showBackgroundHorizontalLines: false,
        showBackgroundVerticalLines: false,
      });
    }
  });
  it("separates nodes with exactly matching centers after a drag", () => {
    const { node } = fixture();
    const a = node(0),
      b = node(600);
    a.move(new Vector(600, 0));
    expect(overlap(a, b)).toBe(false);
  });
  it("applies collision when moving to absolute coordinates", () => {
    const { node } = fixture();
    const a = node(0),
      b = node(600);
    a.moveTo(new Vector(610, 0));
    expect(overlap(a, b)).toBe(false);
  });
  it("pushes neighbors after editing text grows the node", () => {
    const { node } = fixture();
    const a = node(0),
      b = node(0, 160);
    a.rename("很长的文字内容".repeat(30));
    expect(overlap(a, b)).toBe(false);
  });
  it("keeps nodes separate after actual automatic alignment", () => {
    const { p, node } = fixture();
    const a = node(0),
      b = node(600);
    a.moveTo(new Vector(610, 0));
    a.isSelected = true;
    p.autoAlign.alignAllSelected();
    expect(overlap(a, b)).toBe(false);
  });
  it("resolves the new overlap produced by snapping X and Y to different neighbors", () => {
    settings.isEnableEntityCollision = false;
    const { p, node } = fixture();
    const a = node(0);
    const { x: width, y: height } = a.rectangle.size;
    const b = node(10, height + 30),
      c = node(width + 30, 10),
      obstacle = node(width + 5, height + 5);
    obstacle.collisionBox.shapes[0] = new Rectangle(new Vector(width + 5, height + 5), new Vector(20, 20));
    settings.isEnableEntityCollision = true;
    a.isSelected = true;
    p.autoAlign.alignAllSelected();
    expect(a.rectangle.location).toEqual(new Vector(10, 10));
    for (const other of [b, c, obstacle]) expect(overlap(a, other)).toBe(false);
  });
  it("separates newly created nodes while keeping the new node at its requested location", () => {
    const { node } = fixture();
    const a = node(0),
      b = node(0);
    expect(overlap(a, b)).toBe(false);
    expect(b.rectangle.location).toEqual(Vector.getZero());
  });
  it("checks manual width changes and manual-mode text growth", () => {
    const { node } = fixture();
    const a = node(0),
      b = node(230);
    a.sizeAdjust = "manual";
    a.resizeWidthTo(600);
    expect(overlap(a, b)).toBe(false);
    const c = node(0, 180);
    a.rename("多行文字".repeat(60));
    expect(overlap(a, c)).toBe(false);
  });
  it("handles a containing node and pushes a chain without zero-direction recursion", () => {
    const { node } = fixture();
    const large = node(0);
    large.rename("多行节点".repeat(40));
    const small = node(900, 100);
    small.moveTo(new Vector(100, 100));
    expect(overlap(large, small)).toBe(false);
    const first = node(2000);
    const step = first.rectangle.width + 1;
    const nodes = [first, ...Array.from({ length: 29 }, (_, i) => node(2000 + (i + 1) * step, 0))];
    nodes[0].move(new Vector(step, 0));
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        expect(overlap(nodes[i], nodes[j])).toBe(false);
      }
  });
  it("pushes a blocker out of a 4096-node row without propagating movement through the row", () => {
    const { p, node } = fixture();
    const active = node(-500);
    const step = active.rectangle.width;
    const row = Array.from(
      { length: 4096 },
      (_, i) =>
        new TextNode(p, {
          text: active.text,
          collisionBox: new CollisionBox([new Rectangle(new Vector(i * step, 0), Vector.getZero())]),
        }),
    );
    p.stage.push(...row);
    const scans = vi.spyOn(p.stageManager, "getEntities");
    active.moveTo(Vector.getZero());
    expect(scans).toHaveBeenCalledTimes(1);
    expect(row.every((n) => !overlap(active, n))).toBe(true);
    expect(row.slice(1).every((n, i) => !overlap(row[0], n) && n.rectangle.left === (i + 1) * step)).toBe(true);
  });
  it("preserves opt-out and does not move the live graph while constructing detached clipboard nodes", () => {
    const { p, node } = fixture();
    const a = node(0);
    const before = serialize(p.stage);
    new TextNode(p, { text: "未加入舞台的新节点" });
    expect(serialize(p.stage)).toEqual(before);
    settings.isEnableEntityCollision = false;
    const b = node(0);
    expect(overlap(a, b)).toBe(true);
    a.rename("新的长内容".repeat(25));
    expect(b.rectangle.location).toEqual(Vector.getZero());
  });
  it("undoes, redoes and restores all affected geometry without changing text or settings", () => {
    const { p, node } = fixture();
    const a = node(0),
      b = node(600);
    p.historyManager.recordStep();
    const before = serialize(p.stage);
    a.move(new Vector(600, 0));
    p.historyManager.recordStep();
    const after = serialize(p.stage);
    expect(overlap(a, b)).toBe(false);
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(after);
    const restored: TextNode[] = deserialize(decode(new Encoder().encode(serialize(p.stage))), p);
    expect(restored).toHaveLength(2);
    for (const restoredNode of restored) {
      const current = p.stageManager.get(restoredNode.uuid) as TextNode;
      expect(restoredNode.text).toBe(current.text);
      expect(restoredNode.rectangle.left).toBeCloseTo(current.rectangle.left, 8);
      expect(restoredNode.rectangle.top).toBeCloseTo(current.rectangle.top, 8);
      expect(restoredNode.rectangle.width).toBeCloseTo(current.rectangle.width, 8);
      expect(restoredNode.rectangle.height).toBeCloseTo(current.rectangle.height, 8);
    }
    expect(overlap(restored[0], restored[1])).toBe(false);
    expect(settings.isEnableEntityCollision).toBe(true);
    expect(settings.isEnableSectionCollision).toBe(true);
    expect(settings.enableDragAutoAlign).toBe(true);
  });
});
