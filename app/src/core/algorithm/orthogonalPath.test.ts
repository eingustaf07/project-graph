import { describe, it, expect } from "vitest";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { orthogonalPath, crossesRectangle } from "./orthogonalPath";

describe("orthogonal paths around measured node boxes", () => {
  it.each([
    [0, 64],
    [64, 0],
    [0, -64],
    [-64, 0],
  ])("does not backtrack for a short gap %s,%s", (x, y) => {
    const a = new Vector(0, 0),
      b = new Vector(x, y);
    const points = orthogonalPath(a, b, []);
    expect(points).toEqual([a, b]);
  });
  it("avoids an intermediate node and keeps every segment axis-aligned", () => {
    const obstacle = new Rectangle(new Vector(-60, 30), new Vector(120, 90));
    const points = orthogonalPath(new Vector(0, 0), new Vector(0, 180), [obstacle]);
    expect(points.length).toBeGreaterThan(2);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
      expect(crossesRectangle(points[i - 1], points[i], obstacle)).toBe(false);
    }
  });
  it("finds a path through a staggered corridor and is deterministic", () => {
    const obstacles = [
      new Rectangle(new Vector(-80, 30), new Vector(160, 40)),
      new Rectangle(new Vector(-150, 90), new Vector(180, 40)),
      new Rectangle(new Vector(0, 150), new Vector(180, 40)),
    ];
    const start = new Vector(0, 0),
      end = new Vector(0, 240);
    const path = orthogonalPath(start, end, obstacles);
    expect(path.length).toBeGreaterThan(2);
    expect(orthogonalPath(start, end, obstacles)).toEqual(path);
    expect(path.slice(1).every((p, i) => obstacles.every((r) => !crossesRectangle(path[i], p, r)))).toBe(true);
  });
});
