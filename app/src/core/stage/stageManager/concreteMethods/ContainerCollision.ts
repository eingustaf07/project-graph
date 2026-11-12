import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { exteriorTravel, fitDoodleBounds } from "@/core/algorithm/doodleBounds";
import { nearestFreeTranslation } from "@/core/algorithm/entityClearance";
import { translateClipboardEntities } from "@/core/service/dataManageService/copyEngine/clipboardPosition";
import { Doodle, Section } from "@/core/stage/stageObject/entity/Section";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";

function members(root: Entity) {
  const result = [root];
  const seen = new Set(result);
  for (let i = 0; i < result.length; i++) {
    const entity = result[i];
    if (entity instanceof Section)
      for (const child of entity.children)
        if (!seen.has(child)) {
          seen.add(child);
          result.push(child);
        }
  }
  return result;
}

/** Plan displacements before applying them. No recursive collision movement or partial pushes. */
export function solveContainerCollisions(
  project: Project,
  before: Map<Doodle, Rectangle>,
  restoreChildren = true,
): boolean {
  if (!Settings.enableContainerCollision || project.entityMoveManager?.ignoresDragCollisions) return true;
  const sources = [...before.keys()].filter((n) => {
    if (!n.bounded) return false;
    for (let parent = n.parentSection; parent; parent = parent.parentSection)
      if (parent instanceof Doodle && before.has(parent)) return false;
    return true;
  });
  if (!sources.length) return true;
  const moving = new Set(sources.flatMap(members));
  const containers = project.stageManager
    .getSections()
    .filter((n): n is Doodle => n instanceof Doodle && n.bounded && !n.isHiddenBySectionCollapse);
  const planned = new Map<Doodle, Rectangle>();
  const fail = () => {
    for (const source of sources) {
      const original = before.get(source)!;
      const delta = original.location.subtract(source.frame.location);
      if (restoreChildren) translateClipboardEntities(members(source).slice(1), delta);
      source.frame = original;
    }
    project.entityMoveManager?.invalidateCollisionIndex();
    return false;
  };
  for (const source of sources) {
    const owner = source.parentSection;
    if (owner instanceof Doodle && !fitDoodleBounds(owner.frame, owner.shape, source.frame)?.isZero()) return fail();
    const siblings = containers.filter((n) => n.parentSection === source.parentSection && n !== source);
    const previous = before.get(source)!;
    const motion = source.frame.location.subtract(previous.location);
    for (const other of siblings) {
      if (moving.has(other)) continue;
      let box = planned.get(other) ?? other.frame;
      const crossing = !motion.isZero() && exteriorTravel(box, "rectangle", previous, motion) < 1;
      if (!source.frame.isCollideWith(box) && !crossing) continue;
      if (other.locked || other.nearestLockedAncestorSection) return fail();
      if (crossing && !source.frame.isCollideWith(box)) {
        const displacement =
          Math.abs(motion.x) >= Math.abs(motion.y)
            ? new Vector(motion.x > 0 ? source.frame.right - box.left : source.frame.left - box.right, 0)
            : new Vector(0, motion.y > 0 ? source.frame.bottom - box.top : source.frame.top - box.bottom);
        box = new Rectangle(box.location.add(displacement), box.size.clone());
      }
      const obstacles = siblings.filter((n) => n !== other).map((n) => planned.get(n) ?? n.frame);
      obstacles.push(source.frame);
      const parent = other.parentSection;
      const fits = (candidate: Rectangle) =>
        obstacles.every((wall) => !candidate.isCollideWith(wall)) &&
        (!(parent instanceof Doodle) || !!fitDoodleBounds(parent.frame, parent.shape, candidate)?.isZero());
      if (!fits(box)) {
        const delta = nearestFreeTranslation(box, obstacles, fits);
        if (!delta) return fail();
        box = new Rectangle(box.location.add(delta), box.size.clone());
      }
      planned.set(other, box);
    }
  }
  for (const [container, box] of planned) {
    translateClipboardEntities(members(container), box.location.subtract(container.frame.location));
    container.adjustLocationAndSize();
  }
  project.entityMoveManager?.invalidateCollisionIndex();
  return true;
}
