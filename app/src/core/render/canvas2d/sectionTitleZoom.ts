import { Settings } from "@/core/service/Settings";
import type { Vector } from "@graphif/data-structures";

export function isSectionTitleZoomedOut(size: Vector, scale: number, viewportWidth: number, viewportHeight: number) {
  return (
    scale <= Settings.sectionBigTitleCameraScaleThreshold &&
    Math.max(size.x, size.y) * scale < Math.max(viewportWidth, viewportHeight) * Settings.sectionBigTitleThresholdRatio
  );
}
