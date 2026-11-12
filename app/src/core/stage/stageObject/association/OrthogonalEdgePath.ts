import type { Project } from "@/core/Project";
import type { LineEdge } from "./LineEdge";
import type { Entity } from "../abstract/StageEntity";
import { Edge } from "./Edge";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { crossesRectangle, orthogonalPath } from "@/core/algorithm/orthogonalPath";

type Context = {
  tick: number | undefined;
  topology: string;
  boxes: Map<object, Rectangle>;
  edges: LineEdge[];
  paths: Map<string, Vector[]>;
  changed: { node: object; rect: Rectangle }[];
  used: Set<string>;
  validated: Set<string>;
  failed: Set<string>;
  geometryChanged: boolean;
  outgoing: Map<LineEdge["source"], LineEdge[]>;
  incoming: Map<LineEdge["target"], LineEdge[]>;
};
const contexts = new WeakMap<Project, Context>();
const bounds = new WeakMap<Vector[], Rectangle>();

function rectangleOf(entity: Entity): Rectangle {
  const rectangle = "rectangle" in entity ? entity.rectangle : undefined;
  return rectangle instanceof Rectangle ? rectangle : entity.collisionBox.getRectangle();
}

export function getOrthogonalEdgeBounds(edge: LineEdge): Rectangle {
  const points = edge.orthogonalPath;
  let rectangle = bounds.get(points);
  if (!rectangle) {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const point of points) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
    rectangle = new Rectangle(new Vector(left, top), new Vector(right - left, bottom - top));
    bounds.set(points, rectangle);
  }
  return rectangle;
}

export function getOrthogonalEdgePath(edge: LineEdge, project: Project): Vector[] {
  let context = contexts.get(project);
  const tick = project.renderer?.frameIndex;
  if (!context || tick === undefined || context.tick !== tick) {
    const entities = project.stageManager
      .getEntities()
      .filter((n) => !n.isHiddenBySectionCollapse && !("children" in n));
    const boxes = new Map<object, Rectangle>(entities.map((n) => [n, rectangleOf(n).clone()]));
    const edges = project.stageManager.getLineEdges();
    const topology = JSON.stringify([
      edges.map((e) => [
        e.uuid,
        e.source.uuid,
        e.target.uuid,
        e.sourceRectangleRate,
        e.targetRectangleRate,
        e.shiftingIndex,
      ]),
    ]);
    const changed = [...boxes]
      .filter(([node, r]) => {
        const old = context?.boxes.get(node);
        return !old || old.left !== r.left || old.top !== r.top || old.width !== r.width || old.height !== r.height;
      })
      .map(([node, rect]) => ({ node, rect }));
    const paths =
      context?.topology === topology
        ? new Map([...context.paths].filter(([key]) => context!.used.has(key)))
        : new Map<string, Vector[]>();
    let outgoing = context?.outgoing,
      incoming = context?.incoming;
    if (!outgoing || !incoming || context?.topology !== topology) {
      outgoing = new Map();
      incoming = new Map();
      for (const edge of edges) {
        const from = outgoing.get(edge.source) ?? [];
        from.push(edge);
        outgoing.set(edge.source, from);
        const to = incoming.get(edge.target) ?? [];
        to.push(edge);
        incoming.set(edge.target, to);
      }
    }
    context = {
      tick,
      topology,
      boxes,
      edges,
      paths,
      changed,
      outgoing,
      incoming,
      geometryChanged: boxes.size !== context?.boxes.size || changed.length > 0,
      failed: new Set([...(context?.failed ?? [])].filter((key) => paths.has(key))),
      used: new Set(),
      validated: new Set(),
    };
    contexts.set(project, context);
  }
  const source = rectangleOf(edge.source),
    target = rectangleOf(edge.target);
  const cacheKey = JSON.stringify([
    edge.uuid,
    edge.source.uuid,
    edge.target.uuid,
    source.left,
    source.top,
    source.width,
    source.height,
    target.left,
    target.top,
    target.width,
    target.height,
  ]);
  const cached = context.paths.get(cacheKey);
  context.used.add(cacheKey);
  if (
    cached &&
    (context.validated.has(cacheKey) ||
      ((!context.failed.has(cacheKey) || !context.geometryChanged) &&
        !context.changed.some(
          ({ node, rect }) =>
            node !== edge.source &&
            node !== edge.target &&
            cached.slice(1).some((p, i) => crossesRectangle(cached[i], p, rect)),
        )))
  ) {
    context.validated.add(cacheKey);
    return cached;
  }
  const dx = target.center.x - source.center.x,
    dy = target.center.y - source.center.y;
  const auto = Math.abs(dx) >= Math.abs(dy) ? new Vector(Math.sign(dx) || 1, 0) : new Vector(0, Math.sign(dy) || 1);
  const from = Edge.getNormalVectorByRate(edge.sourceRectangleRate) ?? auto;
  const to = Edge.getNormalVectorByRate(edge.targetRectangleRate) ?? auto.multiply(-1);
  const port = (rect: Rectangle, normal: Vector, sourceEnd: boolean) => {
    const group = (sourceEnd ? context!.outgoing.get(edge.source) : context!.incoming.get(edge.target)) ?? [];
    const index = group.findIndex((e) => e.uuid === edge.uuid);
    const fraction = group.length > 1 && index >= 0 ? 0.2 + (0.6 * (index + 1)) / (group.length + 1) : 0.5;
    return normal.x
      ? new Vector(normal.x > 0 ? rect.right : rect.left, rect.top + rect.height * fraction)
      : new Vector(rect.left + rect.width * fraction, normal.y > 0 ? rect.bottom : rect.top);
  };
  const start = port(source, from, true),
    end = port(target, to, false);
  const obstacles = [...context.boxes]
    .filter(([node]) => node !== edge.source && node !== edge.target)
    .map(([, rect]) => rect);
  obstacles.push(source, target);
  const outgoing = context.outgoing.get(edge.source) ?? [];
  const branch = outgoing.findIndex((e) => e.uuid === edge.uuid) - (outgoing.length - 1) / 2;
  const spacing = Math.min(12, Math.abs(from.x ? end.x - start.x : end.y - start.y) / (outgoing.length + 1));
  const lane = edge.shiftingIndex * 12 + (outgoing.length > 1 ? branch * spacing : 0);
  const routed = orthogonalPath(start, end, obstacles, lane);
  // Overlapping nodes can cover an endpoint completely. Keep such an edge visible and selectable.
  const points = routed.length ? routed : [start, new Vector(start.x, end.y), end];
  // Reject reversing at the endpoint, even if an alternate route touches the same node boundary.
  if (
    points.length > 1 &&
    (points[1].subtract(start).dot(from) < 0 || points[points.length - 2].subtract(end).dot(to) < 0)
  ) {
    const a = start.add(from.multiply(12)),
      b = end.add(to.multiply(12));
    const middle = orthogonalPath(a, b, obstacles, lane);
    if (middle.length && !obstacles.some((r) => crossesRectangle(start, a, r) || crossesRectangle(b, end, r))) {
      context.validated.add(cacheKey);
      const path = [start, ...middle, end];
      context.paths.set(cacheKey, path);
      context.failed.delete(cacheKey);
      return path;
    }
  }
  context.validated.add(cacheKey);
  context.paths.set(cacheKey, points);
  if (routed.length) context.failed.delete(cacheKey);
  else context.failed.add(cacheKey);
  return points;
}
