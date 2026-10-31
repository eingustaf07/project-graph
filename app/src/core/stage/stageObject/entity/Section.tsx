import type { Project } from "@/core/Project";
import { Renderer } from "@/core/render/canvas2d/renderer";
import { NodeMoveShadowEffect } from "@/core/service/feedbackService/effectEngine/concrete/NodeMoveShadowEffect";
import { Settings } from "@/core/service/Settings";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { getTextSize } from "@/utils/font";
import { Color, ProgressNumber, Vector } from "@graphif/data-structures";
import { id, deserialize, serialize, passExtraAtArg1, passObject, serializable } from "@graphif/serializer";
import { Line, Rectangle, Shape } from "@graphif/shapes";
import { Value } from "platejs";
import { doodleContainsPoint, fitDoodleBounds, type DoodleShape } from "@/core/algorithm/doodleBounds";
import { translateClipboardEntities } from "@/core/service/dataManageService/copyEngine/clipboardPosition";
import type { EraserMark } from "@/core/algorithm/eraserGeometry";
import { toast } from "sonner";

@passExtraAtArg1
@passObject
export class Section extends ConnectableEntity {
  readonly isDoodle: boolean = false;
  constrainChild?: (child: Entity) => void;
  acceptsChild?: (child: Entity) => boolean;
  validateNewChild?: (target: Section, child: Entity) => void;
  containsContentPoint(location: Vector): boolean {
    return this.rectangle.isPointIn(location);
  }
  /**
   * 节点是否被选中
   */
  _isSelected: boolean = false;
  @id
  @serializable
  public uuid: string;
  _isEditingTitle: boolean = false;
  private _collisionBoxWhenCollapsed: CollisionBox;
  @serializable
  private _collisionBoxNormal: CollisionBox;

  public get isEditingTitle() {
    return this._isEditingTitle;
  }
  public set isEditingTitle(value: boolean) {
    this._isEditingTitle = value;
    this.project.sectionRenderer.render(this);
  }

  /**
   * 小于多少的情况下，开始渲染大标题
   */
  static bigTitleCameraScale = 0.2;

  public get collisionBox(): CollisionBox {
    if (this.isCollapsed) {
      return this._collisionBoxWhenCollapsed;
    } else if (this.locked) {
      // 锁定状态下使用整个矩形作为碰撞箱
      return new CollisionBox([this.rectangle]);
    } else {
      return this._collisionBoxNormal;
    }
  }

  /** 获取折叠状态下的碰撞箱 */
  private collapsedCollisionBox(): CollisionBox {
    const centerLocation = this._collisionBoxNormal.getRectangle().center;
    const collapsedRectangleSize = getTextSize(this.text, Renderer.FONT_SIZE).add(
      Vector.same(Renderer.NODE_PADDING).multiply(2),
    );
    const collapsedRectangle = new Rectangle(
      centerLocation.clone().subtract(collapsedRectangleSize.multiply(0.5)),
      collapsedRectangleSize,
    );
    return new CollisionBox([collapsedRectangle]);
  }

  @serializable
  color: Color = Color.Transparent;
  @serializable
  text: string;
  @serializable
  children: Entity[];

  /** 是否是折叠状态 */
  @serializable
  isCollapsed: boolean;
  /**
   * 是否锁定 Section 内部物体
   * 当 locked 为 true 时，Section 内部的所有物体都不能移动或删除
   */
  @serializable
  locked: boolean = false;
  /**
   * 边框样式：实线、虚线、无边框
   */
  @serializable
  borderStyle: "solid" | "dashed" | "none" = "solid";
  isHiddenBySectionCollapse = false;

  constructor(
    protected readonly project: Project,
    {
      uuid = crypto.randomUUID() as string,
      text = "",
      collisionBox = new CollisionBox([new Rectangle(new Vector(0, 0), new Vector(0, 0))]),
      _collisionBoxNormal: collisionBoxNormal = undefined as CollisionBox | undefined,
      color = Color.Transparent,
      locked = false,
      isCollapsed = false,
      children = [] as Entity[],
      details = [] as Value,
      borderStyle = "solid" as "solid" | "dashed" | "none",
    } = {},
    public unknown = false,
  ) {
    super();
    this.uuid = uuid;

    if (collisionBoxNormal) {
      // 从序列化数据恢复：直接使用保存的 _collisionBoxNormal（含正确位置）
      this._collisionBoxNormal = collisionBoxNormal;
    } else {
      // 新建：从 collisionBox 参数构建 _collisionBoxNormal
      const rect = collisionBox.getRectangle();
      const shapes: Shape[] = rect.getBoundingLines();
      this._collisionBoxNormal = new CollisionBox(shapes);
    }
    this._collisionBoxWhenCollapsed = collisionBox;

    this.color = color;
    this.text = text;
    this.locked = locked;
    this.isCollapsed = isCollapsed;
    this.details = details;
    this.children = children;
    this.borderStyle = borderStyle;
    // 一定要放在最后
    this.adjustLocationAndSize();
  }

  /**
   * 根据多个实体创建Section
   * @param entities
   */
  static fromEntities(project: Project, entities: Entity[]): Section {
    const section = new Section(project, {
      text: "section",
      children: entities,
      borderStyle: Settings.sectionInitBorderStyle,
    });

    return section;
  }

  rename(newName: string) {
    this.text = newName;
    this.adjustLocationAndSize();
  }

  /**
   * 根据子内容 自动调整分组框的位置和大小
   * 如果没有子内容，则
   *   自动调整大小为 标题+padding，位置为 当前碰撞箱外接矩形的左上角
   */
  adjustLocationAndSize() {
    let rectangle: Rectangle;
    const titleSize = getTextSize(this.text, Renderer.FONT_SIZE);

    const titleBarHeight = this.text === "" ? 0 : 50;

    if (this.children.length === 0) {
      rectangle = new Rectangle(
        this.collisionBox.getRectangle().location,
        new Vector(Math.max(titleSize.x + Renderer.NODE_PADDING * 2, 100), 100),
      );
    } else {
      // 调整展开状态
      rectangle = Rectangle.getBoundingRectangle(
        this.children.map((child) => child.collisionBox.getRectangle()),
        30,
      );
      rectangle.size.x = Math.max(rectangle.size.x, titleSize.x + Renderer.NODE_PADDING * 2);
      // 留白范围在上面调整
      rectangle.location = rectangle.location.subtract(new Vector(0, titleBarHeight));
      rectangle.size = rectangle.size.add(new Vector(0, titleBarHeight));
    }

    this._collisionBoxNormal.shapes = rectangle.getBoundingLines();
    // 群友需求：希望分组框扩大交互范围，标题也能拖动
    if (titleBarHeight > 0) {
      const newRect = new Rectangle(rectangle.location.clone(), new Vector(rectangle.size.x, titleBarHeight));
      this._collisionBoxNormal.shapes.push(newRect);
    }
    // 调整折叠状态
    this._collisionBoxWhenCollapsed = this.collapsedCollisionBox();
  }
  /**
   * 根据自身的折叠状态调整子节点的状态
   * 以屏蔽触碰和显示
   */
  adjustChildrenStateByCollapse(parentCollapsed = false) {
    const shouldHide = parentCollapsed || this.isCollapsed;
    if (shouldHide) {
      this.children.forEach((child) => {
        child.isHiddenBySectionCollapse = true;
        if (child instanceof Section) {
          child.adjustChildrenStateByCollapse(true);
        }
      });
    } else {
      this.children.forEach((child) => {
        if (child instanceof Section) {
          child.adjustChildrenStateByCollapse(false);
        }
      });
    }
  }

  /**
   * 获取节点的选中状态
   */
  public get isSelected() {
    return this._isSelected;
  }
  public set isSelected(value: boolean) {
    this._isSelected = value;
  }

  /**
   * 只读，获取节点的矩形
   * 若要修改节点的矩形，请使用 moveTo等 方法
   */
  public get rectangle(): Rectangle {
    if (this.isCollapsed) {
      return this._collisionBoxWhenCollapsed.getRectangle();
    } else {
      const topLine: Line = this._collisionBoxNormal.shapes[0] as Line;
      const rightLine: Line = this._collisionBoxNormal.shapes[1] as Line;
      const bottomLine: Line = this._collisionBoxNormal.shapes[2] as Line;
      const leftLine: Line = this._collisionBoxNormal.shapes[3] as Line;
      return new Rectangle(
        new Vector(leftLine.start.x, topLine.start.y),
        new Vector(rightLine.end.x - leftLine.start.x, bottomLine.end.y - topLine.start.y),
      );
    }
  }

  public get geometryCenter() {
    return this.rectangle.location.clone().add(this.rectangle.size.clone().multiply(0.5));
  }

  /** Translate a detached clipboard section without moving its children a second time. */
  translateClipboardGeometry(delta: Vector): void {
    for (const box of new Set([this._collisionBoxNormal, this._collisionBoxWhenCollapsed])) {
      for (const shape of box.shapes) {
        if (shape instanceof Line) {
          shape.start = shape.start.add(delta);
          shape.end = shape.end.add(delta);
        } else if (shape instanceof Rectangle) {
          shape.location = shape.location.add(delta);
        }
      }
    }
  }

  move(delta: Vector): void {
    // 让自己移动
    for (const shape of this.collisionBox.shapes) {
      if (shape instanceof Line) {
        shape.start = shape.start.add(delta);
        shape.end = shape.end.add(delta);
      } else if (shape instanceof Rectangle) {
        shape.location = shape.location.add(delta);
      }
    }
    // 让内部元素也移动
    for (const child of this.children) {
      // 跳过已被选中的子元素，避免重复移动（解决速度叠加bug）
      if (child.isSelected) {
        continue;
      }
      child.move(delta);
    }

    // 移动雪花特效
    if (!this.isHiddenBySectionCollapse) {
      this.project.effects.addEffect(new NodeMoveShadowEffect(new ProgressNumber(0, 30), this.rectangle, delta));
    }
    this.updateFatherSectionByMove();
    // 移动其他实体，递归碰撞
    this.updateOtherEntityLocationByMove();
  }
  protected override collideWithOtherEntity(other: Entity): void {
    if (!Settings.isEnableEntityCollision) {
      return;
    }
    if (other instanceof Section) {
      if (this.project.sectionMethods.isEntityInSection(this, other)) {
        return;
      }
    }
    if (this.project.sectionMethods.isEntityInSection(other, this)) {
      return;
    }
    super.collideWithOtherEntity(other);
  }

  /**
   * 将某个物体 的最小外接矩形的左上角位置 移动到某个位置
   * @param location
   */
  moveTo(location: Vector): void {
    const currentLeftTop = this.rectangle.location;
    const delta = location.clone().subtract(currentLeftTop);
    this.move(delta);
    this.updateFatherSectionByMove();
  }
}

// Keep the derived class after its base: the production module graph contains circular model imports.
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
  "erasures",
];
type DoodleOptions = NonNullable<ConstructorParameters<typeof Section>[1]> & {
  frame?: Rectangle;
  shape?: DoodleShape;
  bounded?: boolean;
  erasures?: EraserMark[];
};

@passExtraAtArg1
@passObject
export class Doodle extends Section {
  @serializable override erasures: EraserMark[];
  override get eraserBounds(): Rectangle {
    return this.frame;
  }
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
      erasures = [],
      ...options
    }: DoodleOptions = {},
  ) {
    super(project, { ...options, isCollapsed: false });
    this.frame = frame;
    this.shape = shape;
    this.bounded = bounded;
    this.erasures = erasures;
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
