import { Vector } from "@graphif/data-structures";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { ControllerClass } from "@/core/service/controlService/controller/ControllerClass";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { MediaNode } from "@/core/stage/stageObject/entity/MediaNode";
import { SvgNode } from "@/core/stage/stageObject/entity/SvgNode";
import { ReferenceBlockNode } from "@/core/stage/stageObject/entity/ReferenceBlockNode";
import { Rectangle } from "@graphif/shapes";

export class ControllerEntityResizeClass extends ControllerClass {
  private changeSizeEntity: Entity | null = null;
  private imageDirection = new Vector(1, 1);
  private imageBeforeResize: Rectangle | null = null;
  public mousedown: (event: MouseEvent) => void = (event) => {
    if (!(event.button == 0)) {
      return;
    }
    // 检查是否有选中的物体
    const selectedEntities = this.project.stageManager.getSelectedEntities();
    if (selectedEntities.length === 0) {
      return;
    }
    const pressWorldLocation = this.project.renderer.transformView2World(new Vector(event.clientX, event.clientY));
    this.lastMoveLocation = pressWorldLocation.clone();
    for (const selectedEntity of selectedEntities) {
      if (selectedEntity.nearestLockedAncestorSection) continue;
      if (selectedEntity instanceof ImageNode) {
        const handle = selectedEntity
          .getResizeHandles()
          .find((handle) => handle.rectangle.isPointIn(pressWorldLocation));
        if (handle) {
          this.changeSizeEntity = selectedEntity;
          this.imageDirection = handle.direction;
          this.imageBeforeResize = selectedEntity.rectangle.clone();
          break;
        }
        continue;
      }
      // 检查是否是支持缩放的实体类型
      if (
        selectedEntity instanceof TextNode ||
        selectedEntity instanceof SvgNode ||
        selectedEntity instanceof MediaNode ||
        selectedEntity instanceof ReferenceBlockNode
      ) {
        // 对TextNode进行特殊处理，只在手动模式下允许缩放
        if (selectedEntity instanceof TextNode && selectedEntity.sizeAdjust === "auto") {
          continue;
        }

        // 检查是否点击了缩放控制点
        const resizeRect = selectedEntity.getResizeHandleRect();
        if (resizeRect.isPointIn(pressWorldLocation)) {
          // 点中了扩大缩小的东西
          this.changeSizeEntity = selectedEntity;
          break;
        }
      }
    }
  };

  public mousemove: (event: MouseEvent) => void = (event) => {
    if (this.changeSizeEntity === null) {
      return;
    }
    const pressWorldLocation = this.project.renderer.transformView2World(new Vector(event.clientX, event.clientY));
    const diff = pressWorldLocation.subtract(this.lastMoveLocation);

    // 对所有支持缩放的实体类型调用resizeHandle方法
    if (this.changeSizeEntity instanceof ImageNode) {
      this.changeSizeEntity.resizeHandle(diff, this.imageDirection);
    } else if (
      this.changeSizeEntity instanceof TextNode ||
      this.changeSizeEntity instanceof SvgNode ||
      this.changeSizeEntity instanceof MediaNode ||
      this.changeSizeEntity instanceof ReferenceBlockNode
    ) {
      this.changeSizeEntity.resizeHandle(diff);
    }

    this.lastMoveLocation = pressWorldLocation.clone();
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public mouseup: (event: MouseEvent) => void = (_event) => {
    if (this.changeSizeEntity === null) {
      return;
    }
    // if (this.changeSizeEntity instanceof TextNode) {
    //   this.project.effects.addEffect(new EntityDashTipEffect(50, this.changeSizeEntity.getResizeHandleRect()));
    // }
    this.finishImageResize();
    this.changeSizeEntity = null;
    // const pressWorldLocation = this.project.renderer.transformView2World(new Vector(event.clientX, event.clientY));
  };

  public mouseMoveOutWindowForcedShutdown(_outsideLocation: Vector) {
    super.mouseMoveOutWindowForcedShutdown(_outsideLocation);
    this.finishImageResize();
    this.changeSizeEntity = null;
  }

  private finishImageResize(): void {
    if (this.changeSizeEntity instanceof ImageNode && this.imageBeforeResize) {
      const before = this.imageBeforeResize,
        after = this.changeSizeEntity.rectangle;
      if (
        before.left !== after.left ||
        before.top !== after.top ||
        before.width !== after.width ||
        before.height !== after.height
      ) {
        this.project.historyManager.recordStep();
      }
    }
    this.imageBeforeResize = null;
  }
}
