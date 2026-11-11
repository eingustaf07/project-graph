import type { Project } from "@/core/Project";
import { ArcEdge } from "@/core/stage/stageObject/association/ArcEdge";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Vector } from "@graphif/data-structures";
import { deserialize, serialize } from "@graphif/serializer";
import { toast } from "sonner";

const splitting = new WeakSet<Project>();

/** Compatibility for the installed insert-node extension, which only enumerates LineEdge. */
export async function splitSelectedExtensionEdge(project: Project): Promise<string | undefined> {
  if (splitting.has(project)) return;
  const selected = project.stageManager.getAssociations().filter((edge) => edge.isSelected);
  if (selected.length !== 1 || !(selected[0] instanceof LineEdge || selected[0] instanceof ArcEdge)) {
    toast.warning("请先只选中一条普通连线或圆弧，再按 Alt+Q");
    return;
  }
  const edge = selected[0];
  if (project.sectionMethods.isObjectBeLockedBySection(edge)) {
    toast.warning("连线连接了锁定的内容，不能插入节点");
    return;
  }
  const source = edge.source,
    target = edge.target;
  const start = source.geometryCenter,
    end = target.geometryCenter;
  if (start.distance(end) < 0.001) {
    toast.warning("这条连线的两端位置重合，请先调整端点位置");
    return;
  }
  let midpoint = Vector.average(start, end);
  let firstOffset = 0,
    secondOffset = 0;
  if (edge instanceof ArcEdge && Math.abs(edge.offset) > 0.001) {
    const geometry = edge.arcGeometry;
    const at = (t: number) => {
      const angle = geometry.startAngle + (geometry.endAngle - geometry.startAngle) * t;
      return geometry.center.add(new Vector(Math.cos(angle), Math.sin(angle)).multiply(geometry.radius));
    };
    midpoint = at(0.5);
    const sagitta = (a: Vector, b: Vector, through: Vector) =>
      through.subtract(Vector.average(a, b)).dot(b.subtract(a).normalize().rotateDegrees(90));
    firstOffset = sagitta(start, midpoint, at(0.25));
    secondOffset = sagitta(midpoint, end, at(0.75));
  }
  if (![midpoint.x, midpoint.y, firstOffset, secondOffset].every(Number.isFinite)) {
    toast.warning("连线几何位置无效，请先调整连线");
    return;
  }

  const snapshot = serialize(project.stage);
  const selections = new Set(project.stage.filter((object) => object.isSelected).map((object) => object.uuid));
  const previousState = project.projectState;
  splitting.add(project);
  let uuid: string;
  try {
    const parent = source.parentSection && source.parentSection === target.parentSection ? source.parentSection : null;
    uuid = await project.nodeAdder.addTextNodeByClick(midpoint, parent ? [parent] : [], true, false);
    const node = project.stageManager.getTextNodeByUUID(uuid);
    if (!node) throw new Error("新增节点失败，已保留原连线");
    // Keep the original label once, on the reused first segment. The second
    // segment inherits appearance and direction but must not duplicate the label.
    const options = {
      associationList: [node, target],
      text: "",
      color: edge.color.clone(),
      sourceRectangleRate: Vector.same(0.5),
      targetRectangleRate: edge.targetRectangleRate.clone(),
      lineType: edge.lineType,
      arrowType: edge.arrowType,
    };
    const second =
      edge instanceof ArcEdge
        ? new ArcEdge(project, { ...options, offset: secondOffset, textPosition: edge.textPosition })
        : new LineEdge(project, options);
    edge.target = node;
    edge.targetRectangleRate = Vector.same(0.5);
    if (edge instanceof ArcEdge) edge.offset = firstOffset;
    project.stageManager.add(second);
    project.stageManager.clearSelectAll();
    node.isSelected = true;
    project.historyManager.recordStep();
  } catch (error) {
    project.stage = deserialize(structuredClone(snapshot), project);
    project.stageManager.updateReferences();
    for (const object of project.stage) object.isSelected = selections.has(object.uuid);
    project.projectState = previousState;
    throw error;
  } finally {
    splitting.delete(project);
  }
  project.controller.resetCountdownTimer();
  try {
    project.controllerUtils.textNodeInEditModeByUUID(uuid);
  } catch (error) {
    toast.error(`节点已插入，但进入编辑模式失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return uuid;
}
