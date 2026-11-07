import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

// Each obstacle forbids an open interval of translations on a given axis.
// Only the connected interval containing zero needs to be cleared.
export function nearestFreeTranslation(box: Rectangle, obstacles: Rectangle[], fits: (box: Rectangle) => boolean) {
  const candidates: Vector[] = [];
  for (const horizontal of [false, true]) {
    const intervals: [number, number][] = [];
    for (const wall of obstacles) {
      if (
        horizontal ? box.top >= wall.bottom || box.bottom <= wall.top : box.left >= wall.right || box.right <= wall.left
      )
        continue;
      intervals.push(
        horizontal ? [wall.left - box.right, wall.right - box.left] : [wall.top - box.bottom, wall.bottom - box.top],
      );
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let start = Infinity;
    let end = -Infinity;
    for (const [lo, hi] of intervals) {
      if (lo >= end) {
        if (start < 0 && end > 0) break;
        start = lo;
        end = hi;
      } else {
        end = Math.max(end, hi);
      }
    }
    if (start < 0 && end > 0) {
      for (const distance of [end, start])
        candidates.push(horizontal ? new Vector(distance, 0) : new Vector(0, distance));
    }
  }
  return candidates
    .sort((a, b) => a.magnitude() - b.magnitude())
    .find((delta) => fits(new Rectangle(box.location.add(delta), box.size)));
}
