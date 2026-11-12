import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { UrlNode } from "@/core/stage/stageObject/entity/UrlNode";
import { Section, Doodle } from "@/core/stage/stageObject/entity/Section";
import { isQuestionMarked } from "@/core/render/canvas2d/questionColor";
import { doodleContainsPoint } from "@/core/algorithm/doodleBounds";

export function applyQuestionFrameNames(project: Project): boolean {
  if (!Settings.questionMarkYellow || Settings.viewerMode) return false;
  const frames = project.stage.filter(
    (item): item is Section =>
      item instanceof Section && !item.questionTitleAssigned && !item.locked && !item.nearestLockedAncestorSection,
  );
  if (!frames.length) return false;
  const questions = project.stage.filter(
    (item): item is TextNode | UrlNode =>
      (item instanceof TextNode && isQuestionMarked(item.text)) ||
      (item instanceof UrlNode && isQuestionMarked(item.title)),
  );
  if (!questions.length) return false;
  let changed = false;
  for (const frame of frames) {
    const first = questions.find((node) => {
      if (frame instanceof Doodle && !frame.bounded) {
        const rect = node.rectangle;
        return [rect.leftTop, rect.rightTop, rect.leftBottom, rect.rightBottom].every((point) =>
          doodleContainsPoint(frame.frame, frame.shape, point),
        );
      }
      const visited = new Set<Section>();
      let parent = node.parentSection;
      while (parent && !visited.has(parent)) {
        if (parent === frame) return true;
        visited.add(parent);
        parent = parent.parentSection;
      }
      return false;
    });
    if (!first) continue;
    frame.rename(first instanceof TextNode ? first.text : first.title);
    frame.questionTitleAssigned = true;
    changed = true;
  }
  return changed;
}
