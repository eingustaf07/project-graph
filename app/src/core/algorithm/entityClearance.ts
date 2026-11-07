import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

// Each obstacle forbids an open interval of translations on a given axis.
// Only the connected interval containing zero needs to be cleared.
export function nearestFreeTranslation(
  box: Rectangle,
  obstacles: Rectangle[],
  fits: (box: Rectangle) => boolean,
  step = 0,
) {
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
    if (step > 0) {
      for (const interval of intervals) {
        interval[0] = Math.floor(interval[0] / step) * step;
        interval[1] = Math.ceil(interval[1] / step) * step;
      }
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
      for (const distance of [end, start]) {
        const displacement =
          step > 0 ? (distance > 0 ? Math.ceil(distance / step) : Math.floor(distance / step)) * step : distance;
        candidates.push(horizontal ? new Vector(displacement, 0) : new Vector(0, displacement));
      }
    }
  }
  return candidates
    .sort((a, b) => a.magnitude() - b.magnitude())
    .find((delta) => {
      const candidate = new Rectangle(box.location.add(delta), box.size);
      return fits(candidate) && (step <= 0 || obstacles.every((wall) => !candidate.isCollideWith(wall)));
    });
}
