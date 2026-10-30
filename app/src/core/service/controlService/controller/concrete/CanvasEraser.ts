import type { Project } from "@/core/Project";
import { eraserHitsLine, eraserHitsRectangle, makeEraserMark, type EraserMark } from "@/core/algorithm/eraserGeometry";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { Association } from "@/core/stage/stageObject/abstract/Association";
import { StageObject } from "@/core/stage/stageObject/abstract/StageObject";
import { PenStroke } from "@/core/stage/stageObject/entity/PenStroke";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { SvgNode } from "@/core/stage/stageObject/entity/SvgNode";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { Vector } from "@graphif/data-structures";
import { Circle, Line, Rectangle } from "@graphif/shapes";
import { Settings } from "@/core/service/Settings";

function isPartial(object: StageObject): object is PenStroke | ImageNode | SvgNode | Doodle {
  return (
    object instanceof PenStroke || object instanceof ImageNode || object instanceof SvgNode || object instanceof Doodle
  );
}
export class CanvasEraser {
  private path: Vector[] = [];
  private radius = 1;
  constructor(private readonly project: Project) {}
  get active(): boolean {
    return this.path.length > 0;
  }
  get points(): readonly Vector[] {
    return this.path;
  }
  get worldRadius(): number {
    return this.radius;
  }
  begin(point: Vector, radius: number): void {
    if (!(radius > 0) || !Number.isFinite(radius)) throw new Error("橡皮大小无效");
    this.radius = radius;
    this.path = [point.clone()];
  }
  move(point: Vector): void {
    if (!this.path.length) return;
    const last = this.path.at(-1)!;
    if (last.distance(point) >= Math.max(0.25, this.radius / 8)) this.path.push(point.clone());
  }
  cancel(): void {
    this.path = [];
  }
  private eligible(object: StageObject): boolean {
    return (
      !Settings.viewerMode &&
      object.isPhysical &&
      !(object instanceof Entity && object.isHiddenBySectionCollapse) &&
      !(
        object instanceof Association &&
        object.associationList.length > 0 &&
        object.associationList.every((member) => member instanceof Entity && member.isHiddenBySectionCollapse)
      ) &&
      !this.project.sectionMethods.isObjectBeLockedBySection(object)
    );
  }
  preview(entity: Entity): EraserMark | undefined {
    let bounds =
      entity instanceof Doodle && entity.text
        ? new Rectangle(
            entity.frame.location.subtract(new Vector(0, 32)),
            new Vector(Math.max(entity.frame.width, entity.text.length * 24 + 16), entity.frame.height + 32),
          )
        : entity.eraserBounds;
    const inkPadding =
      entity instanceof PenStroke
        ? Math.max(0.25 / this.project.camera.currentScale, ...entity.segments.map((s) => s.pressure * 2.5))
        : entity instanceof Doodle
          ? Math.max(1, 0.5 / this.project.camera.currentScale)
          : 0;
    if (inkPadding)
      bounds = new Rectangle(
        bounds.location.subtract(Vector.same(inkPadding)),
        bounds.size.add(Vector.same(inkPadding * 2)),
      );
    if (
      !this.active ||
      !isPartial(entity) ||
      !this.eligible(entity) ||
      !eraserHitsRectangle(this.path, this.radius, bounds)
    )
      return;
    return makeEraserMark(this.path, this.radius, entity.eraserBounds);
  }
  finish(point: Vector): boolean {
    if (!this.active) return false;
    if (this.path.at(-1)!.distance(point) > 0.000001) this.path.push(point.clone());
    const stage = [...this.project.stage];
    const children = new Map(this.project.stageManager.getSections().map((s) => [s, [...s.children]]));
    const associationLists = new Map(
      this.project.stageManager.getAssociations().map((a) => [a, [...a.associationList]]),
    );
    const oldMasks = new Map<Entity, EraserMark[] | undefined>();
    const entities: Entity[] = [],
      associations: Association[] = [];
    for (const object of stage) {
      if (!this.eligible(object)) continue;
      if (isPartial(object)) {
        const mark = this.preview(object);
        if (mark) oldMasks.set(object, object.erasures);
        continue;
      }
      const hit = object.collisionBox.shapes.some((shape) => {
        if (shape instanceof Line) return eraserHitsLine(this.path, this.radius, shape.start, shape.end);
        if (shape instanceof Rectangle) return eraserHitsRectangle(this.path, this.radius, shape);
        if (shape instanceof Circle)
          return eraserHitsLine(this.path, this.radius + shape.radius, shape.location, shape.location);
        return eraserHitsRectangle(this.path, this.radius, shape.getRectangle());
      });
      if (hit) {
        if (object instanceof Entity) entities.push(object);
        else if (object instanceof Association) associations.push(object);
      }
    }
    if (!oldMasks.size && !entities.length && !associations.length) {
      this.cancel();
      return false;
    }
    try {
      for (const [entity, masks] of oldMasks)
        entity.erasures = [...(masks ?? []), makeEraserMark(this.path, this.radius, entity.eraserBounds)];
      this.cancel();
      if (entities.length) this.project.deleteManager.deleteEntities(entities);
      for (const association of associations) {
        if (!this.project.stage.includes(association)) continue;
        if (association instanceof Edge) this.project.deleteManager.deleteEdge(association);
        else if (association instanceof MultiTargetUndirectedEdge)
          this.project.deleteManager.deleteMultiTargetUndirectedEdge(association);
        else this.project.stageManager.delete(association);
      }
      this.project.stageManager.updateReferences();
      this.project.historyManager.recordStep();
      return true;
    } catch (error) {
      this.project.stage = stage;
      for (const [section, list] of children) section.children = list;
      for (const [association, list] of associationLists) association.associationList = list;
      for (const [entity, masks] of oldMasks) entity.erasures = masks;
      this.project.stageManager.updateReferences();
      throw error;
    } finally {
      this.cancel();
    }
  }
}
