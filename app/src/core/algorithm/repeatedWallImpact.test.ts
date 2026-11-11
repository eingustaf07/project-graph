import { expect, it } from "vitest";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { RepeatedWallImpact } from "./repeatedWallImpact";

const frame = Rectangle.fromEdges(0, 0, 200, 200);
it.each(["left", "right", "top", "bottom"] as const)(
  "only expands the %s side after three distinct impacts",
  (side) => {
    const gesture = new RepeatedWallImpact();
    const dir = new Vector(
      Number(side === "right") - Number(side === "left"),
      Number(side === "bottom") - Number(side === "top"),
    );
    const advance = (distance: number, motion: number, t: number) =>
      gesture.advance(
        frame,
        new Rectangle(new Vector(90, 90).add(dir.multiply(distance)), Vector.same(20)),
        dir.multiply(motion),
        1,
        t,
      );
    expect(advance(82, 10, 0)).toBeUndefined();
    expect(advance(90, 8, 20)).toBeUndefined();
    expect(advance(80, -2, 40)).toBeUndefined();
    expect(advance(82, 2, 60)).toBeUndefined();
    expect(advance(70, -12, 80)).toBeUndefined();
    expect(advance(82, 12, 100)).toBeUndefined();
    expect(advance(70, -12, 120)).toBeUndefined();
    const grown = advance(82, 12, 140)!;
    expect(grown).toEqual(
      Rectangle.fromEdges(
        side === "left" ? -32 : 0,
        side === "top" ? -32 : 0,
        side === "right" ? 232 : 200,
        side === "bottom" ? 232 : 200,
      ),
    );
  },
);

it("resets on another side, an ambiguous corner, or a pause and measures retreat in screen pixels", () => {
  const gesture = new RepeatedWallImpact();
  const hit = (x: number, y: number, dx: number, dy: number, time: number) =>
    gesture.advance(frame, new Rectangle(new Vector(x, y), Vector.same(20)), new Vector(dx, dy), 0.5, time);
  for (const [x, y, dx, dy, t] of [
    [172, 90, 1, 0, 0],
    [164, 90, -8, 0, 50],
    [172, 90, 8, 0, 100],
    [150, 90, -22, 0, 150],
    [172, 90, 22, 0, 200],
    [150, 90, -22, 0, 250],
    [172, 172, 22, 82, 300],
    [150, 90, -22, -82, 350],
    [172, 90, 22, 0, 400],
    [150, 90, -22, 0, 450],
    [172, 90, 22, 0, 500],
    [8, 90, -164, 0, 550],
    [172, 90, 164, 0, 600],
    [150, 90, -22, 0, 650],
    [172, 90, 22, 0, 700],
    [150, 90, -22, 0, 750],
    [172, 90, 22, 0, 1800],
  ])
    expect(hit(x, y, dx, dy, t)).toBeUndefined();
});
