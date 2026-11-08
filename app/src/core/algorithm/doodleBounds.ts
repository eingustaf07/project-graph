import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

export type DoodleShape = "rectangle" | "circle";

/** Earliest contact along a swept box, so fast pointer events cannot skip a wall. */
export function exteriorTravel(frame: Rectangle, shape: DoodleShape, box: Rectangle, delta: Vector): number {
  const x = box.center.x - frame.center.x,
    y = box.center.y - frame.center.y;
  const w = box.width / 2,
    h = box.height / 2;
  function slab(position: number, velocity: number, extent: number): [number, number] {
    if (!velocity) return Math.abs(position) < extent ? [-Infinity, Infinity] : [Infinity, -Infinity];
    const a = (-extent - position) / velocity,
      b = (extent - position) / velocity;
    return [Math.min(a, b), Math.max(a, b)];
  }
  function rectangleHit(width: number, height: number) {
    const [x0, x1] = slab(x, delta.x, width),
      [y0, y1] = slab(y, delta.y, height);
    const start = Math.max(x0, y0),
      end = Math.min(x1, y1);
    return start >= -1e-9 && start < end ? Math.max(0, start) : 1;
  }
  if (shape === "rectangle") return Math.min(1, rectangleHit(frame.width / 2 + w, frame.height / 2 + h));
  const radius = Math.min(frame.width, frame.height) / 2;
  // The swept center hits the original circle expanded by the node's half-extents.
  if (Math.hypot(Math.max(0, Math.abs(x) - w), Math.max(0, Math.abs(y) - h)) < radius - 1e-8) return 1;
  let hit = Math.min(1, rectangleHit(w + radius, h), rectangleHit(w, h + radius));
  const speed2 = delta.x ** 2 + delta.y ** 2;
  if (!speed2) return hit;
  for (const cx of [-w, w])
    for (const cy of [-h, h]) {
      const dx = x - cx,
        dy = y - cy,
        dot = dx * delta.x + dy * delta.y;
      const discriminant = dot * dot - speed2 * (dx * dx + dy * dy - radius * radius);
      if (dot >= 0 || discriminant <= 0) continue;
      const t = (-dot - Math.sqrt(discriminant)) / speed2;
      if (t >= -1e-9) hit = Math.min(hit, Math.max(0, t));
    }
  return hit;
}

export function overlapsDoodle(frame: Rectangle, shape: DoodleShape, box: Rectangle): boolean {
  if (shape === "rectangle")
    return box.left < frame.right && box.right > frame.left && box.top < frame.bottom && box.bottom > frame.top;
  const x = Math.max(0, frame.center.x - box.right, box.left - frame.center.x);
  const y = Math.max(0, frame.center.y - box.bottom, box.top - frame.center.y);
  return Math.hypot(x, y) < Math.min(frame.width, frame.height) / 2;
}

export function doodleContainsPoint(frame: Rectangle, shape: DoodleShape, point: Vector): boolean {
  if (shape === "rectangle") return frame.isPointIn(point);
  return point.distance(frame.center) <= Math.min(frame.width, frame.height) / 2;
}

/** Returns a translation that keeps all four corners inside the boundary, or null if it cannot fit. */
export function fitDoodleBounds(frame: Rectangle, shape: DoodleShape, child: Rectangle): Vector | null {
  const padding = 8;
  if (shape === "rectangle") {
    if (child.width > frame.width - padding * 2 || child.height > frame.height - padding * 2) return null;
    return new Vector(
      Math.max(frame.left + padding, Math.min(child.left, frame.right - padding - child.width)) - child.left,
      Math.max(frame.top + padding, Math.min(child.top, frame.bottom - padding - child.height)) - child.top,
    );
  }
  const radius = Math.min(frame.width, frame.height) / 2 - padding;
  const half = child.size.multiply(0.5);
  if (radius <= 0 || half.x * half.x + half.y * half.y > radius * radius) return null;
  const offset = child.center.subtract(frame.center);
  const fits = (t: number) =>
    (Math.abs(offset.x * t) + half.x) ** 2 + (Math.abs(offset.y * t) + half.y) ** 2 <= radius * radius;
  if (fits(1)) return Vector.getZero();
  let low = 0,
    high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return frame.center.add(offset.multiply(low)).subtract(child.center);
}
