import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { PenStroke } from "@/core/stage/stageObject/entity/PenStroke";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { Vector } from "@graphif/data-structures";
import { Circle, Line, Rectangle } from "@graphif/shapes";

// Detached copies must not call Entity.move: that also moves section children and pushes existing nodes away.
export function centerClipboardEntities(entities: Entity[], location: Vector): Rectangle {
  const hidden = new Set<Entity>();
  const hideChildren = (section: Section) => {
    for (const child of section.children) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      if (child instanceof Section) hideChildren(child);
    }
  };
  for (const entity of entities) {
    if (entity instanceof Section && entity.isCollapsed) hideChildren(entity);
  }
  const bounds = Rectangle.getBoundingRectangle(
    entities.filter((entity) => !hidden.has(entity)).map((entity) => entity.collisionBox.getRectangle()),
  );
  const delta = location.subtract(bounds.center);
  translateClipboardEntities(entities, delta);
  return new Rectangle(bounds.location.add(delta), bounds.size.clone());
}

export function translateClipboardEntities(entities: Entity[], delta: Vector): void {
  for (const entity of entities) {
    if (entity instanceof Section) {
      entity.translateClipboardGeometry(delta);
      continue;
    }
    if (entity instanceof PenStroke) {
      entity.move(delta);
      continue;
    }
    entity.collisionBox.updateShapeList(
      entity.collisionBox.shapes.map((shape) => {
        if (shape instanceof Rectangle) return new Rectangle(shape.location.add(delta), shape.size.clone());
        if (shape instanceof Line) return new Line(shape.start.add(delta), shape.end.add(delta));
        if (shape instanceof Circle) return new Circle(shape.location.add(delta), shape.radius);
        throw new Error("此节点的形状暂不支持居中粘贴，原画布未改变");
      }),
    );
  }
}
