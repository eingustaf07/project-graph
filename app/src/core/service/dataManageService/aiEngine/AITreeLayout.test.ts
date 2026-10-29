import { describe, expect, it } from "vitest";
import {
  boundsOf,
  findOverlaps,
  parseIndentedTree,
  placeInFreeSpace,
  placeInsideContainer,
  planTreeLayout,
  type LayoutRect,
} from "./AITreeLayout";

const node = (id: string, width = 508, height = 172): LayoutRect => ({ id, x: 0, y: 0, width, height });

describe("AI measured tree layout", () => {
  it("places a tree inside the existing group bounds or rejects without enlarging the group", () => {
    const container = { ...node("group", 1600, 1000), x: 0, y: 0 };
    const obstacle = { ...node("note", 300, 100), x: 30, y: 80 };
    const placed = placeInsideContainer([node("new", 200, 150)], [obstacle], container);
    expect(findOverlaps(placed, [obstacle], 39)).toEqual([]);
    expect(placed[0].x + placed[0].width).toBeLessThanOrEqual(1570);
    expect(() => placeInsideContainer([node("too-wide", 1700, 150)], [], container)).toThrow("空间");
    expect(container.width).toBe(1600);
  });
  it.each(["right", "down"] as const)("centers parents and respects real dimensions in %s layout", (direction) => {
    const result = planTreeLayout(
      [node("root", 200, 75), node("a", 508, 124), node("b", 508, 172)],
      [
        { source: "root", target: "a" },
        { source: "root", target: "b" },
      ],
      { direction, nodeGap: 40 },
    );
    const [root, a, b] = result;
    expect(findOverlaps(result)).toEqual([]);
    if (direction === "right") {
      expect(b.y - (a.y + a.height)).toBe(40);
      expect(root.y + root.height / 2).toBe((a.y + b.y + b.height) / 2);
      expect(a.x - (root.x + root.width)).toBeGreaterThanOrEqual(100);
    } else {
      expect(b.x - (a.x + a.width)).toBe(40);
      expect(root.x + root.width / 2).toBe((a.x + b.x + b.width) / 2);
      expect(a.y - (root.y + root.height)).toBeGreaterThanOrEqual(100);
    }
  });

  it("keeps nested subtree envelopes separate and the parent centered", () => {
    const nodes = [node("root"), node("a"), node("b"), node("c", 508, 600), node("d", 508, 300)];
    const result = planTreeLayout(nodes, [
      { source: "root", target: "a" },
      { source: "root", target: "b" },
      { source: "a", target: "c" },
      { source: "a", target: "d" },
    ]);
    expect(findOverlaps(result, [], 39)).toEqual([]);
    expect(result.map((n) => [n.width, n.height])).toEqual(nodes.map((n) => [n.width, n.height]));
  });

  it("retains shared children as a DAG and arranges disconnected nodes", () => {
    const result = planTreeLayout(
      [node("a"), node("b"), node("c"), node("isolated")],
      [
        { source: "a", target: "c" },
        { source: "b", target: "c" },
      ],
    );
    expect(result).toHaveLength(4);
    expect(findOverlaps(result)).toEqual([]);
  });

  it("handles a deep chain iteratively and rejects cycles", () => {
    const nodes = Array.from({ length: 15000 }, (_, i) => node(String(i), 50, 70));
    const edges = nodes.slice(1).map((n, i) => ({ source: String(i), target: n.id }));
    expect(planTreeLayout(nodes, edges)).toHaveLength(15000);
    expect(() =>
      planTreeLayout(nodes.slice(0, 2), [
        { source: "0", target: "1" },
        { source: "1", target: "0" },
      ]),
    ).toThrow("循环");
  });

  it("places an entire tree beyond a chain of original obstacles without moving them", () => {
    const obstacles = [node("original"), { ...node("other"), x: 568 }];
    const snapshot = structuredClone(obstacles);
    const source = planTreeLayout([node("a"), node("b")], [{ source: "a", target: "b" }]);
    const placed = placeInFreeSpace(source, obstacles, 60);
    expect(findOverlaps(placed, obstacles, 59)).toEqual([]);
    expect(placed[1].x - placed[0].x).toBe(source[1].x - source[0].x);
    expect(obstacles).toEqual(snapshot);
  });

  it("keeps a forest's envelopes apart", () => {
    const result = planTreeLayout(
      [node("a"), node("a1", 508, 600), node("b"), node("b1")],
      [
        { source: "a", target: "a1" },
        { source: "b", target: "b1" },
      ],
      { treeGap: 120 },
    );
    const a = boundsOf(result.slice(0, 2)),
      b = boundsOf(result.slice(2));
    expect(b.y - (a.y + a.height)).toBe(120);
  });

  it("preserves literal order, duplicate labels, multiline content and hierarchy", () => {
    expect(parseIndentedTree("条件\n  同名\n    结果\\n说明\n  同名\n另一棵树")).toEqual([
      { text: "条件", parent: null },
      { text: "同名", parent: 0 },
      { text: "结果\n说明", parent: 1 },
      { text: "同名", parent: 0 },
      { text: "另一棵树", parent: null },
    ]);
    expect(() => parseIndentedTree("root\n    skipped")).toThrow("父级");
    expect(() => parseIndentedTree("root\n odd")).toThrow("两个空格");
    expect(parseIndentedTree(" \n\n")).toEqual([]);
  });

  it("does not overlap across varied measured sizes and both directions", () => {
    let seed = 29;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (const direction of ["right", "down"] as const)
      for (let trial = 0; trial < 40; trial++) {
        const nodes = Array.from({ length: 60 }, (_, i) => node(String(i), 50 + random() * 458, 65 + random() * 500));
        const edges = nodes.slice(1).map((n, i) => ({ source: String(Math.floor(random() * (i + 1))), target: n.id }));
        expect(findOverlaps(planTreeLayout(nodes, edges, { direction }))).toEqual([]);
      }
  });
});
