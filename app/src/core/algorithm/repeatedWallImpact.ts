import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { doodleContentPadding } from "./doodleBounds";

type Side = "left" | "right" | "top" | "bottom";

/** One press-and-drag gesture, measured at the moving node's padded boundary. */
export class RepeatedWallImpact {
  private last?: { side: Side; count: number; time: number; touching: boolean };

  reset() {
    this.last = undefined;
  }

  advance(frame: Rectangle, candidate: Rectangle, delta: Vector, scale: number, now: number): Rectangle | undefined {
    const gaps = {
      left: candidate.left - frame.left - doodleContentPadding,
      right: frame.right - candidate.right - doodleContentPadding,
      top: candidate.top - frame.top - doodleContentPadding,
      bottom: frame.bottom - candidate.bottom - doodleContentPadding,
    };
    const previous = this.last;
    const outward = { left: -delta.x, right: delta.x, top: -delta.y, bottom: delta.y };
    if (previous && outward[previous.side] < 0 && gaps[previous.side] * scale >= 6) previous.touching = false;
    const contacts = (Object.keys(gaps) as Side[]).filter((side) => gaps[side] <= 0 && outward[side] > 0);
    if (!contacts.length) return;
    if (contacts.length !== 1) {
      this.reset();
      return;
    }
    const side = contacts[0];
    if (previous?.side === side && previous.touching) return;
    const count = previous?.side === side && now - previous.time <= 900 ? previous.count + 1 : 1;
    this.last = { side, count: count === 3 ? 0 : count, time: now, touching: true };
    if (count !== 3) return;
    const step = 32;
    return Rectangle.fromEdges(
      frame.left - (side === "left" ? step : 0),
      frame.top - (side === "top" ? step : 0),
      frame.right + (side === "right" ? step : 0),
      frame.bottom + (side === "bottom" ? step : 0),
    );
  }
}
