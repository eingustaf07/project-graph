import type { Project } from "@/core/Project";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { boundedDoodleOf } from "@/core/stage/stageObject/entity/Doodle";
import { exteriorTravel, fitDoodleBounds } from "@/core/algorithm/doodleBounds";
import { creationGridGap } from "@/core/algorithm/creationGrid";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";
import { DragCollisionIndex } from "./DragCollisionIndex";

/** Contact displacements travel forward through a queue; no node searches for a free destination. */
export function pushNodesInDragDirection(project: Project, before: Map<TextNode, Rectangle>, motion: Vector) {
  if (motion.isZero()) return;
  const horizontal = Math.abs(motion.x) >= Math.abs(motion.y);
  const positive = (horizontal ? motion.x : motion.y) > 0;
  const sources = new Set(before.keys());
  const nodes = project.stageManager.getTextNodes().filter((n) => !n.isHiddenBySectionCollapse);
  const owners = new Map(nodes.map((n) => [n, boundedDoodleOf(n)]));
  const index = new DragCollisionIndex(nodes);
  const planned = new Map<TextNode, Rectangle>();
  const queue = [...before].map(([node, start]) => ({ node, start, end: node.rectangle.clone() }));
  const rollback = () => {
    for (const [node, box] of before) node.collisionBox.updateShapeList([box]);
    project.entityMoveManager.invalidateCollisionIndex();
    for (const node of before.keys()) node.resolveOverlaps();
  };
  const gap = creationGridGap(project);
  const limit = nodes.length * (nodes.length + 1);
  for (let i = 0; i < queue.length; i++) {
    if (i > limit) {
      rollback();
      return;
    }
    const item = queue[i];
    const owner = owners.get(item.node);
    const swept = Rectangle.getBoundingRectangle([item.start, item.end], 0.001);
    for (const other of index.queryBounds(swept)) {
      if (other === item.node || owners.get(other) !== owner) continue;
      const box = planned.get(other) ?? other.rectangle;
      const delta = item.end.location.subtract(item.start.location);
      const contact = item.end.isCollideWith(box) || exteriorTravel(box, "rectangle", item.start, delta) < 1;
      if (!contact) continue;
      if (sources.has(other)) {
        if (!sources.has(item.node)) {
          rollback();
          return;
        }
        continue;
      }
      if (other.nearestLockedAncestorSection) {
        rollback();
        return;
      }
      let distance = horizontal
        ? positive
          ? item.end.right - box.left
          : item.end.left - box.right
        : positive
          ? item.end.bottom - box.top
          : item.end.top - box.bottom;
      if (positive ? distance <= 0 : distance >= 0) continue;
      if (gap) distance = Math.sign(distance) * Math.ceil(Math.abs(distance) / gap) * gap;
      const offset = horizontal ? new Vector(distance, 0) : new Vector(0, distance);
      const candidate = new Rectangle(box.location.add(offset), box.size.clone());
      if (
        (owner && !fitDoodleBounds(owner.frame, owner.shape, candidate)?.isZero()) ||
        !project.entityMoveManager.allowsCollisionPlacement(owner ?? null, box, candidate)
      ) {
        rollback();
        return;
      }
      planned.set(other, candidate);
      index.update(other, candidate);
      queue.push({ node: other, start: box, end: candidate });
    }
  }
  for (const [node, box] of planned) node.collisionBox.updateShapeList([box]);
  project.entityMoveManager.invalidateCollisionIndex();
  for (const node of new Set([...sources, ...planned.keys()])) node.resolveOverlaps();
}
