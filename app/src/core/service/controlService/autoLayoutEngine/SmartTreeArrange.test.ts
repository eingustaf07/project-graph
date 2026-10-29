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
    enableSmartTreeArrange: true,
    smartTreeArrangeMode: "preserve",
    smartTreeArrangeDirection: "right",
    smartTreeLevelGap: 64,
    smartTreeNodeGap: 24,
    smartTreeSubtreeGap: 40,
    textNodeMaxCharWidth: 15,
    defaultFontFamily: "sans-serif",
    historyManagerMode: "memoryEfficient",
    historySize: 100,
    showDebug: false,
    watch: () => () => {},
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/NodeMoveShadowEffect", () => ({
  NodeMoveShadowEffect: class {},
}));

import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { serialize, deserialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";
import { getMultiLineTextSize } from "@/utils/font";
import { arrangeSmartTree } from "./SmartTreeArrange";
import { findOverlaps, planSmartTree, type SmartTreeOptions, type TreeDirection } from "./SmartTreeLayout";
import { objectRect } from "@/core/service/dataManageService/aiEngine/AITreeLayout";

const options: SmartTreeOptions = { mode: "standard", direction: "right", levelGap: 64, nodeGap: 24, subtreeGap: 40 };
const rates = (direction: TreeDirection) =>
  direction === "left"
    ? new Vector(0.01, 0.5)
    : direction === "up"
      ? new Vector(0.5, 0.01)
      : direction === "down"
        ? new Vector(0.5, 0.99)
        : new Vector(0.99, 0.5);
const opposite = (direction: TreeDirection) =>
  (({ left: "right", right: "left", up: "down", down: "up" }) as const)[direction];

function fixture(count = 10, parent = (i: number) => Math.floor((i - 1) / 3), direction: TreeDirection = "right") {
  const p: any = {
    stage: [],
    emit: vi.fn(),
    camera: { location: new Vector(10, 20), scale: 1.2 },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
  };
  p.stageManager = {
    get: (id: string) => p.stage.find((n: any) => n.uuid === id),
    getEntities: () => p.stage.filter((n: unknown) => n instanceof TextNode),
    getEdges: () => p.stage.filter((n: unknown) => n instanceof LineEdge),
    getSelectedEntities: () => p.stageManager.getEntities().filter((n: TextNode) => n.isSelected),
    updateReferences: vi.fn(),
  };
  const nodes: TextNode[] = [];
  for (let i = 0; i < count; i++) {
    const n = new TextNode(p, { uuid: `n${i}`, text: i % 3 ? `节点${i}` : "多行文本内容".repeat(8) });
    const r = n.rectangle;
    n.collisionBox.updateShapeList([
      new Rectangle(new Vector(100 + ((i * 17) % 700), 200 + ((i * 113) % 500)), r.size.clone()),
    ]);
    nodes.push(n);
    p.stage.push(n);
  }
  for (let i = 1; i < count; i++) {
    const source = rates(direction);
    p.stage.push(
      new LineEdge(p, {
        uuid: `e${i}`,
        associationList: [nodes[parent(i)], nodes[i]],
        sourceRectangleRate: source,
        targetRectangleRate: rates(opposite(direction)),
      }),
    );
  }
  nodes[0].isSelected = true;
  p.historyManager = new HistoryManager(p);
  return { p: p as Project, nodes };
}

function positions(p: Project) {
  return p.stageManager.getEntities().map(objectRect);
}
function nonPositions(p: Project) {
  return serialize(p.stage).map((n: any) => {
    const copy = { ...n };
    delete copy.collisionBox;
    delete copy.sourceRectangleRate;
    delete copy.targetRectangleRate;
    return copy;
  });
}

describe("experimental smart tree arrangement with real PG nodes, edges and history", () => {
  beforeEach(() => {
    Settings.enableSmartTreeArrange = true;
    Settings.historyManagerMode = "memoryEfficient";
  });

  it.each(["right", "left", "up", "down"] as const)(
    "arranges a measured 100-node tree to %s, keeps order, depth and exact content, remains stable for 10 runs",
    (direction) => {
      const { p, nodes } = fixture(100);
      const root = objectRect(nodes[0]),
        original = nonPositions(p),
        camera = JSON.stringify(p.camera);
      const dimensions = nodes.map((n) => n.rectangle.size.clone());
      const spy = vi.spyOn(p.historyManager, "recordStep");
      arrangeSmartTree(p, { ...options, direction });
      const after = positions(p);
      expect(findOverlaps(after)).toEqual([]);
      expect(nodes.map((n) => n.rectangle.size)).toEqual(dimensions);
      expect(after[0]).toEqual(root);
      expect(nonPositions(p)).toEqual(original);
      const vertical = direction === "up" || direction === "down";
      const levels = new Map<number, number>();
      const depthOf = (i: number): number => (i === 0 ? 0 : depthOf(Math.floor((i - 1) / 3)) + 1);
      for (let i = 0; i < after.length; i++) {
        const d = depthOf(i),
          r = after[i];
        const line =
          direction === "right"
            ? r.x
            : direction === "left"
              ? r.x + r.width
              : direction === "down"
                ? r.y
                : r.y + r.height;
        if (levels.has(d)) expect(line).toBeCloseTo(levels.get(d)!, 8);
        else levels.set(d, line);
      }
      const descendantsAtDepth = (rootIndex: number, d: number) =>
        after.filter((_, index) => {
          if (depthOf(index) !== d) return false;
          while (index > rootIndex) index = Math.floor((index - 1) / 3);
          return index === rootIndex;
        });
      for (let parent = 0; parent < nodes.length; parent++) {
        const siblings = [parent * 3 + 1, parent * 3 + 2, parent * 3 + 3].filter((i) => i < nodes.length);
        for (let s = 1; s < siblings.length; s++)
          for (let d = depthOf(siblings[s]); d <= 4; d++) {
            const a = descendantsAtDepth(siblings[s - 1], d),
              b = descendantsAtDepth(siblings[s], d);
            if (!a.length || !b.length) continue;
            const end = Math.max(...a.map((r) => (vertical ? r.x + r.width : r.y + r.height)));
            const start = Math.min(...b.map((r) => (vertical ? r.x : r.y)));
            expect(start - end).toBeGreaterThanOrEqual((d === depthOf(siblings[s]) ? 24 : 40) - 1e-7);
          }
      }
      for (let i = 1; i < nodes.length; i++) {
        const parentIndex = Math.floor((i - 1) / 3),
          a = after[parentIndex],
          b = after[i];
        if (direction === "right") expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(64 - 1e-7);
        if (direction === "left") expect(a.x - b.x - b.width).toBeGreaterThanOrEqual(64 - 1e-7);
        if (direction === "down") expect(b.y - a.y - a.height).toBeGreaterThanOrEqual(64 - 1e-7);
        if (direction === "up") expect(a.y - b.y - b.height).toBeGreaterThanOrEqual(64 - 1e-7);
        if (i % 3 !== 1) expect(vertical ? b.x : b.y).toBeGreaterThan(vertical ? after[i - 1].x : after[i - 1].y);
      }
      for (let i = 0; i < 10; i++) arrangeSmartTree(p, { ...options, direction });
      expect(positions(p)).toEqual(after);
      expect(spy).toHaveBeenCalledOnce();
      expect(JSON.stringify(p.camera)).toBe(camera);
    },
  );

  it.each(["memoryEfficient", "timeEfficient"] as const)(
    "undoes, redoes and round-trips actual serialized PG data in %s mode",
    (mode) => {
      Settings.historyManagerMode = mode;
      const { p } = fixture();
      const before = serialize(p.stage);
      arrangeSmartTree(p, options);
      const after = serialize(p.stage);
      p.historyManager.undo();
      expect(serialize(p.stage)).toEqual(before);
      p.historyManager.redo();
      expect(serialize(p.stage)).toEqual(after);
      const file = new Encoder().encode(serialize(p.stage));
      p.stage = deserialize(decode(file), p);
      expect(serialize(p.stage)).toEqual(after);
      expect(findOverlaps(positions(p))).toEqual([]);
    },
  );

  it("only moves selected middle subtree and avoids external nodes without moving them", () => {
    const { p, nodes } = fixture();
    nodes[0].isSelected = false;
    nodes[1].isSelected = true;
    const unaffected = [nodes[0], nodes[2], nodes[3], nodes[7], nodes[8], nodes[9]].map(objectRect);
    arrangeSmartTree(p, options);
    expect([nodes[0], nodes[2], nodes[3], nodes[7], nodes[8], nodes[9]].map(objectRect)).toEqual(unaffected);
    expect(findOverlaps([nodes[1], nodes[4], nodes[5], nodes[6]].map(objectRect), unaffected)).toEqual([]);
  });

  it("packs asymmetric subtrees by contours rather than their full bounding boxes", () => {
    const { p } = fixture(100, (i) => (i < 5 ? 0 : i < 50 ? i - 1 : 3));
    arrangeSmartTree(p, options);
    expect(findOverlaps(positions(p))).toEqual([]);
  });

  it("keeps a 500-node single-child chain on a straight line", () => {
    const { p } = fixture(500, (i) => i - 1);
    arrangeSmartTree(p, options);
    const ys = positions(p).map((r) => r.y + r.height / 2);
    expect(new Set(ys).size).toBe(1);
    expect(findOverlaps(positions(p))).toEqual([]);
  });

  it("handles a root with 99 children and preserves all measured sizes", () => {
    const { p } = fixture(100, () => 0);
    const dimensions = p.stageManager.getEntities().map((n) => (n.collisionBox.shapes[0] as Rectangle).size.clone());
    arrangeSmartTree(p, options);
    expect(p.stageManager.getEntities().map((n) => (n.collisionBox.shapes[0] as Rectangle).size)).toEqual(dimensions);
    expect(findOverlaps(positions(p))).toEqual([]);
  });

  it("handles a single node without a needless history entry", () => {
    const { p } = fixture(1),
      record = vi.spyOn(p.historyManager, "recordStep");
    expect(arrangeSmartTree(p, options).movedCount).toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  it("keeps dashed cross-branch links and their endpoints exactly as saved", () => {
    const { p, nodes } = fixture();
    const extra = new LineEdge(p, { associationList: [nodes[4], nodes[8]], lineType: "dashed", text: "关联" });
    p.stage.push(extra);
    const saved = {
      text: extra.text,
      lineType: extra.lineType,
      members: extra.associationList.map((n) => n.uuid),
      source: extra.sourceRectangleRate.clone(),
      target: extra.targetRectangleRate.clone(),
    };
    arrangeSmartTree(p, options);
    expect({
      text: extra.text,
      lineType: extra.lineType,
      members: extra.associationList.map((n) => n.uuid),
      source: extra.sourceRectangleRate,
      target: extra.targetRectangleRate,
    }).toEqual(saved);
    expect(findOverlaps(positions(p))).toEqual([]);
  });

  it("retains homogeneous left growth and permits a root split between left and right", () => {
    const { p, nodes } = fixture(10, undefined, "left");
    arrangeSmartTree(p, { ...options, mode: "preserve" });
    expect(nodes[1].rectangle.right).toBeLessThan(nodes[0].rectangle.left);
    const edges = p.stageManager.getEdges();
    for (const e of edges.filter((e) => [nodes[2], nodes[7], nodes[8], nodes[9]].includes(e.target as TextNode))) {
      e.sourceRectangleRate = rates("right");
      e.targetRectangleRate = rates("left");
    }
    arrangeSmartTree(p, { ...options, mode: "preserve" });
    expect(nodes[2].rectangle.left).toBeGreaterThan(nodes[0].rectangle.right);
    expect(nodes[1].rectangle.right).toBeLessThan(nodes[0].rectangle.left);
    expect(findOverlaps(positions(p))).toEqual([]);
  });

  it("lays out multiple selected trees in one history entry and suppresses duplicate selected descendants", () => {
    const { p, nodes } = fixture(10, (i) => (i === 9 ? 8 : 0));
    const edge = p.stageManager.getEdges().find((e) => e.target === nodes[8])!;
    p.stage.splice(p.stage.indexOf(edge), 1);
    nodes[8].isSelected = true;
    nodes[1].isSelected = true;
    const record = vi.spyOn(p.historyManager, "recordStep");
    arrangeSmartTree(p, options);
    expect(findOverlaps(positions(p))).toEqual([]);
    expect(record).toHaveBeenCalledOnce();
    const result = positions(p);
    arrangeSmartTree(p, options);
    expect(positions(p)).toEqual(result);
  });

  it.each(["cycle", "multiple", "turn", "group", "disabled"])("refuses %s atomically", (kind) => {
    const { p, nodes } = fixture();
    if (kind === "cycle") p.stage.push(new LineEdge(p, { associationList: [nodes[4], nodes[0]] }));
    if (kind === "multiple") p.stage.push(new LineEdge(p, { associationList: [nodes[2], nodes[4]] }));
    if (kind === "turn")
      p.stageManager.getEdges().find((e) => e.target === nodes[4])!.sourceRectangleRate = rates("up");
    if (kind === "group") nodes[1].parentSection = {} as never;
    if (kind === "disabled") Settings.enableSmartTreeArrange = false;
    const before = serialize(p.stage),
      record = vi.spyOn(p.historyManager, "recordStep");
    expect(() => arrangeSmartTree(p, { ...options, mode: "preserve" })).toThrow();
    expect(serialize(p.stage)).toEqual(before);
    expect(record).not.toHaveBeenCalled();
  });

  it("restores coordinates and edge ports if commit fails", () => {
    const { p } = fixture();
    const before = serialize(p.stage);
    vi.spyOn(p.historyManager, "recordStep").mockImplementation(() => {
      throw new Error("commit failure");
    });
    expect(() => arrangeSmartTree(p, { ...options, direction: "down" })).toThrow("commit failure");
    expect(serialize(p.stage)).toEqual(before);
  });

  it("rejects invalid dimensions instead of applying a partial plan", () => {
    expect(() => planSmartTree([{ id: "r", x: 0, y: 0, width: NaN, height: 30 }], [], "r", options)).toThrow("尺寸");
  });
});
