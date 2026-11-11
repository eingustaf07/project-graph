import type { Project } from "@/core/Project";
import { exteriorTravel, fitDoodleBounds, overlapsDoodle } from "@/core/algorithm/doodleBounds";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { Doodle, boundedDoodleOf } from "@/core/stage/stageObject/entity/Doodle";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { RepeatedWallImpact } from "@/core/algorithm/repeatedWallImpact";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";

/** Membership changes only during an explicit drag of nodes selected before pointer-down. */
export class ContainerNodeDrag {
  private readonly impacts = new RepeatedWallImpact();
  resizedByImpact = false;
  private readonly pointerTargets = new Map<Entity, Vector>();
  private readonly walls: Doodle[];
  private readonly selected: Set<Entity>;
  private batchActive = false;
  private batchGrabPoint: Vector;
  private readonly grabOffset: Vector;

  constructor(
    private readonly project: Project,
    private readonly clicked: Entity,
    private grabPoint?: Vector,
  ) {
    const center = clicked.collisionBox.getRectangle().center;
    this.batchGrabPoint = grabPoint ?? center;
    this.grabOffset = center.subtract(this.batchGrabPoint);
    this.selected = new Set(clicked.isSelected ? project.stageManager.getSelectedEntities() : []);
    this.walls = project.stageManager.getSections().filter((s): s is Doodle => s instanceof Doodle && s.bounded);
    this.walls.sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height);
  }

  /** Decide one displacement and one membership change for all nodes in this pointer drag. */
  constrainBatch(entities: Entity[], delta: Vector): { delta: Vector; transferred?: boolean } | undefined {
    this.impacts.reset();
    if (!this.walls.length || !this.selected.has(this.clicked) || !entities.includes(this.clicked)) return;
    this.batchGrabPoint = this.batchGrabPoint.add(delta);
    const transfer = this.project.controller.pressingKeySet.has("v");
    if (!transfer && !this.batchActive) return;
    if (entities.some((entity) => entity instanceof Section)) return;
    const owner = boundedDoodleOf(this.clicked);
    // Nodes with different owners must cross their own walls independently.
    if (entities.some((entity) => boundedDoodleOf(entity) !== owner)) return;
    if (entities.some((entity) => entity.nearestLockedAncestorSection)) return { delta: Vector.getZero() };
    this.batchActive = true;
    const box = Rectangle.getBoundingRectangle(entities.map((entity) => entity.collisionBox.getRectangle()));
    let desired = delta;
    if (transfer) {
      desired = this.batchGrabPoint.add(this.grabOffset).subtract(this.clicked.collisionBox.getRectangle().center);
      const target = this.walls.find((wall) => wall.containsContentPoint(this.batchGrabPoint)) ?? null;
      if (target !== owner && !target?.locked && !target?.nearestLockedAncestorSection) {
        const landing = this.transferDelta(owner, target, box, desired, this.batchGrabPoint);
        if (landing) {
          const moving = new Set(entities);
          const parents = new Set(entities.map((entity) => entity.parentSection));
          for (const parent of parents) {
            if (!parent) continue;
            parent.children = parent.children.filter((child) => !moving.has(child));
          }
          for (const entity of entities) {
            entity.parentSection = target;
            target?.children.push(entity);
          }
          return { delta: landing, transferred: true };
        }
      }
    }
    if (owner) {
      const fit = fitDoodleBounds(owner.frame, owner.shape, new Rectangle(box.location.add(desired), box.size));
      if (!fit) return { delta: Vector.getZero() };
      desired = desired.add(fit);
    }
    return { delta: desired.multiply(this.exteriorFraction(owner, box, desired)) };
  }

  constrain(entity: Entity, delta: Vector, allowTransfer: boolean, movingBatch: boolean): Vector {
    if (entity instanceof Section || !this.walls.length) return delta;
    const box = entity.collisionBox.getRectangle();
    const owner = boundedDoodleOf(entity);
    const grabbedImage = entity === this.clicked && entity instanceof ImageNode && this.grabPoint !== undefined;
    if (grabbedImage && allowTransfer) this.grabPoint = this.grabPoint!.add(delta);
    const transfer =
      allowTransfer &&
      this.selected.has(entity) &&
      entity.isSelected &&
      this.project.controller.pressingKeySet.has("v");
    let desired = delta;
    if (transfer) {
      const center = (this.pointerTargets.get(entity) ?? box.center).add(delta);
      this.impacts.reset();
      this.pointerTargets.set(entity, center);
      desired = center.subtract(box.center);
      const probe = grabbedImage ? this.grabPoint! : center;
      const target = this.walls.find((wall) => wall.containsContentPoint(probe)) ?? null;
      if (target !== owner && !target?.locked && !target?.nearestLockedAncestorSection) {
        const landing = this.transferDelta(owner, target, box, desired, grabbedImage ? probe : undefined);
        if (landing) {
          this.project.sectionInOutManager.entityDropParent(entity, false, null, true);
          if (target) {
            target.children.push(entity);
            entity.parentSection = target;
          }
          return landing;
        }
      }
    } else this.pointerTargets.delete(entity);
    if (owner) {
      const candidate = new Rectangle(box.location.add(desired), box.size);
      if (
        allowTransfer &&
        !transfer &&
        entity === this.clicked &&
        this.selected.size === 1 &&
        this.selected.has(entity) &&
        entity.isSelected &&
        entity.parentSection === owner &&
        owner.shape === "rectangle" &&
        !owner.locked &&
        !owner.nearestLockedAncestorSection &&
        !this.project.controller.pressingKeySet.has("v") &&
        !movingBatch
      ) {
        const next = this.impacts.advance(
          owner.frame,
          candidate,
          desired,
          this.project.camera?.currentScale || 1,
          performance.now(),
        );
        if (next) {
          const outer = boundedDoodleOf(owner);
          const fit = outer && fitDoodleBounds(outer.frame, outer.shape, next);
          if (!outer || fit?.isZero()) {
            owner.resizeFrame(next);
            this.resizedByImpact = true;
          }
        }
      }
      const fit = fitDoodleBounds(owner.frame, owner.shape, candidate);
      if (!fit) return Vector.getZero();
      desired = desired.add(fit);
    }
    return desired.multiply(this.exteriorFraction(owner, box, desired));
  }

  private transferDelta(owner: Doodle | null, target: Doodle | null, box: Rectangle, desired: Vector, probe?: Vector) {
    let proposed = new Rectangle(box.location.add(desired), box.size);
    if (probe && owner && !this.belongsTo(target, owner) && overlapsDoodle(owner.frame, owner.shape, proposed)) {
      const outward = probe.subtract(owner.frame.center).normalize();
      const offset = outward.multiply(owner.frame.size.magnitude() + box.size.magnitude() + 1);
      const outside = new Rectangle(proposed.location.add(offset), box.size);
      const travel = exteriorTravel(owner.frame, owner.shape, outside, offset.multiply(-1));
      desired = desired.add(offset.multiply(1 - travel + 1e-9));
      proposed = new Rectangle(box.location.add(desired), box.size);
    }
    const fit = target ? fitDoodleBounds(target.frame, target.shape, proposed) : Vector.getZero();
    if (!fit) return;
    const landed = new Rectangle(proposed.location.add(fit), box.size);
    if (!this.walls.some((wall) => !this.belongsTo(target, wall) && overlapsDoodle(wall.frame, wall.shape, landed)))
      return desired.add(fit);
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
