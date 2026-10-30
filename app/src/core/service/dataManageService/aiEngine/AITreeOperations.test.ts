import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        font: "",
        measureText: (text: string) => ({ width: Array.from(text).length * 100 }),
      }),
    }),
  });
});
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    textNodeMaxCharWidth: 15,
    defaultFontFamily: "sans-serif",
    isEnableEntityCollision: true,
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({
  ConnectableEntity: class {
    parentSection = null;
    constrainToFixedBoundary() {}
    updateFatherSectionByMove() {}
    updateOtherEntityLocationByMove() {
      throw new Error("live collision side effect");
    }
  },
}));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/stage/stageObject/entity/ImageNode", () => ({ ImageNode: class {} }));
vi.mock("@/core/stage/stageObject/association/Edge", () => ({ Edge: class {} }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({
  DetailsManager: class {
    static markdownToDetails() {
      return [];
    }
  },
}));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/NodeMoveShadowEffect", () => ({
  NodeMoveShadowEffect: class {},
}));
vi.mock("@/core/stage/stageObject/association/LineEdge", () => ({
  LineEdge: class {
    uuid = crypto.randomUUID();
    source: unknown;
    target: unknown;
    sourceRectangleRate: unknown;
    targetRectangleRate: unknown;
    constructor(_project: unknown, options: any) {
      [this.source, this.target] = options.associationList;
      this.sourceRectangleRate = options.sourceRectangleRate;
      this.targetRectangleRate = options.targetRectangleRate;
    }
  },
}));

import { Settings } from "@/core/service/Settings";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { Rectangle } from "@graphif/shapes";
import { Vector, Color } from "@graphif/data-structures";
import { AIObjectReferenceRegistry } from "./AIObjectReferenceRegistry";
import { generateAITree, layoutAINodes, limitAITextWidth, moveAINodes, objectRect } from "./AITreeOperations";
import { createBuiltInToolAgentTools } from "./BuiltInToolAgentAdapter";
import { findOverlaps } from "./AITreeLayout";
import { getMultiLineTextSize } from "@/utils/font";

function fixture() {
  const project: any = {
    stage: [],
    camera: { location: new Vector(0, 0) },
    syncAssociationManager: { syncFrom: vi.fn() },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
    historyManager: { recordStep: vi.fn() },
  };
  project.stageManager = {
    get: (uuid: string) => project.stage.find((node: any) => node.uuid === uuid),
    getEntities: () => project.stage.filter((node: any) => node instanceof TextNode || node instanceof Section),
    getEdges: () => project.stage.filter((node: any) => node instanceof LineEdge),
    add: vi.fn((node: any) => project.stage.push(node)),
    updateReferences: vi.fn(() => {
      for (const node of project.stage)
        if (node instanceof Section) {
          for (const child of node.children) child.parentSection = node;
        }
    }),
  };
  return { project, references: new AIObjectReferenceRegistry(project) };
}

describe("AI tree operations using real text measurements", () => {
  it("caps manual AI widths and lays out the new wrapped height instead of widening text", () => {
    const { project } = fixture();
    const a = new TextNode(project, {
      text: "中".repeat(90),
      sizeAdjust: "manual",
      collisionBox: new CollisionBox([new Rectangle(Vector.getZero(), new Vector(1800, 70))]),
    });
    limitAITextWidth(a);
    const b = new TextNode(project, { text: "后续" });
    project.stage.push(a, b);
    layoutAINodes(project, [a, b]);
    expect(a.rectangle.width).toBe(508);
    expect(a.rectangle.height).toBeGreaterThan(172);
    expect(findOverlaps(project.stage.map(objectRect))).toEqual([]);
  });

  it("keeps group membership and original group size when expanding inside available space", () => {
    const { project, references } = fixture();
    const root = new TextNode(project, { text: "框内根" });
    root.collisionBox.updateShapeList([new Rectangle(new Vector(100, 400), root.rectangle.size)]);
    const section = Object.assign(Object.create(Section.prototype), {
      uuid: "group",
      children: [root],
      parentSection: null,
      collisionBox: new CollisionBox([new Rectangle(Vector.getZero(), new Vector(2000, 2000))]),
    });
    (root as any).parentSection = section;
    project.stage.push(section, root);
    const before = objectRect(section);
    const result = generateAITree(project, "子甲\n子乙", references, {}, root);
    expect(result.nodeCount).toBe(2);
    expect(section.children).toHaveLength(3);
    expect(objectRect(section)).toEqual(before);
    expect(
      findOverlaps(
        project.stageManager
          .getEntities()
          .filter((n: any) => n !== section)
          .map(objectRect),
      ),
    ).toEqual([]);
    section.locked = true;
    expect(() => generateAITree(project, "不可更改", references, {}, root)).toThrow("锁定");
    expect(() => moveAINodes(project, [section], { x: 5000, y: 0 }, true)).toThrow("锁定");
  });
  it.each(["right", "down"] as const)(
    "creates non-overlapping long-text trees in %s direction without changing settings or the original",
    (direction) => {
      const { project, references } = fixture();
      const original = new TextNode(project, { text: "原图", color: new Color(255, 0, 0, 1) });
      project.stage.push(original);
      const before = objectRect(original);
      const originalSettings = { ...Settings };
      const text = "逻辑根\n  " + "中".repeat(60) + "\n  " + "文".repeat(100);
      const result = generateAITree(project, text, references, { direction });
      expect(result.nodeCount).toBe(3);
      expect(result.nodes[0].text).toBe("逻辑根");
      expect(result.nodes[1].parentRef).toBe(result.nodes[0].ref);
      const nodes = project.stageManager.getEntities();
      expect(nodes.every((node: TextNode) => node.rectangle.width <= 508)).toBe(true);
      expect(result.nodes[2].height).toBeGreaterThan(172);
      expect(findOverlaps(nodes.map(objectRect))).toEqual([]);
      expect(objectRect(original)).toEqual(before);
      expect(original.color.toArray()).toEqual([255, 0, 0, 1]);
      expect(Settings).toEqual(originalSettings);
      expect(project.historyManager.recordStep).toHaveBeenCalledOnce();
      generateAITree(project, text, references, { direction });
      expect(findOverlaps(project.stageManager.getEntities().map(objectRect))).toEqual([]);
    },
  );

  it("rolls back the complete generated batch and references after a commit-stage failure", () => {
    const { project, references } = fixture();
    const old = new TextNode(project, { text: "保留" });
    project.stage.push(old);
    references.getOrCreateRef(old);
    const snapshot = references.exportSnapshot();
    project.stageManager.add
      .mockImplementationOnce((node: any) => project.stage.push(node))
      .mockImplementationOnce(() => {
        throw new Error("injected add failure");
      });
    expect(() => generateAITree(project, "根\n  子", references)).toThrow("injected");
    expect(project.stage).toEqual([old]);
    expect(references.exportSnapshot()).toEqual(snapshot);
    expect(project.historyManager.recordStep).not.toHaveBeenCalled();
  });

  it("rejects invalid indentation before mutating the canvas", () => {
    const { project, references } = fixture();
    expect(() => generateAITree(project, "root\n    bad", references)).toThrow("父级");
    expect(project.stage).toEqual([]);
    expect(project.historyManager.recordStep).not.toHaveBeenCalled();
  });

  it.each(["breadth_expand_node", "depth_expand_node"])(
    "preserves multiline, whitespace, empty and literal backslash text through %s",
    async (name) => {
      const { project, references } = fixture();
      const root = new TextNode(project, { text: "根" });
      project.stage.push(root);
      const tools = createBuiltInToolAgentTools(project, references) as any;
      const texts = ["  原文空格\n下一行", String.raw`C:\new\notes`, ""];
      await tools[name].execute({ ref: references.getOrCreateRef(root), texts });
      expect(
        project.stageManager
          .getEntities()
          .slice(1)
          .map((n: TextNode) => n.text),
      ).toEqual(texts);
      expect(findOverlaps(project.stageManager.getEntities().map(objectRect))).toEqual([]);
    },
  );

  it("does not report containing groups as overlaps", async () => {
    const { project, references } = fixture();
    const child = new TextNode(project, { text: "框内" });
    const section = Object.assign(Object.create(Section.prototype), {
      uuid: "group",
      children: [child],
      parentSection: null,
      collisionBox: new CollisionBox([new Rectangle(new Vector(-30, -80), new Vector(1000, 1000))]),
    });
    (child as any).parentSection = section;
    project.stage.push(section, child);
    const tools = createBuiltInToolAgentTools(project, references) as any;
    expect(await tools.check_node_overlaps.execute({})).toContain("overlapCount: 0");
  });

  it("passes the actual reference registry through the live Agent tool and can switch directions", async () => {
    const { project, references } = fixture();
    const tools = createBuiltInToolAgentTools(project, references) as any;
    await tools.generate_node_tree_by_text.execute({ text: "根\n  子甲\n  子乙" });
    const nodes = project.stageManager.getEntities();
    const edges = project.stageManager.getEdges();
    const refs = nodes.map((n: TextNode) => references.getOrCreateRef(n));
    await tools.auto_layout_dag.execute({ refs, direction: "down" });
    expect(edges[0].sourceRectangleRate).toEqual(new Vector(0.5, 1));
    expect(findOverlaps(nodes.map(objectRect))).toEqual([]);
    expect(nodes[1].rectangle.location.y).not.toBe(nodes[0].rectangle.location.y);
  });

  it("expands from an existing node while keeping every original node fixed", () => {
    const { project, references } = fixture();
    const root = new TextNode(project, { text: "已存在的根" });
    const other = new TextNode(project, { text: "障碍" });
    project.stage.push(root, other);
    const before = project.stage.map(objectRect);
    const result = generateAITree(project, "条件\n  结果\n另一条件", references, {}, root);
    expect(result.nodeCount).toBe(3);
    expect(project.stage.slice(0, 2).map(objectRect)).toEqual(before);
    expect(result.nodes[0].parentRef).toBe(references.getOrCreateRef(root));
    expect(findOverlaps(result.nodes, before)).toEqual([]);
  });

  it("keeps downwards expansion centered on its existing root when avoiding an obstacle", () => {
    const { project, references } = fixture();
    const root = new TextNode(project, { text: "根" });
    const obstacle = new TextNode(project, { text: "下方原图" });
    obstacle.collisionBox.updateShapeList([new Rectangle(new Vector(-200, 180), new Vector(600, 180))]);
    project.stage.push(root, obstacle);
    const result = generateAITree(project, "子甲\n子乙", references, { direction: "down" }, root);
    const left = Math.min(...result.nodes.map((n) => n.x));
    const right = Math.max(...result.nodes.map((n) => n.x + n.width));
    expect((left + right) / 2).toBe(root.rectangle.center.x);
    expect(findOverlaps(result.nodes, [objectRect(root), objectRect(obstacle)])).toEqual([]);
  });

  it("reflows selected nodes after wrapping without moving the original obstacle", () => {
    const { project } = fixture();
    const a = new TextNode(project, { text: "中".repeat(100) });
    const b = new TextNode(project, { text: "文".repeat(70) });
    const other = new TextNode(project, { text: "原图" });
    project.stage.push(a, b, other);
    const before = objectRect(other);
    layoutAINodes(project, [a, b], { nodeGap: 60 });
    expect(findOverlaps(project.stage.map(objectRect))).toEqual([]);
    expect(objectRect(other)).toEqual(before);
  });

  it("rolls back layout geometry on a history failure and never invokes collision movement", () => {
    const { project } = fixture();
    const a = new TextNode(project, { text: "一" });
    const b = new TextNode(project, { text: "二" });
    project.stage.push(a, b);
    const before = project.stage.map(objectRect);
    project.historyManager.recordStep.mockImplementation(() => {
      throw new Error("history failed");
    });
    expect(() => layoutAINodes(project, [a, b])).toThrow("history failed");
    expect(project.stage.map(objectRect)).toEqual(before);
  });

  it("moves sections with their members, preserves their internal offsets, and rejects collisions", () => {
    const { project } = fixture();
    const child = new TextNode(project, { text: "内容" });
    const section = Object.assign(Object.create(Section.prototype), {
      uuid: "section",
      children: [child],
      parentSection: null,
      collisionBox: new CollisionBox([new Rectangle(new Vector(-10, -10), new Vector(200, 200))]),
    });
    (child as any).parentSection = section;
    project.stage.push(section, child);
    const old = objectRect(child);
    moveAINodes(project, [section as never], { x: 1000, y: 100 }, true);
    expect(objectRect(child).x).toBe(old.x + 1000);
    const obstacle = new TextNode(project, { text: "不可覆盖" });
    project.stage.push(obstacle);
    const before = objectRect(section as never);
    expect(() => moveAINodes(project, [section as never], { x: 0, y: 0 }, false)).toThrow("覆盖");
    expect(objectRect(section as never)).toEqual(before);
  });
});
