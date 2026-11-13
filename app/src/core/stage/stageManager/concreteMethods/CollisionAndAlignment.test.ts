import { ControllerContextMenuClass } from "@/core/service/controlService/controller/concrete/ControllerContextMenu";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { EdgeRenderer } from "@/core/render/canvas2d/entityRenderer/edge/EdgeRenderer";
import { VerticalPolyEdgeRenderer } from "@/core/render/canvas2d/entityRenderer/edge/concrete/VerticalPolyEdgeRenderer";
import { crossesRectangle } from "@/core/algorithm/orthogonalPath";
import * as orthogonalRouting from "@/core/algorithm/orthogonalPath";
import { getOrthogonalEdgeBounds } from "../../stageObject/association/OrthogonalEdgePath";
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
  lineStyle: "straight",
  showBidirectionalArrows: false,
  isEnableSectionCollision: true,
  isEnableEntityCollision: false,
  enableDragAutoAlign: true,
  enableDragAlignToGrid: false,
  textNodeMaxCharWidth: 15,
  defaultFontFamily: "sans-serif",
  sectionInitBorderStyle: "solid",
  historyManagerMode: "memoryEfficient",
  historySize: 100,
  watch: () => () => {},
}));
vi.mock("@/core/service/Settings", () => ({ Settings: settings }));
vi.mock("@/utils/platform", () => ({ isMac: false, isWeb: false, isDesktop: true }));
vi.mock("@/core/service/controlService/MouseLocation", () => ({ MouseLocation: {} }));
vi.mock("@/core/stage/stageObject/entity/ExtensionEntity", () => ({ ExtensionEntity: class {} }));
vi.mock("@/core/stage/stageObject/entity/ReferenceBlockNode", () => ({ ReferenceBlockNode: class {} }));
vi.mock("@/core/service/controlService/controller/ControllerClass", () => ({
  ControllerClass: class {
    constructor(public project: unknown) {}
    dispose() {}
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: { playDoodleCreated: vi.fn(), play: { alignAndAttach: vi.fn(), cuttingLineRelease: vi.fn() } },
}));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() }) }));

import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { TextNode } from "../../stageObject/entity/TextNode";
import { Section } from "../../stageObject/entity/Section";
import { CollisionBox } from "../../stageObject/collisionBox/collisionBox";
import { StageManager } from "../StageManager";
import { SectionMethods } from "../basicMethods/SectionMethods";
import { SectionCollisionSolver } from "./SectionCollisionSolver";
import { AutoAlign } from "./StageAutoAlignManager";
import { EntityMoveManager } from "./StageEntityMoveManager";
import { getMultiLineTextSize } from "@/utils/font";
import { HistoryManager } from "../StageHistoryManager";
import { serialize, deserialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";
import { Decoder } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { parseProjectFile } from "@/core/ProjectFile";
import { GraphMethods } from "../basicMethods/GraphMethods";
import { NodeConnector } from "./StageNodeConnector";
import { LineEdge } from "../../stageObject/association/LineEdge";
import { DeleteManager } from "./StageDeleteManager";
import { ControllerCuttingClass } from "@/core/service/controlService/controller/concrete/ControllerCutting";

function fixture() {
  const p: any = {
    stage: [],
    attachments: new Map(),
    controller: { pressingKeySet: new Set<string>() },
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
  p.graphMethods = new GraphMethods(p);
  p.sectionMethods = new SectionMethods(p);
  p.sectionCollisionSolver = new SectionCollisionSolver(p);
  p.autoAlign = new AutoAlign(p);
  p.entityMoveManager = new EntityMoveManager(p);
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
describe("vertical connection defaults with real PG objects", () => {
  it("reuses fallback paths and bounds while zooming and retries when an overlapping blocker disappears", () => {
    const { p, node } = fixture();
    settings.lineStyle = "vertical";
    const routing = vi.spyOn(orthogonalRouting, "orthogonalPath");
    try {
      const a = node(0),
        b = node(600),
        blocker = node(a.rectangle.right - 10);
      const edge = new LineEdge(p, {
        associationList: [a, b],
        sourceRectangleRate: new Vector(0.99, 0.5),
        targetRectangleRate: new Vector(0.01, 0.5),
      });
      p.stageManager.add(edge);
      p.renderer.frameIndex = 1;
      const path = edge.orthogonalPath;
      const box = getOrthogonalEdgeBounds(edge);
      const coldCalls = routing.mock.calls.length;
      expect(routing.mock.results[0].value).toEqual([]);
      for (let i = 0; i < 10; i++) {
        p.renderer.frameIndex++;
        p.camera = { currentScale: 1 / (i + 1) };
        expect(edge.orthogonalPath).toBe(path);
        expect(getOrthogonalEdgeBounds(edge)).toBe(box);
      }
      expect(routing).toHaveBeenCalledTimes(coldCalls);
      p.stageManager.delete(blocker);
      p.renderer.frameIndex++;
      expect(edge.orthogonalPath).not.toBe(path);
      expect(routing.mock.calls.length).toBeGreaterThan(coldCalls);
      expect(getOrthogonalEdgeBounds(edge)).not.toBe(box);
    } finally {
      routing.mockRestore();
      settings.lineStyle = "straight";
    }
  });
  it("renders clickable orthogonal segments with two tangent-aligned arrows and no persistent endpoint dots", () => {
    const { p, node } = fixture();
    settings.lineStyle = "vertical";
    settings.showBidirectionalArrows = true;
    try {
      const a = node(0, 0),
        b = node(0, 400),
        middle = node(-20, 150);
      const edge = new LineEdge(p, {
        associationList: [a, b],
        sourceRectangleRate: new Vector(0.5, 0.99),
        targetRectangleRate: new Vector(0.5, 0.01),
      });
      p.stageManager.add(edge);
      p.camera = { currentScale: 1 };
      p.renderer.transformWorld2View = (v: Vector) => v;
      p.curveRenderer = { renderSolidLine: vi.fn(), renderDashedLine: vi.fn() };
      p.shapeRenderer = { renderCircle: vi.fn(), renderPolygonAndFill: vi.fn() };
      p.stageStyleManager = { currentStyle: { StageObjectBorder: Color.White } };
      p.verticalPolyEdgeRenderer = new VerticalPolyEdgeRenderer(p);
      p.edgeRenderer = new EdgeRenderer(p);
      const arrows = vi.spyOn(p.edgeRenderer, "renderArrowHead");
      const path = edge.orthogonalPath;
      expect(path.length).toBeGreaterThan(2);
      for (let i = 1; i < path.length; i++) {
        expect(crossesRectangle(path[i - 1], path[i], middle.rectangle)).toBe(false);
        expect(edge.isIntersectsWithLocation(path[i - 1].add(path[i]).multiply(0.5))).toBe(true);
      }
      expect(edge.isIntersectsWithLocation(new Vector(a.rectangle.center.x, 200))).toBe(false);
      p.edgeRenderer.renderLineEdge(edge);
      expect(p.curveRenderer.renderSolidLine).toHaveBeenCalledTimes(path.length - 1);
      expect(p.shapeRenderer.renderCircle).not.toHaveBeenCalled();
      expect(arrows).toHaveBeenCalledTimes(2);
      expect(arrows.mock.calls[0][0]).toEqual(path.at(-1));
      expect(arrows.mock.calls[1][0]).toEqual(path[0]);
      const sourceTangent = path[0].subtract(path[1]).normalize();
      const renderedTangent = arrows.mock.calls[1][1] as Vector;
      expect(renderedTangent.x).toBeCloseTo(sourceTangent.x);
      expect(renderedTangent.y).toBeCloseTo(sourceTangent.y);
      expect(edge.source).toBe(a);
      expect(edge.target).toBe(b);
      settings.showBidirectionalArrows = false;
      arrows.mockClear();
      p.edgeRenderer.renderLineEdge(edge);
      expect(arrows).toHaveBeenCalledOnce();
      p.collisionBoxRenderer = { render: vi.fn() };
      p.stageStyleManager.currentStyle.CollideBoxSelected = Color.Green;
      edge.isSelected = true;
      p.edgeRenderer.renderLineEdge(edge);
      expect(p.curveRenderer.renderDashedLine).not.toHaveBeenCalled();
    } finally {
      settings.lineStyle = "straight";
      settings.showBidirectionalArrows = false;
    }
  });
  it("reuses world paths while panning and reroutes when an obstacle moves into the line", () => {
    const { p, node } = fixture();
    settings.lineStyle = "vertical";
    try {
      const a = node(0),
        b = node(600),
        obstacle = node(300, 500);
      const edge = new LineEdge(p, { associationList: [a, b] });
      p.stageManager.add(edge);
      p.renderer.frameIndex = 1;
      const initial = edge.orthogonalPath;
      p.renderer.frameIndex = 2;
      expect(edge.orthogonalPath).toBe(initial);
      obstacle.rectangle.location = new Vector(300, 0);
      p.renderer.frameIndex = 3;
      const rerouted = edge.orthogonalPath;
      expect(rerouted).not.toBe(initial);
      expect(rerouted.slice(1).every((p, i) => !crossesRectangle(rerouted[i], p, obstacle.rectangle))).toBe(true);
    } finally {
      settings.lineStyle = "straight";
    }
  });
  it("separates sibling trunks instead of painting their vertical segments on the same lane", () => {
    const { p, node } = fixture();
    settings.lineStyle = "vertical";
    try {
      const a = node(0),
        b = node(400, -200),
        c = node(400, 200);
      const first = new LineEdge(p, { associationList: [a, b] });
      const second = new LineEdge(p, { associationList: [a, c] });
      p.stageManager.add(first);
      p.stageManager.add(second);
      const verticals = (points: Vector[]) =>
        points.slice(1).flatMap((point, i) => (point.x === points[i].x && point.y !== points[i].y ? [point.x] : []));
      const x = verticals(first.orthogonalPath),
        y = verticals(second.orthogonalPath);
      expect(x.length).toBeGreaterThan(0);
      expect(y.length).toBeGreaterThan(0);
      expect(x.some((value) => y.includes(value))).toBe(false);
    } finally {
      settings.lineStyle = "straight";
    }
  });
  it("pushes through 300 touching nodes without recursion or changing the side coordinate", () => {
    const { p, node } = fixture();
    settings.isEnableEntityCollision = true;
    const first = node(0);
    const chain = [first];
    for (let i = 1; i < 300; i++) chain.push(node(chain[i - 1].rectangle.right));
    first.isSelected = true;
    p.entityMoveManager.dragSelection(new Vector(20, 0), false);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].rectangle.left).toBeCloseTo(chain[i - 1].rectangle.right);
      expect(chain[i].rectangle.top).toBe(0);
    }
  });
  it("preserves chain order, side coordinates, undo and auto-alignment during a continuous push", () => {
    const { p, node } = fixture();
    settings.isEnableEntityCollision = true;
    const chain = Array.from({ length: 20 }, (_, i) => node(i * 180, 0));
    chain[0].isSelected = true;
    const before = serialize(p.stage);
    p.historyManager.recordStep();
    for (let i = 0; i < 40; i++) p.entityMoveManager.dragSelection(new Vector(20, 0), false);
    const savedAlign = settings.enableDragAutoAlign;
    settings.enableDragAutoAlign = true;
    p.entityMoveManager.alignAfterPointerDrag();
    settings.enableDragAutoAlign = savedAlign;
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].rectangle.left).toBeGreaterThanOrEqual(chain[i - 1].rectangle.right - 1e-7);
      expect(chain[i].rectangle.top).toBe(0);
    }
    const after = serialize(p.stage);
    p.historyManager.recordStep();
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(after);
  });
  it("does not push a locked section's node aside and restores the drag", () => {
    const { p, node, group } = fixture();
    settings.isEnableEntityCollision = true;
    const a = node(0);
    const locked = group(400);
    locked.section.locked = true;
    p.stageManager.updateReferences();
    a.isSelected = true;
    const before = serialize(p.stage);
    p.entityMoveManager.dragSelection(new Vector(400, 0), false);
    expect(serialize(p.stage)).toEqual(before);
  });
  it.each([
    [200, 0],
    [-200, 0],
    [0, 200],
    [0, -200],
  ])("pushes a row of text nodes along the drag (%s,%s) without side-stepping", (dx, dy) => {
    const { p, node } = fixture();
    settings.isEnableEntityCollision = true;
    const horizontal = dx !== 0;
    const sign = Math.sign(dx || dy);
    const a = node(0, 0),
      b = node(horizontal ? sign * 180 : 0, horizontal ? 0 : sign * 180);
    const c = node(horizontal ? sign * 350 : 0, horizontal ? 0 : sign * 350);
    const start = [a, b, c].map((n) => n.rectangle.location.clone());
    a.isSelected = true;
    p.entityMoveManager.dragSelection(new Vector(dx, dy), false);
    for (const [i, n] of [a, b, c].entries()) {
      expect(horizontal ? n.rectangle.top : n.rectangle.left).toBe(horizontal ? start[i].y : start[i].x);
    }
    expect(overlap(a, b)).toBe(false);
    expect(overlap(b, c)).toBe(false);
    expect(horizontal ? b.rectangle.left * sign : b.rectangle.top * sign).toBeGreaterThan(
      horizontal ? start[1].x * sign : start[1].y * sign,
    );
  });
  it("restores the saved vertical renderer on construction", () => {
    const previous = settings.lineStyle;
    settings.lineStyle = "vertical";
    const renderer = {};
    try {
      const edgeRenderer = new EdgeRenderer({ verticalPolyEdgeRenderer: renderer } as any);
      expect((edgeRenderer as any).currentRenderer).toBe(renderer);
    } finally {
      settings.lineStyle = previous;
    }
  });
  it.each(["connectConnectableEntity", "connectEntityFast", "addArcEdge", "addCrEdge"] as const)(
    "uses the global vertical route for %s",
    (method) => {
      const { p, node } = fixture();
      const a = node(0),
        b = node(600);
      const previous = settings.lineStyle;
      settings.lineStyle = "vertical";
      try {
        new NodeConnector(p)[method](a, b);
        const edges = p.stageManager.getAssociations();
        expect(edges).toHaveLength(1);
        expect(edges[0]).toBeInstanceOf(LineEdge);
      } finally {
        settings.lineStyle = previous;
      }
    },
  );
});

describe("section collision with real PG objects", () => {
  it("separates root sections after direct drag movement", () => {
    const { group } = fixture();
    const a = group(0),
      b = group(600);
    a.section.move(new Vector(550, 0));
    expect(overlap(a.section, b.section)).toBe(false);
  });
  it("bypasses sibling section pushes for a V multi-drag until V is released", () => {
    const { p, group, node } = fixture();
    const a = group(0),
      b = group(900),
      extra = node(0, 600);
    a.child.isSelected = extra.isSelected = true;
    p.entityMoveManager.beginPointerDrag(a.child);
    const original = b.child.rectangle.location.clone();
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(900, 0), false);
    expect(b.child.rectangle.location).toEqual(original);
    expect(extra.rectangle.left).toBeCloseTo(900);
    p.controller.pressingKeySet.delete("v");
    p.entityMoveManager.dragSelection(new Vector(1, 0), false);
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
  it("cuts 1000 real PG edges with one reference rebuild and one undo transaction", () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { p } = fixture();
    settings.isEnableEntityCollision = false;
    p.renderer.transformView2World = (v: Vector) => v.multiply(10);
    p.controller.setCursorName = vi.fn();
    p.stageStyleManager = { currentStyle: { effects: { warningShadow: Vector.getZero() } } };
    p.deleteManager = new DeleteManager(p);
    const edges: LineEdge[] = [];
    for (let i = 0; i < 1000; i++) {
      const a = new TextNode(p, {
        text: "a",
        collisionBox: new CollisionBox([new Rectangle(new Vector(0, i * 100), Vector.getZero())]),
      });
      const b = new TextNode(p, {
        text: "b",
        collisionBox: new CollisionBox([new Rectangle(new Vector(1000, i * 100), Vector.getZero())]),
      });
      const edge = LineEdge.fromTwoEntity(p, a, b);
      p.stage.push(a, b, edge);
      edges.push(edge);
    }
    p.stageManager.updateReferences();
    p.historyManager.recordStep();
    const references = vi.spyOn(p.stageManager, "updateReferences");
    p.emit.mockClear();
    const cutter = new ControllerCuttingClass(p);
    (cutter as any).cuttingStartLocation = new Vector(500, -100);
    cutter.isUsing = true;
    const started = performance.now();
    cutter.mouseUpFunction(new Vector(50, 10000));
    console.log(
      JSON.stringify({
        cutEdges: edges.length,
        ms: performance.now() - started,
        referenceRebuilds: references.mock.calls.length,
      }),
    );
    expect(p.stageManager.getAssociations()).toHaveLength(0);
    expect(p.stageManager.getEntities()).toHaveLength(2000);
    expect(references).toHaveBeenCalledTimes(1);
    expect(p.emit.mock.calls.filter(([name]: [string]) => name === "stage-commit")).toHaveLength(1);
    p.historyManager.undo();
    expect(p.stageManager.getAssociations()).toHaveLength(1000);
    p.historyManager.redo();
    expect(p.stageManager.getAssociations()).toHaveLength(0);
    cutter.dispose();
    references.mockRestore();
  }, 30000);
  it("coalesces 100 pointer moves into one preview and uses the final release position", () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let frame: FrameRequestCallback = () => {};
    const request = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 17;
    });
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { p, node } = fixture();
    p.renderer.transformView2World = (v: Vector) => v.multiply(10);
    p.controller.setCursorName = vi.fn();
    p.controller.penStrokeControl = { isAdjusting: false };
    p.stageStyleManager = { currentStyle: { effects: { warningShadow: Vector.getZero() } } };
    p.deleteManager = new DeleteManager(p);
    const a = node(0, 500),
      b = node(1000, 500);
    p.stage.push(LineEdge.fromTwoEntity(p, a, b));
    p.historyManager.recordStep();
    const cutter = new ControllerCuttingClass(p);
    (cutter as any).cuttingStartLocation = new Vector(500, -100);
    cutter.isUsing = true;
    const preview = vi.spyOn(cutter as any, "updateWarningObjectByCuttingLine");
    for (let i = 0; i < 100; i++) cutter.mousemove({ clientX: 50, clientY: 0 } as MouseEvent);
    expect(request).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
    frame(16);
    expect(preview).toHaveBeenCalledTimes(1);
    cutter.mouseUpFunction(new Vector(50, 100));
    expect(preview).toHaveBeenCalledTimes(2);
    expect(p.stageManager.getAssociations()).toHaveLength(0);
    cutter.dispose();
  });
  it("keeps a locked branch when bulk deleting a mixture of locked and unlocked edges", () => {
    const { p, node } = fixture();
    p.deleteManager = new DeleteManager(p);
    const a = node(0),
      b = node(500),
      c = node(1000);
    const protectedEdge = LineEdge.fromTwoEntity(p, a, b);
    const freeEdge = LineEdge.fromTwoEntity(p, b, c);
    const section = new Section(p, { children: [a], locked: true });
    p.stage.push(section, protectedEdge, freeEdge);
    p.stageManager.updateReferences();
    p.historyManager.recordStep();
    p.stageManager.deleteAssociations([protectedEdge, freeEdge, freeEdge]);
    expect(p.stageManager.getAssociations()).toEqual([protectedEdge]);
    p.historyManager.undo();
    expect(p.stageManager.getAssociations()).toHaveLength(2);
  });
  it.skipIf(!process.env.PG_LARGE_TREE_FIXTURE)(
    "profiles dragging a tree from a read-only copy of the user's project",
    async () => {
      const file = process.env.PG_LARGE_TREE_FIXTURE!;
      const beforeFile = readFileSync(file);
      const parsed = await parseProjectFile(beforeFile, new Decoder(), new Map());
      const { p } = fixture();
      p.stage = deserialize(parsed.serializedStageObjects, p);
      p.stageManager.updateReferences();
      if (process.env.PG_ORTHOGONAL_PROFILE) {
        settings.lineStyle = "vertical";
        p.renderer.frameIndex = 1;
        const edges = p.stageManager.getLineEdges();
        const start = performance.now();
        for (const edge of edges) expect(edge.orthogonalPath.length).toBeGreaterThanOrEqual(2);
        const coldMs = performance.now() - start;
        p.renderer.frameIndex++;
        const warm = performance.now();
        for (const edge of edges) expect(edge.orthogonalPath.length).toBeGreaterThanOrEqual(2);
        console.log(JSON.stringify({ edges: edges.length, coldMs, warmMs: performance.now() - warm }));
        settings.lineStyle = "straight";
        expect(readFileSync(file)).toEqual(beforeFile);
        return;
      }
      const nodes = p.stageManager.getConnectableEntity();
      const roots = nodes.filter((n: any) => p.graphMethods.nodeParentArray(n).length === 0);
      const trees = roots.map((root: any) => p.graphMethods.getSuccessorSet(root));
      const covered = new Set(trees.flat());
      for (const n of nodes) {
        if (covered.has(n)) continue;
        const branch = p.graphMethods.getSuccessorSet(n);
        trees.push(branch);
        branch.forEach((n: any) => covered.add(n));
      }
      const tree = trees.sort((a: any[], b: any[]) => b.length - a.length)[0];
      expect(tree.length).toBeGreaterThan(10);
      p.stage.forEach((n: any) => (n.isSelected = false));
      tree[0].isSelected = true;
      const scans = vi.spyOn(p.stageManager, "getTreeEdges");
      const durations: number[] = [];
      for (let step = 0; step < 10; step++) {
        const start = performance.now();
        p.entityMoveManager.dragSelection(new Vector(1, 1), true);
        durations.push(performance.now() - start);
      }
      console.log(
        JSON.stringify({ objects: p.stage.length, tree: tree.length, durations, edgeScans: scans.mock.calls.length }),
      );
      expect(scans).toHaveBeenCalledTimes(10);
      vi.restoreAllMocks();
      expect(readFileSync(file)).toEqual(beforeFile);
    },
    60000,
  );
  it("moves a 1000-node cyclic chain once per node even when ancestors and descendants are selected", () => {
    const { p } = fixture();
    settings.isEnableEntityCollision = false;
    const nodes = Array.from(
      { length: 1000 },
      (_, i) =>
        new TextNode(p, {
          text: "node",
          collisionBox: new CollisionBox([new Rectangle(new Vector(i * 500, 0), new Vector(100, 50))]),
        }),
    );
    const edges = nodes.map((n, i) => LineEdge.fromTwoEntity(p, n, nodes[(i + 1) % nodes.length]));
    edges[500].lineType = "dashed";
    p.stage = [...nodes, ...edges];
    nodes[0].isSelected = true;
    nodes[200].isSelected = true;
    settings.isEnableEntityCollision = true;
    const scans = vi.spyOn(p.stageManager, "getTreeEdges");
    const before = nodes.map((n) => n.rectangle.location.clone());
    p.entityMoveManager.dragSelection(new Vector(10, 5), true);
    for (let i = 0; i < nodes.length; i++)
      expect(nodes[i].rectangle.location).toEqual(i <= 500 ? before[i].add(new Vector(10, 5)) : before[i]);
    expect(scans).toHaveBeenCalledTimes(1);
    scans.mockRestore();
  });
  it("pushes an external neighbor after the group reaches its final position and restores it on undo", () => {
    const { p, node } = fixture();
    const a = node(0),
      b = node(0, 200),
      obstacle = node(500);
    p.stage.push(LineEdge.fromTwoEntity(p, a, b));
    a.isSelected = true;
    p.historyManager.recordStep();
    const before = serialize(p.stage);
    p.entityMoveManager.dragSelection(new Vector(500, 0), true);
    expect(overlap(a, obstacle)).toBe(false);
    expect(a.rectangle.location).toEqual(new Vector(500, 0));
    expect(b.rectangle.location).toEqual(new Vector(500, 200));
    p.historyManager.recordStep();
    const after = serialize(p.stage);
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(after);
  });
  it("restores the development session history with working undo and redo", () => {
    const { p, node } = fixture();
    const a = node(0);
    p.historyManager.recordStep();
    const before = serialize(p.stage);
    a.moveTo(new Vector(600, 700));
    p.historyManager.recordStep();
    const after = serialize(p.stage);
    const saved = p.historyManager.developmentSnapshot();
    p.historyManager = new HistoryManager(p);
    p.historyManager.restoreDevelopmentSnapshot(saved);
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(after);
  });
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
  it("moves multiple selected text nodes through an unselected node without moving it", () => {
    const { p, node } = fixture();
    settings.isEnableEntityCollision = true;
    const a = node(0),
      b = node(0, 300),
      obstacle = node(600);
    a.isSelected = b.isSelected = true;
    const initial = obstacle.rectangle.location.clone();
    p.entityMoveManager.beginPointerDrag(a);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(600, 0), false);
    expect(overlap(a, obstacle)).toBe(true);
    expect(obstacle.rectangle.location).toEqual(initial);
    expect(b.rectangle.left).toBeCloseTo(a.rectangle.left);
    p.controller.pressingKeySet.delete("v");
    p.entityMoveManager.dragSelection(new Vector(1, 0), false);
    expect(overlap(a, obstacle)).toBe(false);
    p.entityMoveManager.endPointerDrag();
  });
  it("keeps V collision bypass active between pointer events and restores it immediately on key release or drag end", () => {
    const { p, node } = fixture();
    settings.isEnableEntityCollision = true;
    const dragged = node(0),
      neighbor = node(600);
    dragged.isSelected = true;
    const origin = neighbor.rectangle.location.clone();
    p.entityMoveManager.beginPointerDrag(dragged);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(600, 0), false);
    expect(overlap(dragged, neighbor)).toBe(true);
    dragged.resolveOverlaps();
    expect(overlap(dragged, neighbor)).toBe(true);
    expect(neighbor.rectangle.location).toEqual(origin);
    p.controller.pressingKeySet.delete("v");
    dragged.resolveOverlaps();
    expect(overlap(dragged, neighbor)).toBe(false);
    p.controller.pressingKeySet.add("v");
    expect(p.entityMoveManager.ignoresDragCollisions).toBe(true);
    p.entityMoveManager.endPointerDrag();
    expect(p.entityMoveManager.ignoresDragCollisions).toBe(false);
  });
  it("passes through a neighbor with V and resumes pushing during the same drag when V is released", () => {
    const { p, node } = fixture();
    const dragged = node(0);
    const neighbor = node(600);
    const origin = neighbor.rectangle.location.clone();
    dragged.isSelected = true;
    p.entityMoveManager.beginPointerDrag(dragged);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(600, 0), false);
    expect(overlap(dragged, neighbor)).toBe(true);
    p.entityMoveManager.dragSelection(new Vector(400, 0), false);
    expect(dragged.rectangle.left).toBeGreaterThan(neighbor.rectangle.right);
    expect(neighbor.rectangle.location).toEqual(origin);
    p.controller.pressingKeySet.delete("v");
    p.entityMoveManager.dragSelection(new Vector(-400, 0), false);
    expect(overlap(dragged, neighbor)).toBe(false);
    expect(neighbor.rectangle.location).not.toEqual(origin);
    p.entityMoveManager.endPointerDrag();
  });
  it("applies grid snapping on V-drop without pushing and keeps ordinary moves collidable while V stays down", () => {
    const { p, node } = fixture();
    const dragged = node(0);
    const neighbor = node(600);
    const origin = neighbor.rectangle.location.clone();
    dragged.isSelected = true;
    p.entityMoveManager.beginPointerDrag(dragged);
    p.controller.pressingKeySet.add("v");
    p.entityMoveManager.dragSelection(new Vector(603, 3), false);
    const unsnapped = dragged.rectangle.location.clone();
    const previous = settings.enableDragAlignToGrid;
    settings.enableDragAlignToGrid = true;
    try {
      p.entityMoveManager.alignAfterPointerDrag();
    } finally {
      settings.enableDragAlignToGrid = previous;
    }
    expect(dragged.rectangle.location).not.toEqual(unsnapped);
    expect(overlap(dragged, neighbor)).toBe(true);
    expect(neighbor.rectangle.location).toEqual(origin);
    p.entityMoveManager.endPointerDrag();
    dragged.move(new Vector(1, 0));
    expect(overlap(dragged, neighbor)).toBe(false);
    expect(settings.isEnableEntityCollision).toBe(true);
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

describe("blank right click container gestures", () => {
  function setup() {
    const { p, node } = fixture();
    p.controllerUtils = { getClickedStageObject: (point: Vector) => p.stageManager.findEntityByLocation(point) };
    p.canvas = { viewToClient: (v: Vector) => v };
    p.renderer.transformView2World = (v: Vector) => v;
    p.controller.resetCountdownTimer = vi.fn();
    p.loop = vi.fn();
    const controller = new ControllerContextMenuClass(p);
    const event = (x: number, y = 0) => ({ button: 2, clientX: x, clientY: y }) as MouseEvent;
    const click = (x: number, y = 0) => {
      controller.mousedown(event(x, y));
      controller.mouseup(event(x, y));
    };
    return { p, node, controller, event, click };
  }
  it("suppresses the blank single click and creates one undoable container on double click", () => {
    const { p, click } = setup();
    const record = vi.spyOn(p.historyManager, "recordStep");
    click(1000);
    expect(p.stageManager.getSections()).toHaveLength(0);
    expect(p.emit).not.toHaveBeenCalledWith("contextmenu", expect.anything());
    click(1000);
    const frame = p.stageManager.getSections()[0] as Doodle;
    expect(frame.bounded).toBe(true);
    expect(frame.frame.center).toEqual(new Vector(1000, 0));
    expect(frame.frame.size).toEqual(new Vector(1800, 1200));
    expect(record).toHaveBeenCalledTimes(1);
    p.historyManager.undo();
    expect(p.stageManager.getSections()).toHaveLength(0);
    p.historyManager.redo();
    expect(p.stageManager.getSections()).toHaveLength(1);
  });
  it.each(["rectangle", "circle"] as const)("places the child at the pointer inside a %s parent", (shape) => {
    const { p, click } = setup();
    const parent = new Doodle(p, {
      bounded: true,
      shape,
      frame: new Rectangle(new Vector(0, 0), new Vector(500, 400)),
    });
    p.stageManager.add(parent);
    const original = parent.frame.clone();
    click(240, 190);
    click(240, 190);
    const child = p.stageManager.getSections().find((s: Doodle) => s !== parent) as Doodle;
    expect(child.parentSection).toBe(parent);
    expect(child.frame.center).toEqual(new Vector(240, 190));
    expect(child.frame.width).toBeLessThan(parent.frame.width);
    expect(child.frame.height).toBeLessThan(parent.frame.height);
    expect(parent.frame).toEqual(original);
  });
  it("clamps the enlarged child at the parent's border without expanding its parent", () => {
    const { p, click } = setup();
    const parent = new Doodle(p, {
      bounded: true,
      frame: new Rectangle(new Vector(0, 0), new Vector(1000, 800)),
    });
    p.stageManager.add(parent);
    const original = parent.frame.clone();
    click(20, 20);
    click(20, 20);
    const child = p.stageManager.getSections().find((s: Doodle) => s !== parent) as Doodle;
    expect(child.parentSection).toBe(parent);
    expect(child.frame.size).toEqual(new Vector(600, 480));
    expect(child.frame.left).toBe(8);
    expect(child.frame.top).toBe(8);
    expect(parent.frame).toEqual(original);
  });
  it("does not treat a right-button pan as a blank click", () => {
    const { p, click, controller, event } = setup();
    click(1000);
    controller.mousedown(event(1000));
    controller.mousemove(event(1100));
    controller.mouseup(event(1000));
    expect(p.stageManager.getSections()).toHaveLength(0);
    click(1000);
    expect(p.stageManager.getSections()).toHaveLength(0);
  });
  it("keeps an object's context menu and never creates a frame on its body", () => {
    const { p, node, click } = setup();
    const n = node(0);
    click(n.rectangle.center.x, n.rectangle.center.y);
    click(n.rectangle.center.x, n.rectangle.center.y);
    expect(p.stageManager.getSections()).toHaveLength(0);
    expect(p.emit).toHaveBeenCalledWith("contextmenu", expect.anything());
  });
});
