import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";
import { serialize, deserialize } from "@graphif/serializer";

export function canResizeSelectedFrames(project?: Project) {
  return (
    !!project &&
    !Settings.viewerMode &&
    project.stageManager
      .getSelectedEntities()
      .some((n) => n instanceof Doodle && !n.locked && !n.nearestLockedAncestorSection)
  );
}

export function resizeSelectedFrames(project: Project, factor: number, axis: "both" | "length" | "height" = "both") {
  if (!canResizeSelectedFrames(project)) return;
  const frames = project.stageManager
    .getSelectedEntities()
    .filter((n): n is Doodle => n instanceof Doodle && !n.locked && !n.nearestLockedAncestorSection);
  const plans = frames
    .map((frame) => {
      const size = new Vector(
        axis === "height" ? frame.frame.width : Math.max(40, frame.frame.width * factor),
        axis === "length" ? frame.frame.height : Math.max(40, frame.frame.height * factor),
      );
      return { frame, box: new Rectangle(frame.frame.center.subtract(size.multiply(0.5)), size) };
    })
    .filter(({ frame, box }) => !frame.frame.size.equals(box.size));
  if (!plans.length) return;
  const before = serialize(project.stage);
  try {
    for (const { frame, box } of plans) frame.resizeFrame(box);
  } catch (error) {
    project.stage = deserialize(before, project);
    project.stageManager.updateReferences();
    project.entityMoveManager?.invalidateCollisionIndex();
    throw error;
  }
  project.entityMoveManager?.invalidateCollisionIndex();
  project.historyManager.recordStep();
}
