import type { Project } from "@/core/Project";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import type { AIObjectReferenceRegistry } from "./AIObjectReferenceRegistry";
import {
  boundsOf,
  findOverlaps,
  parseIndentedTree,
  placeInFreeSpace,
  placeInsideContainer,
  planTreeLayout,
  translateLayout,
  objectRect,
  markAINodeOrigin,
  type AITreeLayoutOptions,
  type AITreeEntry,
  type LayoutRect,
} from "./AITreeLayout";
export { objectRect } from "./AITreeLayout";

function setRect(node: Entity, rect: LayoutRect) {
  node.collisionBox.updateShapeList([new Rectangle(new Vector(rect.x, rect.y), new Vector(rect.width, rect.height))]);
}

function assertUnlocked(nodes: Entity[]) {
  for (const node of nodes) {
    if (node instanceof Section && node.locked) throw new Error("分组框已锁定，请先解锁后操作");
    const visited = new Set<Entity>();
    for (let parent = node.parentSection; parent && !visited.has(parent); parent = parent.parentSection) {
      if (parent.locked) throw new Error("节点所在分组框已锁定，请先解锁后操作");
      visited.add(parent);
    }
  }
}

export function limitAITextWidth(node: TextNode) {
  const rect = node.collisionBox.getRectangle();
  const maxWidth = node.getAutoMaxTextWidth() + node.getPadding() * 2;
  if (rect.width > maxWidth) {
    node.collisionBox.updateShapeList([new Rectangle(rect.location.clone(), new Vector(maxWidth, rect.height))]);
    node.forceAdjustHeightByText();
  }
}

function measuredRect(project: Project, node: Entity): LayoutRect {
  if (!(node instanceof TextNode)) return objectRect(node);
  // Measuring a detached node avoids the manual-size setter's live Section/collision side effects.
  const measured = new TextNode(project, {
    text: node.text,
    fontScaleLevel: node.fontScaleLevel,
    fontFamily: node.fontFamily,
    fontWeight: node.fontWeight,
    sizeAdjust: node.sizeAdjust === "manual" ? "manual" : "auto",
    collisionBox: new CollisionBox([node.collisionBox.getRectangle().clone()]),
  });
  limitAITextWidth(measured);
  return { ...objectRect(node), width: measured.rectangle.width, height: measured.rectangle.height };
}

function obstaclesFor(project: Project, nodes: Entity[], container?: Section | null) {
  const selected = new Set(nodes);
  const ancestors = new Set<Entity>();
  for (let parent = container; parent && !ancestors.has(parent); parent = parent.parentSection) ancestors.add(parent);
  return project.stageManager
    .getEntities()
    .filter((node) => !selected.has(node) && !ancestors.has(node))
    .map(objectRect);
}

export function layoutAINodes(project: Project, nodes: ConnectableEntity[], options: AITreeLayoutOptions = {}) {
  assertUnlocked(nodes);
  if (!nodes.length) throw new Error("没有可布局的节点");
  if (nodes.some((node) => project.stageManager.get(node.uuid) !== node))
    throw new Error("节点已改变，请重新读取引用后操作");
  const container = nodes[0].parentSection;
  if (nodes.some((node) => node instanceof Section || node.parentSection !== container)) {
    throw new Error("布局节点需要位于同一分组层级；分组框本身请使用整组平移");
  }
  const ids = new Set(nodes.map((node) => node.uuid));
  const links = project.stageManager
    .getEdges()
    .filter((edge) => ids.has(edge.source.uuid) && ids.has(edge.target.uuid))
    .map((edge) => ({ source: edge.source.uuid, target: edge.target.uuid }));
  const measured = nodes.map((node) => measuredRect(project, node));
  const obstacles = obstaclesFor(project, nodes, container);
  const initial = planTreeLayout(measured, links, options);
  const planned = container
    ? placeInsideContainer(initial, obstacles, objectRect(container), options.safetyGap ?? 60)
    : placeInFreeSpace(initial, obstacles, options.safetyGap ?? 60, options.direction === "down" ? "y" : "x");
  if (findOverlaps(planned, obstacles).length) throw new Error("布局验证发现重叠，未应用任何移动");
  const before = nodes.map(objectRect);
  const edges = project.stageManager
    .getEdges()
    .filter((edge) => edge instanceof LineEdge && ids.has(edge.source.uuid) && ids.has(edge.target.uuid));
  const edgeRates = edges.map((edge) => ({
    source: edge.sourceRectangleRate.clone(),
    target: edge.targetRectangleRate.clone(),
  }));
  try {
    nodes.forEach((node, i) => setRect(node, planned[i]));
    for (const edge of edges) {
      edge.sourceRectangleRate = options.direction === "down" ? new Vector(0.5, 1) : new Vector(1, 0.5);
      edge.targetRectangleRate = options.direction === "down" ? new Vector(0.5, 0) : new Vector(0, 0.5);
    }
    project.stageManager.updateReferences();
    project.historyManager.recordStep();
  } catch (error) {
    nodes.forEach((node, i) => setRect(node, before[i]));
    edges.forEach((edge, i) => {
      edge.sourceRectangleRate = edgeRates[i].source;
      edge.targetRectangleRate = edgeRates[i].target;
    });
    project.stageManager.updateReferences();
    throw error;
  }
  return {
    success: true,
    movedCount: nodes.length,
    internalEdgeCount: links.length,
    direction: options.direction ?? "right",
    overlapCount: 0,
    bounds: boundsOf(planned),
  };
}

export function generateAITree(
  project: Project,
  text: string,
  references: AIObjectReferenceRegistry,
  options: AITreeLayoutOptions = {},
  root?: ConnectableEntity,
) {
  return generateAITreeEntries(project, parseIndentedTree(text), references, options, root);
}

export function generateAITreeEntries(
  project: Project,
  entries: AITreeEntry[],
  references: AIObjectReferenceRegistry,
  options: AITreeLayoutOptions = {},
  root?: ConnectableEntity,
) {
  if (root) assertUnlocked([root]);
  if (root && project.stageManager.get(root.uuid) !== root) throw new Error("根节点已改变，请重新读取引用后操作");
  const container = root?.parentSection;
  if (entries.length > 2000) throw new Error("单次最多生成2000个节点，请分批处理");
  if (
    entries.some(
      (entry, i) => entry.parent !== null && (!Number.isInteger(entry.parent) || entry.parent < 0 || entry.parent >= i),
    )
  )
    throw new Error("父子结构无效");
  if (!entries.length) return { success: true, nodeCount: 0, nodes: [], overlapCount: 0 };
  const nodes = entries.map((entry) => new TextNode(project, { text: entry.text }));
  const links = entries.flatMap((entry, i) =>
    entry.parent === null
      ? []
      : [
          {
            source: nodes[entry.parent].uuid,
            target: nodes[i].uuid,
          },
        ],
  );
  const rootRect = root ? objectRect(root) : undefined;
  const anchor =
    options.position ??
    (rootRect
      ? options.direction === "down"
        ? { x: rootRect.x, y: rootRect.y + rootRect.height + (options.levelGap ?? 100) }
        : { x: rootRect.x + rootRect.width + (options.levelGap ?? 100), y: rootRect.y }
      : { x: project.camera.location.x, y: project.camera.location.y });
  let planned = planTreeLayout(nodes.map(objectRect), links, { ...options, position: anchor });
  if (rootRect) {
    const bounds = boundsOf(planned);
    planned =
      options.direction === "down"
        ? translateLayout(planned, rootRect.x + rootRect.width / 2 - (bounds.x + bounds.width / 2), 0)
        : translateLayout(planned, 0, rootRect.y + rootRect.height / 2 - (bounds.y + bounds.height / 2));
  }
  const obstacles = obstaclesFor(project, [], container);
  planned = container
    ? placeInsideContainer(
        planned,
        obstacles,
        objectRect(container),
        options.safetyGap ?? 60,
        root ? (options.direction === "down" ? "y" : "x") : undefined,
      )
    : placeInFreeSpace(planned, obstacles, options.safetyGap ?? 60, options.direction === "down" ? "y" : "x");
  if (findOverlaps(planned, obstacles).length) throw new Error("创建前验证发现重叠，未创建节点");
  nodes.forEach((node, i) => setRect(node, planned[i]));
  const edges = entries.flatMap((entry, i) => {
    const parent = entry.parent === null ? root : nodes[entry.parent];
    if (!parent) return [];
    return [
      new LineEdge(project, {
        associationList: [parent, nodes[i]],
        sourceRectangleRate: options.direction === "down" ? new Vector(0.5, 1) : new Vector(1, 0.5),
        targetRectangleRate: options.direction === "down" ? new Vector(0.5, 0) : new Vector(0, 0.5),
      }),
    ];
  });
  const originalStage = [...project.stage];
  const originalChildren = container ? [...container.children] : undefined;
  const originalReferences = references.exportSnapshot();
  const batchId = crypto.randomUUID();
  try {
    for (const node of nodes) project.stageManager.add(node, true);
    for (const edge of edges) project.stageManager.add(edge, true);
    if (container) container.children.push(...nodes);
    project.stageManager.updateReferences();
    const result = nodes.map((node, i) => ({
      ref: references.getOrCreateRef(node),
      text: node.text,
      parentRef:
        entries[i].parent === null
          ? root
            ? references.getOrCreateRef(root)
            : null
          : references.getOrCreateRef(nodes[entries[i].parent!]),
      ...planned[i],
    }));
    project.historyManager.recordStep();
    for (const node of nodes) markAINodeOrigin(node, batchId);
    return {
      success: true,
      nodeCount: nodes.length,
      nodes: result,
      overlapCount: 0,
      batchId,
      direction: options.direction ?? "right",
      bounds: boundsOf(planned),
    };
  } catch (error) {
    project.stage = originalStage;
    if (container && originalChildren) container.children = originalChildren;
    project.stageManager.updateReferences();
    references.restoreSnapshot(originalReferences);
    throw error;
  }
}

export function moveAINodes(project: Project, nodes: Entity[], target: { x: number; y: number }, relative: boolean) {
  assertUnlocked(nodes);
  if (nodes.some((node) => project.stageManager.get(node.uuid) !== node))
    throw new Error("节点已改变，请重新读取引用后操作");
  const selected = new Set(nodes);
  const queue = [...nodes];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node instanceof Section)
      for (const child of node.children) {
        if (!selected.has(child)) {
          selected.add(child);
          queue.push(child);
        }
      }
  }
  if (queue.some((node) => node.parentSection && !selected.has(node.parentSection))) {
    throw new Error("请包含所属分组框一起平移，以保护分组结构");
  }
  if (
    queue.some((node) => node.collisionBox.shapes.length !== 1 || !(node.collisionBox.shapes[0] instanceof Rectangle))
  ) {
    throw new Error("整组平移目前支持矩形节点与分组框，不会修改涂鸦等非矩形对象");
  }
  const before = queue.map(objectRect);
  const bounds = boundsOf(before);
  const planned = translateLayout(
    before,
    relative ? target.x : target.x - bounds.x,
    relative ? target.y : target.y - bounds.y,
  );
  const obstacles = obstaclesFor(project, queue);
  if (planned.some((rect) => obstacles.some((other) => findOverlaps([rect], [other], 20).length))) {
    throw new Error("目标位置会覆盖其他节点，未移动；请换一个位置或使用自动布局");
  }
  try {
    // Avoid move(), whose collision physics can move nodes outside the requested group.
    queue.forEach((node, i) => setRect(node, planned[i]));
    project.historyManager.recordStep();
  } catch (error) {
    queue.forEach((node, i) => setRect(node, before[i]));
    throw error;
  }
  return { success: true, movedCount: queue.length, bounds: boundsOf(planned) };
}
