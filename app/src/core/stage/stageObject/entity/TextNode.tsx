import { creationGridGap } from "@/core/algorithm/creationGrid";
import { layoutTable } from "@/core/algorithm/tableLayout";
import type { Project } from "@/core/Project";
import { Renderer } from "@/core/render/canvas2d/renderer";
import { NodeMoveShadowEffect } from "@/core/service/feedbackService/effectEngine/concrete/NodeMoveShadowEffect";
import { Settings } from "@/core/service/Settings";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import type { ResizeAble } from "@/core/stage/stageObject/abstract/StageObjectInterface";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { fitDoodleBounds } from "@/core/algorithm/doodleBounds";
import { nearestFreeTranslation } from "@/core/algorithm/entityClearance";
import { Section, boundedDoodleOf } from "@/core/stage/stageObject/entity/Section";
import { getMultiLineTextSize, getTextSize } from "@/utils/font";
import { Color, ProgressNumber, Vector } from "@graphif/data-structures";
import { id, passExtraAtArg1, passObject, serializable } from "@graphif/serializer";
import { Rectangle } from "@graphif/shapes";
import type { Value } from "platejs";

/**
 *
 * 文字节点类
 * 2024年10月20日：Node 改名为 TextNode，防止与 原生 Node 类冲突
 */
@passExtraAtArg1
@passObject
export class TextNode extends ConnectableEntity implements ResizeAble {
  @id
  @serializable
  uuid: string;
  @serializable
  text: string;
  @serializable
  isTable?: boolean;
  @serializable
  public collisionBox: CollisionBox;
  @serializable
  color: Color = Color.Transparent;

  /**
   * 字体缩放级别，整数，基准值为0，对应默认字体大小
   * 计算公式：finalFontSize = Renderer.FONT_SIZE * Math.pow(2, fontScaleLevel)
   */
  @serializable
  public fontScaleLevel: number = 0;

  public static enableResizeCharCount = 20;

  /**
   * 调整大小的模式
   * auto：自动缩紧
   * manual：手动调整宽度，高度自动撑开。
   */
  @serializable
  public sizeAdjust: string = "auto";

  /**
   * 自定义字体，空字符串表示使用默认字体
   */
  @serializable
  public fontFamily: string = "";

  /**
   * 自定义字重，空字符串表示使用 normal
   */
  @serializable
  public fontWeight: string = "";

  /**
   * 边框样式：实线、虚线、无边框
   */
  @serializable
  public borderStyle: "solid" | "dashed" | "none" = "solid";

  /**
   * 节点是否被选中
   */
  _isSelected: boolean = false;

  /**
   * 获取节点的选中状态
   */
  public get isSelected() {
    return this._isSelected;
  }

  /**
   * 只读，获取节点的矩形
   * 若要修改节点的矩形，请使用 moveTo等 方法
   */
  public get rectangle(): Rectangle {
    return this.collisionBox.shapes[0] as Rectangle;
  }

  public get geometryCenter() {
    return this.rectangle.location.clone().add(this.rectangle.size.clone().multiply(0.5));
  }

  public set isSelected(value: boolean) {
    super.isSelected = value;
  }

  /**
   * 是否在编辑文字，编辑时不渲染文字
   */
  _isEditing: boolean = false;

  public get isEditing() {
    return this._isEditing;
  }

  public set isEditing(value: boolean) {
    this._isEditing = value;
    this.project.textNodeRenderer.renderTextNode(this);
    // 再主动渲染一次，确保即使渲染引擎停止，文字也能显示出来
  }
  isHiddenBySectionCollapse = false;

  constructor(
    protected readonly project: Project,
    {
      uuid = crypto.randomUUID() as string,
      text = "",
      details = [],
      crossFileLinks,
      collisionBox = new CollisionBox([new Rectangle(Vector.getZero(), Vector.getZero())]),
      color = Color.Transparent,
      sizeAdjust = "auto",
      fontScaleLevel = 0,
      fontFamily = "",
      fontWeight = "",
      borderStyle = "solid" as "solid" | "dashed" | "none",
      isTable,
    }: {
      uuid?: string;
      text?: string;
      details?: Value;
      crossFileLinks?: ConnectableEntity["crossFileLinks"];
      color?: Color;
      sizeAdjust?: "auto" | "manual";
      collisionBox?: CollisionBox;
      fontScaleLevel?: number;
      fontFamily?: string;
      fontWeight?: string;
      borderStyle?: "solid" | "dashed" | "none";
      isTable?: boolean;
    },
    public unknown = false,
  ) {
    super(crossFileLinks);
    this.uuid = uuid;
    this.text = text;
    this.details = details;
    this.collisionBox = collisionBox;
    this.color = color;
    this.sizeAdjust = sizeAdjust;
    this.fontScaleLevel = fontScaleLevel;
    this.fontFamily = fontFamily;
    this.fontWeight = fontWeight;
    this.borderStyle = borderStyle;
    // Ordinary nodes keep their existing serialized shape. MessagePack converts
    // explicit undefined fields to null, so only table nodes carry this marker.
    if (isTable === true) this.isTable = true;
    else delete this.isTable;
    // 初始化字体大小缓存
    this.updateFontSizeCache();
    // if (this.text.length < TextNode.enableResizeCharCount) {
    //   this.adjustSizeByText();
    // }
    if (this.sizeAdjust === "auto") {
      this.adjustSizeByText();
    } else if (this.sizeAdjust === "manual") {
      this.resizeHandle(Vector.getZero());
    }
  }

  /**
   * 字体大小缓存，避免重复计算
   */
  private fontSizeCache: number = Renderer.FONT_SIZE;

  /**
   * 获取当前字体大小
   */
  public getFontSize(): number {
    return this.fontSizeCache;
  }

  /**
   * 动态内边距，与字体大小等比缩放
   */
  public getPadding(): number {
    return (this.fontSizeCache / Renderer.FONT_SIZE) * Renderer.NODE_PADDING;
  }

  /**
   * 动态边框粗细，与字体大小等比缩放，基准为 2px
   */
  public getBorderWidth(): number {
    return (this.fontSizeCache / Renderer.FONT_SIZE) * 2;
  }

  /**
   * 动态圆角半径，与字体大小等比缩放
   */
  public getBorderRadius(): number {
    return (this.fontSizeCache / Renderer.FONT_SIZE) * Renderer.NODE_ROUNDED_RADIUS;
  }

  /**
   * 更新字体大小缓存
   * fontScaleLevel 存储的是"半个级别"，所以计算时要除以 2
   * 这样步长就是 0.5，避免了浮点数精度问题
   */
  private updateFontSizeCache(): void {
    this.fontSizeCache = Renderer.FONT_SIZE * 2 ** (this.fontScaleLevel / 2);
    if (this.fontSizeCache >= 2) {
      // 确保指数变化的过程中字体不会变小到0
      this.fontSizeCache = Math.floor(this.fontSizeCache);
    }
  }

  public setFontScaleLevel(level: number) {
    this.fontScaleLevel = level;
    this.updateFontSizeCache();
    if (this.sizeAdjust === "auto") {
      this.adjustSizeByText();
    } else if (this.sizeAdjust === "manual") {
      this.resizeHandle(Vector.getZero());
    }
  }

  /**
   * 放大字体
   * @param anchorRate 可选。缩放时保持固定的锚点（矩形内比例，如 (0.5,0.5) 为中心）。不传则保持左上角不变。
   */
  public increaseFontSize(anchorRate?: Vector): void {
    this.fontScaleLevel++;
    this.updateFontSizeCache();
    if (this.sizeAdjust === "auto") {
      const oldRect = this.rectangle.clone();
      this.adjustSizeByText();
      if (anchorRate) {
        this._adjustLocationToKeepAnchor(oldRect, anchorRate);
      }
    } else if (this.sizeAdjust === "manual") {
      this.resizeHandle(Vector.getZero());
      if (anchorRate) {
        const oldRect = this.rectangle.clone();
        this._adjustLocationToKeepAnchor(oldRect, new Vector(anchorRate.x, 0));
      }
    }
  }

  /**
   * 缩小字体
   * @param anchorRate 可选。缩放时保持固定的锚点（矩形内比例）。不传则保持左上角不变。
   */
  public decreaseFontSize(anchorRate?: Vector): void {
    this.fontScaleLevel--;
    this.updateFontSizeCache();
    if (this.sizeAdjust === "auto") {
      const oldRect = this.rectangle.clone();
      this.adjustSizeByText();
      if (anchorRate) {
        this._adjustLocationToKeepAnchor(oldRect, anchorRate);
      }
    } else if (this.sizeAdjust === "manual") {
      this.resizeHandle(Vector.getZero());
      if (anchorRate) {
        const oldRect = this.rectangle.clone();
        this._adjustLocationToKeepAnchor(oldRect, new Vector(anchorRate.x, 0));
      }
    }
  }

  /**
   * 在尺寸已变更后，根据旧矩形和锚点比例调整 location，使锚点在世界坐标中保持不变
   */
  private _adjustLocationToKeepAnchor(oldRect: Rectangle, anchorRate: Vector): void {
    const newSize = this.rectangle.size;
    const locationDelta = new Vector(
      (oldRect.size.x - newSize.x) * anchorRate.x,
      (oldRect.size.y - newSize.y) * anchorRate.y,
    );
    this.moveTo(oldRect.location.clone().add(locationDelta));
  }

  /**
   * 调整后的矩形是当前文字加了一圈padding之后的大小
   */
  private tableLayoutCache?: {
    text: string;
    fontSize: number;
    family: string;
    weight: string;
    width?: number;
    layout: ReturnType<typeof layoutTable>;
  };

  getTableLayout() {
    const width = this.sizeAdjust === "manual" ? this.rectangle.width : undefined;
    const family = this.fontFamily || Settings.defaultFontFamily;
    const cached = this.tableLayoutCache;
    if (
      !cached ||
      cached.text !== this.text ||
      cached.fontSize !== this.getFontSize() ||
      cached.family !== family ||
      cached.weight !== this.fontWeight ||
      cached.width !== width
    )
      this.tableLayoutCache = {
        text: this.text,
        fontSize: this.getFontSize(),
        family,
        weight: this.fontWeight,
        width,
        layout: layoutTable(this.text, this.getFontSize(), this.getPadding(), family, this.fontWeight, width),
      };
    return this.tableLayoutCache!.layout;
  }

  private adjustSizeByText() {
    if (this.isTable) {
      const layout = this.getTableLayout();
      this.collisionBox.shapes[0] = new Rectangle(
        this.rectangle.location.clone(),
        new Vector(layout.width, layout.height),
      );
    } else {
      const naturalSize = getMultiLineTextSize(
        this.text,
        this.getFontSize(),
        1.5,
        undefined,
        this.fontFamily,
        this.fontWeight,
      );
      const width = Math.min(naturalSize.x, this.getAutoMaxTextWidth());
      const wrappedSize = getMultiLineTextSize(
        this.text,
        this.getFontSize(),
        1.5,
        width,
        this.fontFamily,
        this.fontWeight,
      );
      this.collisionBox.shapes[0] = new Rectangle(
        this.rectangle.location.clone(),
        new Vector(width, wrappedSize.y).add(Vector.same(this.getPadding()).multiply(2)),
      );
    }
    this.constrainToFixedBoundary();
    this.resolveOverlaps();
    this.lastAutoSize = {
      text: this.text,
      fontSize: this.getFontSize(),
      fontFamily: this.fontFamily || Settings.defaultFontFamily,
      fontWeight: this.fontWeight || "normal",
      maxCharWidth: Settings.textNodeMaxCharWidth,
      width: this.rectangle.width,
      height: this.rectangle.height,
      isTable: this.isTable,
    };
  }

  private lastAutoSize?: {
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    maxCharWidth: number;
    width: number;
    height: number;
    isTable?: boolean;
  };

  public refreshSizeByTextIfNeeded(): void {
    const previous = this.lastAutoSize;
    // Panning refreshes the whole stage. Unchanged nodes must not re-wrap text or run collision propagation.
    if (
      previous &&
      previous.isTable === this.isTable &&
      previous.text === this.text &&
      previous.fontSize === this.getFontSize() &&
      previous.fontFamily === (this.fontFamily || Settings.defaultFontFamily) &&
      previous.fontWeight === (this.fontWeight || "normal") &&
      previous.maxCharWidth === Settings.textNodeMaxCharWidth &&
      previous.width === this.rectangle.width &&
      previous.height === this.rectangle.height
    )
      return;
    this.adjustSizeByText();
  }

  public resolveOverlaps(updateParents = true) {
    // 构造和剪贴板反序列化时尚未加入舞台，不能挤动现有节点。
    if (!this.project.stage?.includes(this)) return;
    if (updateParents) this.updateFatherSectionByMove();
    this.updateOtherEntityLocationByMove();
  }

  public getAutoMaxTextWidth(): number {
    return getTextSize("中", this.getFontSize(), this.fontFamily, this.fontWeight).x * Settings.textNodeMaxCharWidth;
  }

  public getTextWrapWidth(): number {
    return Math.max(0, this.rectangle.size.x - this.getPadding() * 2);
  }
  private adjustHeightByText() {
    if (this.isTable) {
      this.adjustSizeByText();
      return;
    }
    const wrapWidth = this.rectangle.size.x - this.getPadding() * 2;
    const newTextSize = this.project.textRenderer.measureMultiLineTextSize(
      this.text,
      this.getFontSize(),
      wrapWidth,
      1.5,
      this.fontFamily,
      this.fontWeight,
    );
    this.collisionBox.shapes[0] = new Rectangle(
      this.rectangle.location.clone(),
      new Vector(this.rectangle.size.x, newTextSize.y + this.getPadding() * 2),
    );
    this.updateFatherSectionByMove();
    if (this.project.stage?.includes(this)) this.updateOtherEntityLocationByMove();
  }
  /**
   * 强制触发自动调整大小
   */
  public forceAdjustSizeByText() {
    this.adjustSizeByText();
  }

  /**
   * 强制触发手动模式下的高度调整
   */
  public forceAdjustHeightByText() {
    this.adjustHeightByText();
  }

  // private adjustSizeByTextWidthLimitWidth(width: number) {
  //   const currentSize = this.project.textRenderer.measureMultiLineTextSize(this.text, Renderer.FONT_SIZE, width, 1.5);
  //   this.collisionBox.shapes[0] = new Rectangle(
  //     this.rectangle.location.clone(),
  //     currentSize.clone().add(Vector.same(Renderer.NODE_PADDING).multiply(2)),
  //   );
  // }

  rename(text: string) {
    this.text = text;
    // if (this.text.length < TextNode.enableResizeCharCount) {
    //   this.adjustSizeByText();
    // }
    if (this.sizeAdjust === "auto") {
      this.adjustSizeByText();
    } else if (this.sizeAdjust === "manual") {
      this.adjustHeightByText();
    }
    // 向孪生兄弟同步 text（_isSyncing 为 true 时说明自己正在被同步写入，跳过避免循环）
    if (!this._isSyncing) {
      this.project.syncAssociationManager.syncFrom(this, "text");
    }
  }

  resizeHandle(delta: Vector) {
    const currentRect: Rectangle = this.collisionBox.shapes[0] as Rectangle;
    const newRectangle = currentRect.clone();
    // todo：宽度能自定义控制，但是高度不能
    const newSize = newRectangle.size.add(delta);
    newSize.x = Math.max(75, newSize.x);
    if (this.isTable) {
      this.collisionBox.shapes[0] = new Rectangle(currentRect.location.clone(), newSize);
      this.adjustSizeByText();
      return;
    }
    const newTextSize = this.project.textRenderer.measureMultiLineTextSize(
      this.text,
      this.getFontSize(),
      newSize.x - this.getPadding() * 2,
      1.5,
    );
    newSize.y = newTextSize.y + this.getPadding() * 2;
    newRectangle.size = newSize;

    this.collisionBox.shapes[0] = newRectangle;
    this.updateFatherSectionByMove();
    if (this.project.stage?.includes(this)) this.updateOtherEntityLocationByMove();
  }

  resizeWidthTo(width: number) {
    const currentWidth = this.rectangle.size.x;
    this.resizeHandle(new Vector(width - currentWidth, 0));
  }

  getResizeHandleRect(): Rectangle {
    const rect = this.collisionBox.getRectangle();
    return new Rectangle(rect.rightTop, new Vector(25, rect.size.y));
  }

  /**
   * 将某个物体移动一小段距离
   * @param delta
   */
  move(delta: Vector) {
    const newRectangle = this.rectangle.clone();
    newRectangle.location = newRectangle.location.add(delta);
    this.collisionBox.shapes[0] = newRectangle;

    // 移动雪花特效
    if (!this.isHiddenBySectionCollapse) {
      this.project.effects.addEffect(new NodeMoveShadowEffect(new ProgressNumber(0, 30), this.rectangle, delta));
    }
    this.updateFatherSectionByMove();
    // 移动其他实体，递归碰撞
    this.updateOtherEntityLocationByMove();
  }

  private static readonly activeCollisions = new WeakSet<Project>();
  public resolveNonTextDragCollisions() {
    if (!this.shouldResolveEntityCollisions || boundedDoodleOf(this)) return;
    for (const other of this.project.stageManager.getEntities())
      if (
        !(other instanceof TextNode) &&
        !other.nearestLockedAncestorSection &&
        !(other instanceof Section && other.locked)
      )
        this.collideWithOtherEntity(other);
  }

  protected override updateOtherEntityLocationByMove(): void {
    if (this.project.entityMoveManager?.trackTextMove(this)) return;
    if (!this.shouldResolveEntityCollisions || TextNode.activeCollisions.has(this.project)) return;
    TextNode.activeCollisions.add(this.project);
    try {
      const boundary = boundedDoodleOf(this);
      const candidates = this.project.entityMoveManager?.collisionCandidates(this);
      const entities = candidates ?? this.project.stageManager.getEntities();
      // Move groups first: moving a group can also move its text children.
      if (!boundary) {
        for (const other of entities) {
          if (!(other instanceof TextNode)) this.collideWithOtherEntity(other);
        }
      }
      const anchor = this.rectangle;
      for (const other of entities) {
        if (!(other instanceof TextNode) || other === this || other.nearestLockedAncestorSection) continue;
        if (!anchor.isCollideWith(other.rectangle) || boundedDoodleOf(other) !== boundary) continue;
        const obstacles: Rectangle[] = [];
        for (const item of candidates ? this.project.stageManager.getEntities() : entities) {
          if (item === other || boundedDoodleOf(item) !== boundary) continue;
          if (item instanceof Section && (item.isDoodle || this.project.sectionMethods.isEntityInSection(other, item)))
            continue;
          obstacles.push(item instanceof TextNode ? item.rectangle : item.collisionBox.getRectangle());
        }
        const delta = nearestFreeTranslation(
          other.rectangle,
          obstacles,
          (candidate) =>
            (!boundary || !!fitDoodleBounds(boundary.frame, boundary.shape, candidate)?.isZero()) &&
            (this.project.entityMoveManager?.allowsCollisionPlacement(boundary, other.rectangle, candidate) ?? true),
          creationGridGap(this.project),
        );
        if (delta) other.move(delta);
      }
    } finally {
      TextNode.activeCollisions.delete(this.project);
    }
  }

  protected override collideWithOtherEntity(other: Entity): void {
    if (!Settings.isEnableEntityCollision) {
      return;
    }
    if (other instanceof Section) {
      // 如果碰撞的东西是一个section
      // 如果自己是section的子节点，则不移动
      if (this.project.sectionMethods.isEntityInSection(this, other)) {
        return;
      }
    }
    super.collideWithOtherEntity(other);
  }

  /**
   * 将某个物体 的最小外接矩形的左上角位置 移动到某个位置
   * @param location
   */
  moveTo(location: Vector) {
    const newRectangle = this.rectangle.clone();
    newRectangle.location = location.clone();
    this.collisionBox.shapes[0] = newRectangle;
    this.updateFatherSectionByMove();
    this.updateOtherEntityLocationByMove();
  }
}
