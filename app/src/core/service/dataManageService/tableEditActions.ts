import type { Project } from "@/core/Project";
import type { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { tableToText } from "@/core/algorithm/tableData";
import { serialize, deserialize } from "@graphif/serializer";
import { Settings } from "@/core/service/Settings";

export function commitTableEdit(project: Project, node: TextNode, cells: string[][]): boolean {
  const text = tableToText(cells);
  if (node.text === text) return false;
  if (Settings.viewerMode || !node.isTable || !project.stage.includes(node) || node.nearestLockedAncestorSection)
    throw new Error("此表格已关闭、只读或被锁定，无法编辑");
  const before = serialize(project.stage);
  try {
    node.rename(text);
    project.historyManager.recordStep();
  } catch (error) {
    project.stage = deserialize(before, project);
    project.stageManager.updateReferences();
    project.entityMoveManager?.invalidateCollisionIndex();
    throw error;
  }
  return true;
}
