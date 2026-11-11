import { isSelectionMode } from "@/core/service/controlService/selectionMode";
import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { Vector } from "@graphif/data-structures";
import { toast } from "sonner";

export class HyperedgeCenterDrag {
  private readonly listeners = new AbortController();
  private drag?: { edge: MultiTargetUndirectedEdge; pointer: number; start: Vector; end: Vector };

  constructor(private readonly project: Project) {
    const canvas = project.canvas.element;
    const options = { capture: true, signal: this.listeners.signal };
    canvas.addEventListener("pointerdown", this.down, options);
    canvas.addEventListener("pointermove", this.move, options);
    canvas.addEventListener("pointerup", this.up, options);
    canvas.addEventListener("pointercancel", this.cancel, options);
    canvas.addEventListener("pointerleave", this.cancel, options);
    window.addEventListener("blur", this.cancel, options);
  }

  dispose() {
    this.cancel();
    this.listeners.abort();
  }

  get preview() {
    return this.drag;
  }

  private view(event: PointerEvent) {
    return this.project.canvas.clientToView(event.clientX, event.clientY);
  }

  private cancel = () => {
    this.drag = undefined;
  };

  private down = (event: PointerEvent) => {
    if (event.button !== 2 || Settings.viewerMode || !isSelectionMode(Settings.mouseLeftMode) || this.drag) return;
    const start = this.view(event);
    const world = this.project.renderer.transformView2World(start);
    const radius = 7 / this.project.camera.currentScale;
    let closest: MultiTargetUndirectedEdge | undefined;
    let distance = radius;
    for (const edge of this.project.stageManager.getAssociations()) {
      if (!(edge instanceof MultiTargetUndirectedEdge) || edge.renderType !== "line" || edge.associationList.length < 2)
        continue;
      const d = edge.centerLocation.distance(world);
      if (d <= distance && !edge.associationList.some((node) => node.isHiddenBySectionCollapse)) {
        closest = edge;
        distance = d;
      }
    }
    if (!closest || this.project.stageManager.findEntityByLocation(world)) return;
    this.drag = { edge: closest, pointer: event.pointerId, start, end: world };
    event.stopImmediatePropagation();
  };

  private move = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    this.drag.end = this.project.renderer.transformView2World(this.view(event));
    this.project.controller.resetCountdownTimer();
    event.stopImmediatePropagation();
  };

  private up = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer || event.button !== 2) return;
    this.cancel();
    event.stopImmediatePropagation();
    const view = this.view(event);
    if (view.distance(drag.start) < 5) {
      this.project.emit("contextmenu", this.project.canvas.viewToClient(view));
      return;
    }
    const world = this.project.renderer.transformView2World(view);
    if (Settings.viewerMode || this.project.stageManager.findEntityByLocation(world)) return;
    void this.project.multiTargetEdgeMove.growFromCenter(drag.edge, world).catch((error) => toast.error(String(error)));
  };
}
