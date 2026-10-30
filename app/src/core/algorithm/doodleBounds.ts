import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

export type DoodleShape = "rectangle" | "circle";

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
