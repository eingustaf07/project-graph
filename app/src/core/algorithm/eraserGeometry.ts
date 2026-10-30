import { Vector } from "@graphif/data-structures";
import { Line, Rectangle } from "@graphif/shapes";

// Plain numeric data survives MsgPack without embedding runtime Vector instances in an untyped record.
export type EraserMark = { points: [number, number][]; radiusX: number; radiusY: number };
export function eraserFrame(frame: Rectangle): Rectangle {
  return new Rectangle(frame.location.clone(), new Vector(Math.max(1, frame.width), Math.max(1, frame.height)));
}
export function pointSegmentDistance(point: Vector, from: Vector, to: Vector): number {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const t =
    dx * dx + dy * dy
      ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)))
      : 0;
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}
function segmentDistance(a: Vector, b: Vector, c: Vector, d: Vector): number {
  if (new Line(a, b).isCollideWithLine(new Line(c, d))) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}
export function eraserHitsLine(path: Vector[], radius: number, from: Vector, to: Vector): boolean {
  return path.some((p, i) =>
    i === 0 ? pointSegmentDistance(p, from, to) <= radius : segmentDistance(path[i - 1], p, from, to) <= radius,
  );
}
export function eraserHitsRectangle(path: Vector[], radius: number, frame: Rectangle): boolean {
  return (
    path.some((p) => frame.isPointIn(p)) ||
    frame.getBoundingLines().some((line) => eraserHitsLine(path, radius, line.start, line.end))
  );
}
export function makeEraserMark(path: Vector[], radius: number, frame: Rectangle): EraserMark {
  const r = eraserFrame(frame);
  return {
    points: path.map((p) => [(p.x - r.left) / r.width, (p.y - r.top) / r.height]),
    radiusX: radius / r.width,
    radiusY: radius / r.height,
  };
}
export function eraserMarkContains(mark: EraserMark, point: Vector, frame: Rectangle): boolean {
  if (!mark.points.length || !(mark.radiusX > 0) || !(mark.radiusY > 0)) return false;
  const r = eraserFrame(frame),
    p = new Vector((point.x - r.left) / r.width / mark.radiusX, (point.y - r.top) / r.height / mark.radiusY);
  const points = mark.points.map(([x, y]) => new Vector(x / mark.radiusX, y / mark.radiusY));
  return points.some((v, i) => pointSegmentDistance(p, i ? points[i - 1] : v, v) <= 1);
}
