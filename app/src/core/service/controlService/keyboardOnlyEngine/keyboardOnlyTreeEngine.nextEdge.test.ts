import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() =>
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ font: "", measureText: (text: string) => ({ width: text.length * 32 }) }),
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
    historyManagerMode: "memoryEfficient",
    historySize: 100,
    watch: () => () => {},
    defaultEdgeArrowType: "default",
    defaultEdgeLineType: "straight",
    enableTreeGenerateConnectByProbe: false,
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: {
    play: {
      associationAdjustSoundFile: vi.fn(),
      treeGenerateDeepSoundFile: vi.fn(),
      treeGenerateBroadSoundFile: vi.fn(),
    },
  },
}));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { ArcEdge } from "@/core/stage/stageObject/association/ArcEdge";
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { NodeConnector } from "@/core/stage/stageManager/concreteMethods/StageNodeConnector";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { KeyboardOnlyTreeEngine } from "./keyboardOnlyTreeEngine";
import { getMultiLineTextSize } from "@/utils/font";
import { serialize } from "@graphif/serializer";
import { deserialize } from "@graphif/serializer";
import { readFile, writeFile } from "node:fs/promises";
import { Decoder } from "@msgpack/msgpack";
import { parseProjectFile } from "@/core/ProjectFile";
import { GraphMethods } from "@/core/stage/stageManager/basicMethods/GraphMethods";
import { AutoLayoutFastTree } from "@/core/service/controlService/autoLayoutEngine/autoLayoutFastTreeMode";
import { SectionInOutManager } from "@/core/stage/stageManager/concreteMethods/StageSectionInOutManager";
import { EntityMoveManager } from "@/core/stage/stageManager/concreteMethods/StageEntityMoveManager";
import { Settings } from "@/core/service/Settings";

function fixture() {
  const p: any = {
    stage: [],
    emit: vi.fn(),
    camera: { clearMoveCommander: vi.fn() },
    keyboardOnlyEngine: { isOpenning: () => true },
    controllerUtils: { editTextNode: vi.fn() },
    stageUtils: { replaceAutoNameTemplate: () => "新节点" },
    effects: { addEffects: vi.fn(), addEffect: vi.fn() },
    syncAssociationManager: { syncFrom: vi.fn() },
    edgeRenderer: { getConnectedEffects: () => [] },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
  };
  p.stageManager = new StageManager(p);
  p.sectionMethods = new SectionMethods(p);
  p.nodeConnector = new NodeConnector(p);
  const root = new TextNode(p, { text: "原节点" });
  p.stageManager.add(root);
  root.isSelected = true;
  p.graphMethods = {
    getOneStepSuccessorSet: () => [],
    getOutgoingEdges: () => [],
    getHyperEdgesByNode: () => [],
    getEdgesBetween: (a: TextNode, b: TextNode) =>
      p.stage.filter((e: unknown) => e instanceof LineEdge && e.source === a && e.target === b),
    getRoots: () => [root],
    validateTreeStructure: () => ({ isValid: true }),
    isConnected: () => true,
  };
  p.historyManager = new HistoryManager(p);
  const engine = new KeyboardOnlyTreeEngine(p);
  vi.spyOn(engine as any, "getNodePreDirection").mockReturnValue("right");
  const select = (id: string) => {
    p.stageManager.clearSelectAll();
    p.stageManager.get(id).isSelected = true;
  };
  return { p, root, engine, select };
}
beforeEach(() => {
  vi.useFakeTimers();
  Settings.autoLayoutWhenTreeGenerate = false;
  Settings.isEnableEntityCollision = false;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.skipIf(!process.env.PG_NN_READ_FILE)(
  "profiles NN with the user's file in memory only",
  async () => {
    vi.useRealTimers();
    const bytes = await readFile(process.env.PG_NN_READ_FILE!);
    const parsed = await parseProjectFile(new Uint8Array(bytes), new Decoder(), new Map());
    const { p, engine } = fixture();
    p.stage = deserialize(parsed.serializedStageObjects, p);
    p.stageManager.updateReferences();
    p.graphMethods = new GraphMethods(p);
    const nodes = p.stageManager.getTextNodes();
    vi.mocked(engine.getNodePreDirection).mockRestore();
    const candidate = process.env.PG_NN_NODE
      ? nodes.find((node: TextNode) => node.text === process.env.PG_NN_NODE)
      : [...nodes].sort(
          (a: TextNode, b: TextNode) =>
            p.graphMethods.getSuccessorSet(b, true, true).length - p.graphMethods.getSuccessorSet(a, true, true).length,
        )[0];
    expect(candidate).toBeDefined();
    p.stageManager.clearSelectAll();
    candidate.isSelected = true;
    const start = performance.now();
    const roots = p.graphMethods.getRoots(candidate, true);
    const validation = p.graphMethods.validateTreeStructure(roots[0], true);
    const report = {
      objects: p.stage.length,
      nodes: nodes.length,
      validationMs: performance.now() - start,
      valid: validation.isValid,
      issues: validation.issues.length,
      issueTypes: validation.issues.map((issue: { type: string }) => issue.type),
    };
    p.controller = { pressingKeySet: new Set() };
    p.controllerUtils = { editTextNode: vi.fn() };
    p.sectionInOutManager = new SectionInOutManager(p);
    p.entityMoveManager = new EntityMoveManager(p);
    p.sectionCollisionSolver = { solveOverlaps: vi.fn() };
    p.autoLayoutFastTree = new AutoLayoutFastTree(p);
    p.autoAlign = {
      autoLayoutSelectedFastTreeMode: (root: TextNode, afterGrowth = false) =>
        p.autoLayoutFastTree.autoLayoutFastTreeMode(root, afterGrowth),
    };
    Settings.autoLayoutWhenTreeGenerate = true;
    Settings.isEnableEntityCollision = process.env.PG_NN_COLLISION === "1";
    if (process.env.PG_GRID_GAP) {
      Settings.snapNewNodesToGrid = true;
      Settings.showBackgroundHorizontalLines = true;
      Settings.showBackgroundVerticalLines = true;
      p.backgroundRenderer = { getCurrentGap: () => Number(process.env.PG_GRID_GAP) };
    }
    if (process.env.PG_ARC_TEST) {
      const incoming = p.stageManager.getArcEdges().find((e: any) => e.target === candidate);
      const outgoing = p.stageManager.getArcEdges().find((e: any) => e.source === candidate);
      expect(incoming).toBeDefined();
      expect(outgoing).toBeDefined();
      const broad = process.env.PG_ARC_TEST === "TT";
      if (broad) engine.onBroadGenerateNode();
      else engine.onDeepGenerateNode();
      const created = p.stageManager.getTextNodes().find((n: TextNode) => !nodes.includes(n));
      expect(created).toBeDefined();
      const parent = broad ? incoming.source : candidate;
      const sibling = broad ? candidate : outgoing.target;
      expect(p.graphMethods.getEdgesBetween(parent, created)).toHaveLength(1);
      expect(created.rectangle.isCollideWith(sibling.rectangle)).toBe(false);
      expect(created.rectangle.left).toBeCloseTo(sibling.rectangle.left, 4);
      if (process.env.PG_GRID_GAP) {
        for (const node of [created, sibling, parent]) {
          for (const value of [node.rectangle.left, node.rectangle.top]) {
            expect(value / Number(process.env.PG_GRID_GAP)).toBe(Math.round(value / Number(process.env.PG_GRID_GAP)));
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      expect(p.controllerUtils.editTextNode).toHaveBeenCalledTimes(1);
      return;
    }
    const nnStart = performance.now();
    let failure: string | undefined;
    try {
      engine.onDeepGenerateNode();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    Object.assign(report, { nnMs: performance.now() - nnStart, failure });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(failure).toBeUndefined();
    expect(p.controllerUtils.editTextNode).toHaveBeenCalledTimes(1);

    if (Settings.isEnableEntityCollision) {
      const created = p.stageManager.getTextNodes().find((n: TextNode) => !nodes.includes(n));
      expect(created).toBeDefined();
      expect(nodes.filter((n: TextNode) => created.rectangle.isCollideWith(n.rectangle))).toHaveLength(0);
      const dropAt = candidate.rectangle.location.clone();
      const dragStart = performance.now();
      p.entityMoveManager.moveEntityToUtils(created, dropAt);
      Object.assign(report, { dragMs: performance.now() - dragStart });
      expect(created.rectangle.location).toEqual(dropAt);
      expect(created.rectangle.isCollideWith(candidate.rectangle)).toBe(false);
    }
    if (process.env.PG_NN_REPORT) await writeFile(process.env.PG_NN_REPORT, JSON.stringify(report));
    expect(bytes.length).toBeGreaterThan(0);
  },
  60000,
);

it("grows and requests editing once when two opposite arcs connect the parent to another node", () => {
  const { p, engine, root } = fixture();
  p.graphMethods = new GraphMethods(p);
  p.entityMoveManager = new EntityMoveManager(p);
  p.controller = { pressingKeySet: new Set() };
  p.sectionCollisionSolver = { solveOverlaps: vi.fn() };
  p.autoLayoutFastTree = new AutoLayoutFastTree(p);
  Settings.autoLayoutWhenTreeGenerate = true;
  const other = new TextNode(p, { text: "关联节点" });
  p.stageManager.add(other);
  for (const pair of [
    [root, other],
    [other, root],
  ]) {
    p.stageManager.add(new ArcEdge(p, { associationList: pair }));
  }
  const originalPosition = other.collisionBox.getRectangle().leftTop.clone();
  engine.onDeepGenerateNode();
  vi.advanceTimersByTime(0);
  const created = p.stageManager.getTextNodes().find((node: TextNode) => node.text === "新节点");
  expect(created).toBeDefined();
  expect(p.stageManager.getArcEdges()).toHaveLength(2);
  expect(other.collisionBox.getRectangle().leftTop).toEqual(originalPosition);
  expect(p.controllerUtils.editTextNode).toHaveBeenCalledExactlyOnceWith(created, true);
});

it("opens the new node editor on the next event turn without scanning the tree when layout is off", () => {
  const { p, engine } = fixture();
  p.graphMethods.getRoots = vi.fn(() => {
    throw new Error("unnecessary tree scan");
  });
  engine.onDeepGenerateNode();
  const created = p.stageManager.getTextNodes().find((n: TextNode) => n.text === "新节点");
  expect(created.isSelected).toBe(true);
  vi.advanceTimersByTime(0);
  expect(p.controllerUtils.editTextNode).toHaveBeenCalledWith(created, true);
  expect(p.graphMethods.getRoots).not.toHaveBeenCalled();
});
it("still starts editing if automatic layout fails after creation", () => {
  const { p, engine } = fixture();
  Settings.autoLayoutWhenTreeGenerate = true;
  p.autoLayoutFastTree = {
    autoLayoutFastTreeMode: () => {
      throw new Error("layout failed");
    },
  };
  expect(() => engine.onDeepGenerateNode()).toThrow("layout failed");
  vi.advanceTimersByTime(0);
  expect(p.controllerUtils.editTextNode).toHaveBeenCalledTimes(1);
});
it.each(["reverse", "undirected"] as const)(
  "applies and consumes %s even when layout fails after connection",
  (mode) => {
    const { p, root, engine, select } = fixture();
    Settings.autoLayoutWhenTreeGenerate = true;
    p.autoLayoutFastTree = {
      autoLayoutFastTreeMode: () => {
        throw new Error("layout failed");
      },
    };
    engine.armNextGrowthEdge(mode);
    expect(() => engine.onDeepGenerateNode()).toThrow("layout failed");
    if (mode === "reverse") expect(p.stageManager.getLineEdges()[0].target).toBe(root);
    else expect(p.stage.some((edge: unknown) => edge instanceof MultiTargetUndirectedEdge)).toBe(true);
    Settings.autoLayoutWhenTreeGenerate = false;
    select(root.uuid);
    engine.onDeepGenerateNode();
    expect(p.stageManager.getLineEdges().at(-1).source).toBe(root);
  },
);
it("reverses only one newly grown edge and restores the normal direction on the next growth", () => {
  const { p, root, engine, select } = fixture();
  engine.armNextGrowthEdge("reverse");
  engine.onDeepGenerateNode();
  const edge = p.stageManager.getLineEdges()[0];
  expect(edge.target).toBe(root);
  expect(edge.source.text).toBe("新节点");
  expect(edge.sourceRectangleRate.x).toBe(0.01);
  expect(edge.targetRectangleRate.x).toBe(0.99);
  select(root.uuid);
  engine.onDeepGenerateNode();
  const edges = p.stageManager.getLineEdges();
  expect(edges).toHaveLength(2);
  expect(edges[0].target).toBe(root);
  expect(edges[1].source).toBe(root);
});

it.each(["reverse", "undirected"] as const)(
  "preserves a single undo/redo step and normal subsequent growth for %s",
  (mode) => {
    const { p, root, engine, select } = fixture();
    const before = serialize(p.stage);
    engine.armNextGrowthEdge(mode);
    engine.onDeepGenerateNode();
    if (mode === "undirected") {
      const edge = p.stage.find((object: unknown) => object instanceof MultiTargetUndirectedEdge);
      expect(edge.arrow).toBe("none");
      expect(edge.associationList).toContain(root);
      expect(p.stageManager.getLineEdges()).toHaveLength(0);
    } else {
      expect(p.stageManager.getLineEdges()[0].target).toBe(root);
    }
    const after = serialize(p.stage);
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(after);
    select(root.uuid);
    engine.onDeepGenerateNode();
    expect(p.stageManager.getLineEdges().at(-1).source.uuid).toBe(root.uuid);
  },
);

it("keeps the pending rule on its original node and lets the last chosen mode win", () => {
  const { p, root, engine, select } = fixture();
  const other = new TextNode(p, { text: "其他节点" });
  p.stageManager.add(other);
  engine.armNextGrowthEdge("reverse");
  engine.armNextGrowthEdge("undirected");
  select(other.uuid);
  engine.onDeepGenerateNode();
  expect(p.stageManager.getLineEdges()[0].source).toBe(other);
  select(root.uuid);
  engine.onDeepGenerateNode();
  expect(p.stage.filter((object: unknown) => object instanceof MultiTargetUndirectedEdge)).toHaveLength(1);
});
