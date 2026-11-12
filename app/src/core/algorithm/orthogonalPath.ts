import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

export function crossesRectangle(a: Vector, b: Vector, r: Rectangle) {
  if (a.x === b.x)
    return (
      a.x > r.left + 1e-7 &&
      a.x < r.right - 1e-7 &&
      Math.max(a.y, b.y) > r.top + 1e-7 &&
      Math.min(a.y, b.y) < r.bottom - 1e-7
    );
  if (a.y === b.y)
    return (
      a.y > r.top + 1e-7 &&
      a.y < r.bottom - 1e-7 &&
      Math.max(a.x, b.x) > r.left + 1e-7 &&
      Math.min(a.x, b.x) < r.right - 1e-7
    );
  return true;
}

function simplify(points: Vector[]) {
  const result: Vector[] = [];
  for (const point of points) {
    if (result.at(-1)?.equals(point)) continue;
    const a = result.at(-2),
      b = result.at(-1);
    if (a && b && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) result.pop();
    result.push(point);
  }
  return result;
}

/** Orthogonal visibility grid. Obstacles are tested without changing any graph objects. */
export function orthogonalPath(start: Vector, end: Vector, obstacles: Rectangle[], lane = 0): Vector[] {
  if (
    obstacles.some((r) =>
      [start, end].some(
        (p) => p.x > r.left + 1e-7 && p.x < r.right - 1e-7 && p.y > r.top + 1e-7 && p.y < r.bottom - 1e-7,
      ),
    )
  )
    return [];
  // The visibility search revisits the same row/column many times. Only rectangles crossing that
  // coordinate can block a segment. Keep these lists local to one search so edits cannot stale them.
  const rows = new Map<number, Rectangle[]>(),
    columns = new Map<number, Rectangle[]>();
  let searchingGrid = false;
  let cachedReferences = 0;
  const clear = (a: Vector, b: Vector) => {
    if (!searchingGrid) return !obstacles.some((r) => crossesRectangle(a, b, r));
    const vertical = a.x === b.x;
    const cache = vertical ? columns : rows;
    const coordinate = vertical ? a.x : a.y;
    let candidates = cache.get(coordinate);
    if (!candidates) {
      candidates = obstacles.filter((r) =>
        vertical
          ? coordinate > r.left + 1e-7 && coordinate < r.right - 1e-7
          : coordinate > r.top + 1e-7 && coordinate < r.bottom - 1e-7,
      );
      if (cache.size < 256 && cachedReferences + candidates.length <= 65536) {
        cache.set(coordinate, candidates);
        cachedReferences += candidates.length;
      }
    }
    return !candidates.some((r) => crossesRectangle(a, b, r));
  };
  const valid = (points: Vector[]) => points.slice(1).every((p, i) => clear(points[i], p));
  const middleX = (start.x + end.x) / 2,
    middleY = (start.y + end.y) / 2;
  const simple = [
    [start, new Vector(middleX + lane, start.y), new Vector(middleX + lane, end.y), end],
    [start, new Vector(start.x, middleY + lane), new Vector(end.x, middleY + lane), end],
  ].find(valid);
  if (simple) return simplify(simple);
  searchingGrid = true;
  const xs = [...new Set([start.x, end.x, middleX + lane, ...obstacles.flatMap((r) => [r.left - 12, r.right + 12])])];
  const ys = [...new Set([start.y, end.y, middleY + lane, ...obstacles.flatMap((r) => [r.top - 12, r.bottom + 12])])];
  const dx = Math.abs(end.x - start.x),
    dy = Math.abs(end.y - start.y);
  const lanes = [
    ...xs.map((x) => ({ xAxis: true, at: x, cost: Math.abs(start.x - x) + dy + Math.abs(end.x - x) })),
    ...ys.map((y) => ({ xAxis: false, at: y, cost: Math.abs(start.y - y) + dx + Math.abs(end.y - y) })),
  ].sort((a, b) => a.cost - b.cost);
  for (const lane of lanes) {
    const points = lane.xAxis
      ? [start, new Vector(lane.at, start.y), new Vector(lane.at, end.y), end]
      : [start, new Vector(start.x, lane.at), new Vector(end.x, lane.at), end];
    if (valid(points)) return simplify(points);
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const width = xs.length;
  const source = ys.indexOf(start.y) * width + xs.indexOf(start.x);
  const target = ys.indexOf(end.y) * width + xs.indexOf(end.x);
  const point = (id: number) => new Vector(xs[id % width], ys[Math.floor(id / width)]);
  const heap: { id: number; cost: number; estimate: number }[] = [];
  const push = (item: (typeof heap)[number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].estimate <= item.estimate) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = item;
  };
  const pop = () => {
    const result = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].estimate < heap[child].estimate) child++;
        if (heap[child].estimate >= last.estimate) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return result;
  };
  const distances = new Map([[source, 0]]),
    previous = new Map<number, number>();
  push({ id: source, cost: 0, estimate: Math.abs(start.x - end.x) + Math.abs(start.y - end.y) });
  while (heap.length) {
    const current = pop();
    if (current.cost !== distances.get(current.id)) continue;
    if (current.id === target) {
      const result = [end];
      let id = target;
      while (id !== source) {
        id = previous.get(id)!;
        result.push(point(id));
      }
      return simplify(result.reverse());
    }
    const x = current.id % width,
      y = Math.floor(current.id / width),
      a = point(current.id);
    const neighbors = [
      x > 0 ? current.id - 1 : -1,
      x + 1 < width ? current.id + 1 : -1,
      y > 0 ? current.id - width : -1,
      y + 1 < ys.length ? current.id + width : -1,
    ];
    for (const id of neighbors) {
      if (id < 0) continue;
      const b = point(id);
      if (!clear(a, b)) continue;
      const distance = current.cost + a.distance(b);
      if (distance >= (distances.get(id) ?? Infinity)) continue;
      distances.set(id, distance);
      previous.set(id, current.id);
      push({ id, cost: distance, estimate: distance + Math.abs(b.x - end.x) + Math.abs(b.y - end.y) });
    }
  }
  return [];
}
