vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
import { describe, it, expect, vi } from "vitest";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { gridLocations } from "./creationGrid";
describe("nearest corner grid alignment", () => {
  it.each([
    [48, 48, 52, 52, 48, 48],
    [48, 48, 51, 20, 49, 50],
    [48, 48, 20, 51, 50, 49],
    [48, 48, 51, 51, 49, 49],
    [-52, -52, 51, 51, -51, -51],
  ])("aligns the closest corner for (%s,%s,%s,%s)", (x, y, w, h, expectedX, expectedY) => {
    expect(gridLocations([new Rectangle(new Vector(x, y), new Vector(w, h))], 50)[0]).toEqual(
      new Vector(expectedX, expectedY),
    );
  });
  it("retains shared layer alignment and leaves originally separate branches disjoint", () => {
    const rects = [
      new Rectangle(new Vector(48, 48), new Vector(51, 51)),
      new Rectangle(new Vector(48, 105), new Vector(20, 51)),
    ];
    const locations = gridLocations(rects, 50);
    expect(locations[0].x).toBe(locations[1].x);
    expect(locations[0].y + 51).toBeLessThan(locations[1].y);
  });
});
