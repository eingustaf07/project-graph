import type { Project } from "@/core/Project";
import { exteriorTravel, fitDoodleBounds, overlapsDoodle } from "@/core/algorithm/doodleBounds";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { Doodle, boundedDoodleOf } from "@/core/stage/stageObject/entity/Doodle";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";

/** Membership changes only during an explicit drag of nodes selected before pointer-down. */
export class ContainerNodeDrag {
  private readonly pointerTargets = new Map<Entity, Vector>();
  private readonly walls: Doodle[];
  private readonly selected: Set<Entity>;

  constructor(
    private readonly project: Project,
    clicked: Entity,
  ) {
    this.selected = new Set(clicked.isSelected ? project.stageManager.getSelectedEntities() : []);
    this.walls = project.stageManager.getSections().filter((s): s is Doodle => s instanceof Doodle && s.bounded);
    this.walls.sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height);
  }

  constrain(entity: Entity, delta: Vector, allowTransfer: boolean): Vector {
    if (entity instanceof Section || !this.walls.length) return delta;
    const box = entity.collisionBox.getRectangle();
    const owner = boundedDoodleOf(entity);
    const transfer =
      allowTransfer &&
      this.selected.has(entity) &&
      entity.isSelected &&
      this.project.controller.pressingKeySet.has("k");
    let desired = delta;
    if (transfer) {
      const center = (this.pointerTargets.get(entity) ?? box.center).add(delta);
      this.pointerTargets.set(entity, center);
      desired = center.subtract(box.center);
      const target = this.walls.find((wall) => wall.containsContentPoint(center)) ?? null;
      if (target !== owner && !target?.locked && !target?.nearestLockedAncestorSection) {
        const proposed = new Rectangle(box.location.add(desired), box.size);
        const fit = target ? fitDoodleBounds(target.frame, target.shape, proposed) : Vector.getZero();
        if (fit) {
          const landed = new Rectangle(proposed.location.add(fit), box.size);
          if (
            !this.walls.some((wall) => !this.belongsTo(target, wall) && overlapsDoodle(wall.frame, wall.shape, landed))
          ) {
            this.project.sectionInOutManager.entityDropParent(entity, false, null, true);
            if (target) {
              target.children.push(entity);
              entity.parentSection = target;
            }
            return desired.add(fit);
          }
        }
      }
    } else this.pointerTargets.delete(entity);
    if (owner) {
      const candidate = new Rectangle(box.location.add(desired), box.size);
      const fit = fitDoodleBounds(owner.frame, owner.shape, candidate);
      if (!fit) return Vector.getZero();
      desired = desired.add(fit);
    }
    return desired.multiply(this.exteriorFraction(owner, box, desired));
  }

  exteriorFraction(owner: Doodle | null, box: Rectangle, desired: Vector): number {
    let fraction = 1;
    for (const wall of this.walls) {
      if (this.belongsTo(owner, wall)) continue;
      fraction = Math.min(fraction, exteriorTravel(wall.frame, wall.shape, box, desired));
    }
    return fraction;
  }

  private belongsTo(owner: Doodle | null, wall: Doodle): boolean {
    for (let parent: Section | null = owner; parent; parent = parent.parentSection) {
      if (parent === wall) return true;
    }
    return false;
  }
}
