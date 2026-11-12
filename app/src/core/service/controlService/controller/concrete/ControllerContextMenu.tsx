import { Settings } from "@/core/service/Settings";
import { Vector } from "@graphif/data-structures";
import { ControllerClass } from "../ControllerClass";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { Rectangle } from "@graphif/shapes";
import { SoundService } from "@/core/service/feedbackService/SoundService";
import { fitDoodleBounds } from "@/core/algorithm/doodleBounds";

export class ControllerContextMenuClass extends ControllerClass {
  /** view */
  private mouseDownLocation: Vector = new Vector(0, 0);
  private blankClick?: { at: number; location: Vector };
  private dragged = false;

  public mousedown = (event: MouseEvent) => {
    if (event.button !== 2) {
      return; // Only handle right-clicks
    }

    this.mouseDownLocation = new Vector(event.clientX, event.clientY);
    this.dragged = false;
  };
  public mousemove = (event: MouseEvent) => {
    if (this.mouseDownLocation.distance(new Vector(event.clientX, event.clientY)) >= 5) {
      this.dragged = true;
      this.blankClick = undefined;
    }
  };
  public mouseup = (event: MouseEvent) => {
    if (event.button !== 2) {
      return; // Only handle right-clicks
    }

    const mouseUpLocation = new Vector(event.clientX, event.clientY);
    const distance = this.mouseDownLocation.distance(mouseUpLocation);

    // 检查是否启用了右键点击连线功能并且有实体被选中
    const hasSelectedConnectableEntities = this.project.stageManager
      .getConnectableEntity()
      .some((entity) => entity.isSelected);

    // 转换鼠标位置到世界坐标系
    const worldLocation = this.project.renderer.transformView2World(mouseUpLocation);
    const clicked = this.project.controllerUtils.getClickedStageObject(worldLocation);
    if (!clicked) {
      if (this.dragged || distance >= 5 || Settings.viewerMode) {
        this.blankClick = undefined;
        return;
      }
      const now = Date.now();
      const previous = this.blankClick;
      this.blankClick = { at: now, location: mouseUpLocation };
      if (previous && now - previous.at < 300 && previous.location.distance(mouseUpLocation) < 5) {
        this.blankClick = undefined;
        this.createContainer(worldLocation);
      }
      return;
    }
    this.blankClick = undefined;

    // 检查点击位置是否在可连接对象上
    const clickedConnectableEntity = this.project.stageManager.findConnectableEntityByLocation(worldLocation);

    // 如果启用了右键点击连线功能、有实体被选中，并且点击位置在可连接对象上，并且点击的对象未选中，则触发连接，不触发右键菜单
    if (Settings.enableRightClickConnect && hasSelectedConnectableEntities && clickedConnectableEntity !== null) {
      if (!clickedConnectableEntity.isSelected) {
        return;
      }
    }

    if (distance < 5) {
      this.project.emit("contextmenu", this.project.canvas.viewToClient(mouseUpLocation));
    }
  };

  private createContainer(location: Vector) {
    const parent = this.project.stageManager
      .getSections()
      .filter(
        (section): section is Doodle =>
          section instanceof Doodle &&
          section.bounded &&
          !section.isHiddenBySectionCollapse &&
          section.containsContentPoint(location),
      )
      .sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0];
    if (parent && (parent.locked || parent.nearestLockedAncestorSection)) return;
    const maxSide = parent && Math.min(parent.frame.width, parent.frame.height) * 0.6;
    const size = parent
      ? new Vector(
          Math.min(1800, parent.shape === "circle" ? maxSide! : parent.frame.width * 0.6),
          Math.min(1200, parent.shape === "circle" ? maxSide! : parent.frame.height * 0.6),
        )
      : new Vector(1800, 1200);
    if (size.x < 16 || size.y < 16) return;
    const frame = new Rectangle(location.subtract(size.multiply(0.5)), size);
    if (parent) {
      const offset = fitDoodleBounds(parent.frame, parent.shape, frame);
      if (!offset) return;
      frame.location = frame.location.add(offset);
    }
    const container = new Doodle(this.project, {
      frame,
      shape: "rectangle",
      bounded: true,
      text: "",
      borderStyle: Settings.sectionInitBorderStyle,
    });
    parent?.adopt(container);
    container.captureEnclosed();
    this.project.stageManager.add(container);
    this.project.stageManager.clearSelectAll();
    container.isSelected = true;
    this.project.historyManager.recordStep();
    SoundService.playDoodleCreated();
    this.project.controller.resetCountdownTimer();
    this.project.loop();
  }
}
