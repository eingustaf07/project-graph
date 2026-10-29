import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { objectRect, placeInFreeSpace } from "@/core/service/dataManageService/aiEngine/AITreeLayout";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";
import {
  findOverlaps,
  planSmartTree,
  type SmartTreeOptions,
  type TreeDirection,
  type TreeLink,
} from "./SmartTreeLayout";

export function arrangeSmartTree(project: Project, options?: SmartTreeOptions) {
  if (!Settings.enableSmartTreeArrange) throw new Error("请先在设置 → 视觉 → 实验性功能中启用智能规整树形布局");
  const config: SmartTreeOptions = options ?? {
    mode: Settings.smartTreeArrangeMode,
    direction: Settings.smartTreeArrangeDirection,
    levelGap: Settings.smartTreeLevelGap,
    nodeGap: Settings.smartTreeNodeGap,
    subtreeGap: Settings.smartTreeSubtreeGap,
  };
  const selected = project.stageManager.getSelectedEntities();
  if (!selected.length || selected.some((n) => !(n instanceof ConnectableEntity) || n instanceof Section))
    throw new Error("请选择普通节点作为根节点，分组框本身暂不支持实验布局");
  const edges = project.stageManager.getEdges();
  const treeEdges = edges.filter((e) => !("lineType" in e) || e.lineType !== "dashed");
  const children = new Map<ConnectableEntity, typeof treeEdges>();
  for (const edge of treeEdges) {
    const list = children.get(edge.source) ?? [];
    list.push(edge);
    children.set(edge.source, list);
  }
  const included = new Set<ConnectableEntity>(selected as ConnectableEntity[]);
  const queue = [...included];
  for (let i = 0; i < queue.length; i++) {
    if (queue.length > 2000) throw new Error("实验布局单次最多支持 2000 个节点，请选择较小子树");
    for (const edge of children.get(queue[i]) ?? [])
      if (!included.has(edge.target)) {
        included.add(edge.target);
        queue.push(edge.target);
      }
  }
  const roots = (selected as ConnectableEntity[]).filter(
    (n) => !treeEdges.some((e) => e.target === n && included.has(e.source)),
  );
  if (!roots.length) throw new Error("选中结构存在环路，无法确定根节点；未移动任何节点");
  for (const node of included) {
    if (node.collisionBox.shapes.length !== 1 || !(node.collisionBox.shapes[0] instanceof Rectangle))
      throw new Error("实验布局目前仅支持单矩形节点；圆形连接点、自定义形状请使用原布局命令");
    if (node instanceof Section || node.parentSection || node.isHiddenBySectionCollapse)
      throw new Error("分组框内或折叠中的节点暂不支持实验布局，请保持原图或先在框外操作");
    if (project.stageManager.get(node.uuid) !== node) throw new Error("节点引用已变化，请重新选择");
    const parentCount = treeEdges.filter((e) => e.target === node).length;
    if (parentCount > 1 || (!roots.includes(node) && parentCount !== 1))
      throw new Error("存在多父节点；请把额外关联边标为虚线后再规整，未移动任何节点");
  }
  const directionOf = (edge: (typeof edges)[number]): TreeDirection => {
    if (edge.isLeftToRight()) return "right";
    if (edge.isRightToLeft()) return "left";
    if (edge.isTopToBottom()) return "down";
    if (edge.isBottomToTop()) return "up";
    const a = objectRect(edge.source),
      b = objectRect(edge.target);
    const dx = b.x + b.width / 2 - a.x - a.width / 2,
      dy = b.y + b.height / 2 - a.y - a.height / 2;
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up";
  };
  const obstacles = project.stageManager
    .getEntities()
    .filter((n) => !included.has(n as ConnectableEntity))
    .map(objectRect);
  const planned = [] as ReturnType<typeof objectRect>[];
  const covered = new Set<ConnectableEntity>();
  for (const root of roots) {
    const members = [root];
    const links: TreeLink[] = [];
    const seen = new Set([root]);
    for (let i = 0; i < members.length; i++) {
      for (const edge of children.get(members[i]) ?? []) {
        links.push({ source: edge.source.uuid, target: edge.target.uuid, direction: directionOf(edge) });
        if (seen.has(edge.target) || covered.has(edge.target)) throw new Error("存在环路或共享子节点；未移动任何节点");
        seen.add(edge.target);
        members.push(edge.target);
      }
    }
    members.forEach((n) => covered.add(n));
    let layout = planSmartTree(members.map(objectRect), links, root.uuid, config);
    const occupied = [...obstacles, ...planned];
    if (findOverlaps(layout, occupied).length) layout = placeInFreeSpace(layout, occupied, config.subtreeGap, "x");
    planned.push(...layout);
  }
  if (covered.size !== included.size) throw new Error("结构中存在无法归属的环路或共享节点，未移动任何节点");
  if (findOverlaps(planned, obstacles).length) throw new Error("布局验证发现节点重叠，未移动任何节点");
  const byId = new Map(queue.map((n) => [n.uuid, n]));
  const changed = planned.filter((r) => {
    const old = objectRect(byId.get(r.id)!);
    return Math.abs(old.x - r.x) > 1e-7 || Math.abs(old.y - r.y) > 1e-7;
  });
  const affectedEdges =
    config.mode === "standard" ? treeEdges.filter((e) => included.has(e.source) && included.has(e.target)) : [];
  const sourceRate =
    config.direction === "right"
      ? new Vector(0.99, 0.5)
      : config.direction === "left"
        ? new Vector(0.01, 0.5)
        : config.direction === "down"
          ? new Vector(0.5, 0.99)
          : new Vector(0.5, 0.01);
  const targetRate =
    config.direction === "right"
      ? new Vector(0.01, 0.5)
      : config.direction === "left"
        ? new Vector(0.99, 0.5)
        : config.direction === "down"
          ? new Vector(0.5, 0.01)
          : new Vector(0.5, 0.99);
  const changedEdges = affectedEdges.filter(
    (e) => !e.sourceRectangleRate.equals(sourceRate) || !e.targetRectangleRate.equals(targetRate),
  );
  if (!changed.length && !changedEdges.length) return { movedCount: 0 };
  const before = changed.map((r) => ({
    node: byId.get(r.id)!,
    rect: (byId.get(r.id)!.collisionBox.shapes[0] as Rectangle).clone(),
  }));
  const edgeBefore = changedEdges.map((edge) => ({
    edge,
    source: edge.sourceRectangleRate.clone(),
    target: edge.targetRectangleRate.clone(),
  }));
  try {
    // Direct shape updates intentionally avoid moveTo's collision/synchronization side effects on unrelated nodes.
    for (const r of changed) {
      const node = byId.get(r.id)!;
      const size = (node.collisionBox.shapes[0] as Rectangle).size.clone();
      node.collisionBox.updateShapeList([new Rectangle(new Vector(r.x, r.y), size)]);
    }
    for (const edge of changedEdges) {
      edge.sourceRectangleRate = sourceRate.clone();
      edge.targetRectangleRate = targetRate.clone();
    }
    project.historyManager.recordStep();
  } catch (error) {
    before.forEach(({ node, rect }) => node.collisionBox.updateShapeList([rect]));
    edgeBefore.forEach(({ edge, source, target }) => {
      edge.sourceRectangleRate = source;
      edge.targetRectangleRate = target;
    });
    throw error;
  }
  return { movedCount: changed.length };
}
