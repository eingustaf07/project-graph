import type { Project } from "@/core/Project";
import { doodleContainsPoint, fitDoodleBounds, type DoodleShape } from "@/core/algorithm/doodleBounds";
import { translateClipboardEntities } from "@/core/service/dataManageService/copyEngine/clipboardPosition";
import { Entity } from "../abstract/StageEntity";
import { CollisionBox } from "../collisionBox/collisionBox";
import { Section } from "./Section";
import { Vector } from "@graphif/data-structures";
import { deserialize, passExtraAtArg1, passObject, serializable, serialize } from "@graphif/serializer";
import { Line, Rectangle } from "@graphif/shapes";
import { toast } from "sonner";
import { getTextSize } from "@/utils/font";
import { Renderer } from "@/core/render/canvas2d/renderer";

function tree(entity: Entity): Entity[] {
  const result: Entity[] = [],
    visited = new Set<Entity>();
  const visit = (current: Entity) => {
    if (visited.has(current)) return;
    visited.add(current);
    result.push(current);
    if (current instanceof Section) current.children.forEach(visit);
  };
  visit(entity);
  return result;
}
const editableKeys = [
  "text",
  "sizeAdjust",
  "fontScaleLevel",
  "fontSizeCache",
  "fontFamily",
  "fontWeight",
  "scale",
  "latexSource",
  "segments",
  "frame",
  "isCollapsed",
];
type DoodleOptions = NonNullable<ConstructorParameters<typeof Section>[1]> & {
  frame?: Rectangle;
  shape?: DoodleShape;
  bounded?: boolean;
};

@passExtraAtArg1
@passObject
export class Doodle extends Section {
  override readonly isDoodle = true;
  override isAlignExcluded = true;
  @serializable frame: Rectangle;
  @serializable shape: DoodleShape;
  @serializable bounded: boolean;
  private accepted = new WeakMap<Entity, { geometry: unknown; fields: Record<string, unknown> }>();
  private lastWarning = 0;

  constructor(
    project: Project,
    {
      frame = new Rectangle(Vector.getZero(), new Vector(400, 300)),
      shape = "rectangle",
      bounded = false,
      ...options
    }: DoodleOptions = {},
  ) {
    super(project, { ...options, isCollapsed: false });
    this.frame = frame;
    this.shape = shape;
    this.bounded = bounded;
    if (!bounded) this.children = [];
    this.children.forEach((child) => this.remember(child));
  }

  override get rectangle(): Rectangle {
    return this.frame ?? super.rectangle;
  }
  override get collisionBox(): CollisionBox {
    if (!this.frame) return super.collisionBox;
    if (this.shape === "rectangle") return new CollisionBox(this.frame.getBoundingLines());
    const center = this.frame.center,
      radius = Math.min(this.frame.width, this.frame.height) / 2;
    const points = Array.from({ length: 65 }, (_, i) =>
      center.add(new Vector(Math.cos((i * Math.PI) / 32), Math.sin((i * Math.PI) / 32)).multiply(radius)),
    );
    return new CollisionBox(points.slice(1).map((point, i) => new Line(points[i], point)));
  }
  override containsContentPoint(location: Vector): boolean {
    return this.bounded && doodleContainsPoint(this.frame, this.shape, location);
  }

  override acceptsChild = (child: Entity): boolean =>
    this.bounded &&
    child !== this &&
    !tree(child).some((member) => member instanceof Doodle && member.bounded) &&
    fitDoodleBounds(this.frame, this.shape, child.collisionBox.getRectangle()) !== null;

  override validateNewChild = (target: Section, child: Entity): void => {
    let box = child.collisionBox.getRectangle();
    let current: Section | null = target;
    let replaced: Entity = child;
    while (current && current !== this) {
      const rects = current.children
        .filter((entity) => entity !== replaced)
        .map((entity) => entity.collisionBox.getRectangle());
      box = Rectangle.getBoundingRectangle([...rects, box], 30);
      box.size.x = Math.max(box.size.x, getTextSize(current.text, Renderer.FONT_SIZE).x + Renderer.NODE_PADDING * 2);
      const titleHeight = current.text ? 50 : 0;
      box.location = box.location.subtract(new Vector(0, titleHeight));
      box.size.y += titleHeight;
      replaced = current;
      current = current.parentSection;
    }
    if (!fitDoodleBounds(this.frame, this.shape, box)) throw new Error("新节点会使内部组超出容器，请先扩大容器边界");
  };

  private remember(root: Entity) {
    for (const entity of tree(root)) {
      const fields: Record<string, unknown> = {};
      for (const key of editableKeys)
        if (key in entity) fields[key] = serialize((entity as unknown as Record<string, unknown>)[key]);
      this.accepted.set(entity, { geometry: serialize(entity.collisionBox), fields });
    }
  }

  override constrainChild = (child: Entity): void => {
    if (!this.bounded) return;
    let root = child;
    const visited = new Set<Entity>();
    while (root.parentSection && root.parentSection !== this && !visited.has(root)) {
      visited.add(root);
      root = root.parentSection;
    }
    const members = tree(root);
    const delta = fitDoodleBounds(this.frame, this.shape, root.collisionBox.getRectangle());
    if (delta) {
      if (delta.x || delta.y) translateClipboardEntities(members, delta);
      this.remember(root);
      return;
    }
    if (!members.every((member) => this.accepted.has(member)))
      throw new Error("节点放不进固定容器，请先点击边框并扩大容器");
    for (const member of members) {
      const state = this.accepted.get(member)!;
      for (const [key, value] of Object.entries(state.fields))
        (member as unknown as Record<string, unknown>)[key] = deserialize(structuredClone(value), this.project);
      if (!(member instanceof Section))
        member.collisionBox = deserialize(structuredClone(state.geometry), this.project);
    }
    for (const member of members.toReversed()) if (member instanceof Section) member.adjustLocationAndSize();
    if (performance.now() - this.lastWarning > 1000) {
      toast.warning("已阻止超出容器的修改，请先扩大边界；节点原内容已保留");
      this.lastWarning = performance.now();
    }
  };

  override adjustLocationAndSize(): void {
    if (!this.frame || !this.bounded) return;
    for (const child of this.children) this.constrainChild?.(child);
  }

  adopt(child: Entity): void {
    if (!this.acceptsChild(child)) throw new Error("节点放不进固定容器，请先扩大边界");
    const delta = fitDoodleBounds(this.frame, this.shape, child.collisionBox.getRectangle())!;
    translateClipboardEntities(tree(child), delta);
    if (!this.children.includes(child)) this.children.push(child);
    child.parentSection = this;
    this.remember(child);
  }

  setBounded(bounded: boolean): void {
    if (this.bounded === bounded) return;
    this.bounded = bounded;
    if (!bounded) {
      for (const child of this.children) {
        child.parentSection = this.parentSection;
        if (this.parentSection && !this.parentSection.children.includes(child)) this.parentSection.children.push(child);
      }
      this.children = [];
    } else {
      this.captureEnclosed();
    }
  }

  captureEnclosed(): void {
    if (!this.bounded) return;
    const candidates = this.project.stageManager
      .getEntities()
      .filter((entity) => entity !== this && !entity.parentSection && this.acceptsChild(entity));
    for (const entity of candidates) {
      const delta = fitDoodleBounds(this.frame, this.shape, entity.collisionBox.getRectangle())!;
      if (Math.abs(delta.x) < 0.001 && Math.abs(delta.y) < 0.001) this.adopt(entity);
    }
  }

  resizeFrame(frame: Rectangle): void {
    if (
      ![frame.width, frame.height, frame.left, frame.top].every(Number.isFinite) ||
      frame.width < 40 ||
      frame.height < 40
    )
      throw new Error("图形宽高至少为40");
    const normalized =
      this.shape === "circle" ? new Rectangle(frame.location, Vector.same(Math.min(frame.width, frame.height))) : frame;
    const bounds = this.children.length
      ? Rectangle.getBoundingRectangle(this.children.map((child) => child.collisionBox.getRectangle()))
      : null;
    const delta = this.bounded && bounds ? fitDoodleBounds(normalized, this.shape, bounds) : Vector.getZero();
    if (!delta) throw new Error("边界不能小于内部节点，请扩大图形或先移出节点");
    this.frame = normalized;
    if (delta.x || delta.y) translateClipboardEntities(this.children.flatMap(tree), delta);
    this.children.forEach((child) => this.remember(child));
  }

  override rename(text: string): void {
    this.text = text;
  }
  override adjustChildrenStateByCollapse(parentCollapsed = false): void {
    this.isCollapsed = false;
    super.adjustChildrenStateByCollapse(parentCollapsed);
  }
  override translateClipboardGeometry(delta: Vector): void {
    this.frame = new Rectangle(this.frame.location.add(delta), this.frame.size.clone());
  }
  override move(delta: Vector): void {
    this.translateClipboardGeometry(delta);
    translateClipboardEntities(this.children.flatMap(tree), delta);
    this.children.forEach((child) => this.remember(child));
    this.updateFatherSectionByMove();
  }
  override moveTo(location: Vector): void {
    this.move(location.subtract(this.frame.location));
  }
}

export function captureNewDoodleEntity(project: Project, entity: Entity, doodleOnly = false): void {
  if (entity instanceof Doodle || entity.parentSection) return;
  const container = project.stage
    .filter(
      (object): object is Doodle => object instanceof Doodle && object.bounded && !object.isHiddenBySectionCollapse,
    )
    .filter(
      (object) =>
        object.containsContentPoint(entity.collisionBox.getRectangle().center) ||
        object.containsContentPoint(entity.collisionBox.getRectangle().location),
    )
    .sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0];
  if (container) {
    const target = project.sectionMethods.getInnermostSectionByLocation(entity.collisionBox.getRectangle().center);
    if (!doodleOnly && target && target !== container && boundedDoodleOf(target) === container)
      container.validateNewChild(target, entity);
    container.adopt(entity);
  }
}

export function boundedDoodleOf(entity: Entity): Doodle | null {
  let current = entity.parentSection;
  while (current) {
    if (current instanceof Doodle && current.bounded) return current;
    current = current.parentSection;
  }
  return null;
}

export function doodleAt(project: Project, location: Vector): Doodle | undefined {
  return project.stage
    .filter(
      (object): object is Doodle =>
        object instanceof Doodle &&
        object.bounded &&
        !object.isHiddenBySectionCollapse &&
        object.containsContentPoint(location),
    )
    .sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0];
}

export function containPastedEntities(project: Project, entities: Entity[], location: Vector): Rectangle | undefined {
  const boundary = doodleAt(project, location);
  if (!boundary) return;
  const contained = new Set(entities.flatMap((entity) => (entity instanceof Section ? entity.children : [])));
  const roots = entities.filter((entity) => !contained.has(entity));
  if (roots.some((entity) => !boundary.acceptsChild(entity)))
    throw new Error("内容放不进固定容器，或包含另一个固定容器；请在容器外粘贴或扩大边界");
  const bounds = Rectangle.getBoundingRectangle(roots.map((entity) => entity.collisionBox.getRectangle()));
  const delta = fitDoodleBounds(boundary.frame, boundary.shape, bounds);
  if (!delta) throw new Error("全部粘贴内容放不进容器，请先扩大边界");
  translateClipboardEntities(entities, delta);
  roots.forEach((entity) => boundary.adopt(entity));
  return new Rectangle(bounds.location.add(delta), bounds.size.clone());
}
