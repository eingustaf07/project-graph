import { describe, expect, it } from "vitest";
import { collectConnectedNodeIds } from "./connectedNodeHighlight";

const edge = (...ids: string[]) => ids.map((uuid) => ({ uuid }));

describe("connected node highlighting", () => {
  it("includes the root, parents, siblings and indirect descendants regardless of arrow direction", () => {
    const result = collectConnectedNodeIds(
      ["a", "b", "c", "d", "other"],
      [edge("b", "a"), edge("b", "c"), edge("c", "d")],
      ["a"],
    );
    expect([...result].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("supports hyperedges, duplicate members, self-loops and cycles", () => {
    expect(
      [
        ...collectConnectedNodeIds(
          ["a", "b", "c", "d"],
          [edge("a", "b", "c", "a"), edge("c", "d"), edge("d", "a"), edge("a", "a")],
          ["b"],
        ),
      ].sort(),
    ).toEqual(["a", "b", "c", "d"]);
  });
  it("handles multiple seeds, isolated nodes and dangling references", () => {
    expect([...collectConnectedNodeIds(["a", "b", "c"], [edge("a", "b", "missing")], ["a", "c"])].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect([...collectConnectedNodeIds(["alone"], [], ["alone"])]).toEqual(["alone"]);
    expect([...collectConnectedNodeIds(["a"], [], ["missing"])]).toEqual([]);
  });
  it("traverses a large component iteratively without a call-stack overflow", () => {
    const nodes = Array.from({ length: 20000 }, (_, i) => String(i));
    const associations = nodes.slice(1).map((id, i) => edge(String(i), id));
    expect(collectConnectedNodeIds(nodes, associations, ["19999"]).size).toBe(20000);
  });
});
