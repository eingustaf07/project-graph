import { Project, service } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { EntityJumpMoveEffect } from "@/core/service/feedbackService/effectEngine/concrete/EntityJumpMoveEffect";
import { RectanglePushInEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectanglePushInEffect";
import { SoundService } from "@/core/service/feedbackService/SoundService";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { ContainerNodeDrag } from "./ContainerNodeDrag";
import type { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import type { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { DragCollisionIndex } from "./DragCollisionIndex";
import type { Section } from "@/core/stage/stageObject/entity/Section";

/**
 * 管理节点的位置移动
 * 不仅仅有鼠标拖动的移动，还有对齐造成的移动
 * 还要处理节点移动后，对Section大小造成的影响
 * 以后还可能有自动布局的功能
 */
@service("entityMoveManager")
export class EntityMoveManager {
  public isMovingWithinContainer = false;
  private containerDrag?: ContainerNodeDrag;
  private pointerMoving = false;
  private collisionIndex?: DragCollisionIndex;
  private collisionIndexDirty = false;
  private translatingBatch = false;
  private pendingParents = new Set<Section>();

  deferParentUpdate(entity: Entity) {
    if (!this.translatingBatch) return false;
    for (let parent = entity.parentSection; parent; parent = parent.parentSection) this.pendingParents.add(parent);
    return true;
  }

  trackTextMove(node: TextNode) {
    this.collisionIndex?.update(node);
    return this.translatingBatch;
  }

  collisionCandidates(node: TextNode) {
    if (this.collisionIndex && this.collisionIndexDirty) {
      this.collisionIndex = new DragCollisionIndex(this.project.stageManager.getEntities());
      this.collisionIndexDirty = false;
    }
    return this.collisionIndex?.query(node);
  }

  invalidateCollisionIndex() {
    this.collisionIndexDirty = true;
  }

  private moveBatch(entities: Entity[], delta: Vector, adjustSections = true) {
    if (entities.length <= 1) {
      for (const entity of entities) this.moveEntityUtils(entity, delta, adjustSections);
      return;
    }
    try {
      this.translatingBatch = true;
      for (const entity of entities) this.moveEntityUtils(entity, delta, adjustSections);
      this.translatingBatch = false;
      const wasMoving = this.isMovingWithinContainer;
      this.isMovingWithinContainer = true;
      try {
        const parents = [...this.pendingParents].sort((a, b) => b.sectionDepth - a.sectionDepth);
        for (const parent of parents) {
          parent.adjustLocationAndSize();
          let fixed = parent.parentSection;
          while (fixed && !fixed.constrainChild) fixed = fixed.parentSection;
          if (!parent.constrainChild && !fixed) this.project.sectionCollisionSolver.solveOverlaps(parent);
        }
      } finally {
        this.isMovingWithinContainer = wasMoving;
      }
      if (Settings.isEnableEntityCollision && !this.ignoresDragCollisions) {
        this.collisionIndex = new DragCollisionIndex(this.project.stageManager.getEntities());
        this.collisionIndexDirty = false;
        for (const entity of entities) if (entity instanceof TextNode) entity.resolveOverlaps(false);
      }
    } finally {
      this.translatingBatch = false;
      this.collisionIndex = undefined;
      this.collisionIndexDirty = false;
      this.pendingParents.clear();
    }
  }

  get ignoresDragCollisions() {
    return this.pointerMoving && this.project.controller.pressingKeySet.has("v");
  }

  private duringPointerMovement(move: () => void) {
    this.pointerMoving = true;
    try {
      move();
    } finally {
      this.pointerMoving = false;
    }
  }

  dragSelection(delta: Vector, withTree: boolean) {
    this.duringPointerMovement(() => {
      if (withTree) this.moveEntitiesWithChildren(delta);
      else this.moveSelectedEntities(delta);
    });
  }

  alignAfterPointerDrag() {
    this.duringPointerMovement(() => {
      if (Settings.enableDragAutoAlign) this.project.autoAlign.alignAllSelected();
      if (Settings.enableDragAlignToGrid) this.project.autoAlign.alignAllSelectedToGrid();
    });
  }

  beginPointerDrag(clicked: Entity) {
    this.containerDrag = Settings.containerNBoundary ? new ContainerNodeDrag(this.project, clicked) : undefined;
  }

  endPointerDrag() {
    this.containerDrag = undefined;
  }

  allowsCollisionPlacement(owner: Doodle | null, box: Rectangle, destination: Rectangle) {
    return (
      !this.containerDrag ||
      this.containerDrag.exteriorFraction(owner, box, destination.location.subtract(box.location)) === 1
    );
  }

  moveAlignedEntity(entity: Entity, delta: Vector) {
    if (this.containerDrag) this.moveEntityUtils(entity, delta, true, false);
    else entity.move(delta);
  }
  constructor(private readonly project: Project) {}

  // ─────── 持续移动物理引擎（复用 Camera 同款物理模型）───────
  /** 方向命令向量，由快捷键 press/release 写入，值域 [-1,1]×[-1,1] */
  public moveAccelerateCommander: Vector = Vector.getZero();
  /** 当前速度 */
  private moveSpeed: Vector = Vector.getZero();
  /** 速度指数摩擦力指数（与 Camera 保持一致） */
  private readonly frictionExponent = 1.5;

  /**
   * 每帧物理 tick：把速度转化为实体位移
   * 注意：移动过程中不记录历史（避免历史爆炸），松开按键速度归零后再记录一次
   */
  tick() {
    if (this.moveAccelerateCommander.isZero() && this.moveSpeed.isZero()) {
      return;
    }

    // 摩擦力（与 Camera.tick 完全相同的公式）
    let friction = Vector.getZero();
    if (!this.moveSpeed.isZero()) {
      const speedSize = this.moveSpeed.magnitude();
      friction = this.moveSpeed
        .normalize()
        .multiply(-1)
        .multiply(Settings.moveFriction * speedSize ** this.frictionExponent)
        .limitX(-300, 300)
        .limitY(-300, 300);
    }

    // 动力（与相机移动相同的缩放感知公式：视野越宏观，移动速度越快）
    const power = this.moveAccelerateCommander
      .multiply(Settings.moveAmplitude * (1 / this.project.camera.currentScale) ** 2)
      .limitX(-300, 300)
      .limitY(-300, 300);

    this.moveSpeed = this.moveSpeed.add(power).add(friction);

    // 速度足够小时归零，防止无限微小漂移
    if (this.moveSpeed.magnitude() < 0.01) {
      this.moveSpeed = Vector.getZero();
      // 速度真正停止时记录一次历史
      if (this.moveAccelerateCommander.isZero()) {
        this.project.historyManager.recordStep();
      }
      return;
    }

    // 用整帧位移驱动实体（不触发历史记录）
    this.moveEntitiesWithChildren(this.moveSpeed, true);
  }

  /**
   * 持续移动：某方向键按下
   */
  public continuousMoveKeyPress(direction: Vector) {
    this.moveAccelerateCommander = this.moveAccelerateCommander.add(direction).limitX(-1, 1).limitY(-1, 1);
  }

  /**
   * 持续移动：某方向键松开（速度会自然衰减至停止后记录历史）
   */
  public continuousMoveKeyRelease(direction: Vector) {
    this.moveAccelerateCommander = this.moveAccelerateCommander.subtract(direction).limitX(-1, 1).limitY(-1, 1);
  }

  /**
   * 立刻刹车：清除命令向量和速度（进入编辑模式等场景使用）
   */
  public stopImmediately() {
    this.moveAccelerateCommander = Vector.getZero();
    this.moveSpeed = Vector.getZero();
  }
  // ─────────────────────────────────────────────────────────────

  /**
   * 检查实体是否可以移动（考虑锁定状态）
   * @param entity 要检查的实体
   * @returns 如果实体可以移动返回 true，否则返回 false
   */
  private canMoveEntity(entity: Entity): boolean {
    return entity.nearestLockedAncestorSection === null;
  }

  /**
   * 让某一个实体移动一小段距离
   * @param entity
   * @param delta
   * @param isAutoAdjustSection 移动的时候是否触发分组框的弹性调整
   */
  moveEntityUtils(
    entity: Entity,
    delta: Vector,
    isAutoAdjustSection: boolean = true,
    allowTransfer = this.pointerMoving,
  ) {
    // 检查实体是否可以被移动（锁定状态检查）
    if (!this.canMoveEntity(entity)) {
      return;
    }
    // 让自己移动
    const wasMoving = this.isMovingWithinContainer;
    this.isMovingWithinContainer = true;
    try {
      const previousParent = entity.parentSection;
      if (this.containerDrag) {
        delta = this.containerDrag.constrain(entity, delta, allowTransfer);
        if (delta.isZero() && previousParent === entity.parentSection) return;
      }
      entity.move(delta);
      if (entity.parentSection !== previousParent) this.project.stageManager.updateReferences();
    } finally {
      this.isMovingWithinContainer = wasMoving;
    }

    if (isAutoAdjustSection && !this.translatingBatch) {
      let current = entity.parentSection;
      while (current) {
        const wasMoving = this.isMovingWithinContainer;
        this.isMovingWithinContainer = true;
        try {
          current.adjustLocationAndSize();
        } finally {
          this.isMovingWithinContainer = wasMoving;
        }
        current = current.parentSection;
      }
    }
  }

  /**
   * 跳跃式移动传入的实体
   * 会破坏嵌套关系
   * @param entity
   * @param delta
   */
  jumpMoveEntityUtils(entity: Entity, delta: Vector) {
    // 检查实体是否可以被移动（锁定状态检查）
    if (!this.canMoveEntity(entity)) {
      return;
    }

    const beforeMoveRect = entity.collisionBox.getRectangle().clone();
    console.log("JUMP MOVE");
    // 将自己移动前加特效
    this.project.effects.addEffect(new EntityJumpMoveEffect(15, beforeMoveRect, delta));

    // 即将跳入的sections区域
    const targetSection = this.project.sectionMethods.getInnermostSectionByLocation(beforeMoveRect.center.add(delta));

    // 检查目标位置是否在锁定的 section 内（包括祖先section的锁定状态）
    if (
      targetSection &&
      (targetSection.locked || this.project.sectionMethods.isObjectBeLockedBySection(targetSection))
    ) {
      return;
    }
    // 改变层级
    if (targetSection === null) {
      // 代表想要走出当前section
      if (entity.parentSection) {
        this.project.stageManager.goOutSection([entity], entity.parentSection);
      }
    } else {
      this.project.sectionInOutManager.goInSection([entity], targetSection);
      this.project.effects.addEffect(
        new RectanglePushInEffect(entity.collisionBox.getRectangle(), targetSection.collisionBox.getRectangle()),
      );
      SoundService.play.entityJumpSoundFile();
    }

    // 让自己移动
    // entity.move(delta);
    this.moveEntityUtils(entity, delta, false);
  }

  /**
   * 将某个实体移动到目标位置
   * @param entity
   * @param location
   */
  moveEntityToUtils(entity: Entity, location: Vector) {
    // 检查实体是否可以被移动（锁定状态检查）
    if (!this.canMoveEntity(entity)) {
      return;
    }
    const wasMoving = this.isMovingWithinContainer;
    this.isMovingWithinContainer = true;
    try {
      entity.moveTo(location);
      let current = entity.parentSection;
      while (current) {
        current.adjustLocationAndSize();
        current = current.parentSection;
      }
    } finally {
      this.isMovingWithinContainer = wasMoving;
    }
  }

  /**
   * 移动所有选中的实体一小段距离
   * @param delta
   * @param isAutoAdjustSection
   */
  moveSelectedEntities(delta: Vector, isAutoAdjustSection: boolean = true) {
    const nodes = this.project.stageManager
      .getEntities()
      .filter((node) => node.isSelected && !this.hasSelectedDoodleAncestor(node));
    this.moveBatch(nodes, delta, isAutoAdjustSection);
  }

  /**
   * 跳跃式移动所有选中的可连接实体
   * 会破坏框的嵌套关系
   * @param delta
   */
  jumpMoveSelectedConnectableEntities(delta: Vector) {
    for (const node of this.project.stageManager.getConnectableEntity()) {
      if (node.isSelected) {
        this.jumpMoveEntityUtils(node, delta);
      }
    }
  }

  /**
   * 树型移动 所有选中的实体
   * @param delta
   * @param skipDashed 是否跳过虚线边（树形格式化时传 true，避免带动虚线连接的节点）
   */
  moveEntitiesWithChildren(delta: Vector, skipDashed = true) {
    const roots = this.project.stageManager
      .getEntities()
      .filter((node) => node.isSelected && !this.hasSelectedDoodleAncestor(node));
    this.moveBatch(this.collectMoveTargets(roots, skipDashed), delta);
  }
  /**
   * 树形移动传入的可连接实体
   * @param node
   * @param delta
   * @param skipDashed 是否跳过虚线边（树形格式化时传 true，避免带动虚线连接的节点）
   */
  moveWithChildren(node: ConnectableEntity, delta: Vector, skipDashed = false) {
    this.moveBatch(this.collectMoveTargets([node], skipDashed), delta);
  }

  private collectMoveTargets(roots: Entity[], skipDashed: boolean): Entity[] {
    const children = new Map<ConnectableEntity, ConnectableEntity[]>();
    for (const edge of this.project.stageManager.getTreeEdges()) {
      if (skipDashed && edge.lineType === "dashed") continue;
      if (!children.has(edge.source)) children.set(edge.source, []);
      children.get(edge.source)!.push(edge.target);
    }
    const visited = new Set<Entity>();
    const result: Entity[] = [];
    const pending = [...roots].reverse();
    while (pending.length) {
      const node = pending.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      if (!this.hasSelectedDoodleAncestor(node)) result.push(node);
      if (node instanceof ConnectableEntity) {
        const next = children.get(node) ?? [];
        for (let i = next.length - 1; i >= 0; i--) pending.push(next[i]);
      }
    }
    return result;
  }

  private hasSelectedDoodleAncestor(entity: Entity): boolean {
    let parent = entity.parentSection;
    while (parent) {
      if (parent.isDoodle && parent.isSelected) return true;
      parent = parent.parentSection;
    }
    return false;
  }

  // 按住shift键移动
}
