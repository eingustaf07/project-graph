import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";

export type LayoutRect = { id: string; x: number; y: number; width: number; height: number };
const aiNodeOrigins = new WeakMap<Entity, { createdBy: "ai"; batchId: string; scope: "current-runtime" }>();
export function getAINodeOrigin(node: Entity) {
  return aiNodeOrigins.get(node) ?? { createdBy: "unknown", scope: "current-runtime" };
}
export function markAINodeOrigin(node: Entity, batchId: string) {
  aiNodeOrigins.set(node, { createdBy: "ai", batchId, scope: "current-runtime" });
}
export function objectRect(node: Entity): LayoutRect {
  const rect = node.collisionBox.getRectangle();
  return { id: node.uuid, x: rect.location.x, y: rect.location.y, width: rect.size.x, height: rect.size.y };
}
export type LayoutLink = { source: string; target: string };
export type AITreeLayoutOptions = {
  direction?: "right" | "down";
  levelGap?: number;
  nodeGap?: number;
  treeGap?: number;
  safetyGap?: number;
  position?: { x: number; y: number };
};

export function boundsOf(rects: LayoutRect[]): LayoutRect {
  if (!rects.length) throw new Error("没有可布局的节点");
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const rect of rects) {
    x = Math.min(x, rect.x);
    y = Math.min(y, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return {
    id: "bounds",
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function overlaps(a: LayoutRect, b: LayoutRect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
  );
}

export function findOverlaps(rects: LayoutRect[], obstacles: LayoutRect[] = [], gap = 0) {
  const pairs: { first: string; second: string }[] = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (overlaps(rects[i], rects[j], gap)) pairs.push({ first: rects[i].id, second: rects[j].id });
    }
    for (const other of obstacles) {
      if (overlaps(rects[i], other, gap)) pairs.push({ first: rects[i].id, second: other.id });
    }
  }
  return pairs;
}

export function translateLayout(rects: LayoutRect[], x: number, y: number): LayoutRect[] {
  return rects.map((r) => ({ ...r, x: r.x + x, y: r.y + y }));
}

// Move the whole envelope, never individual branches, so obstacle avoidance preserves symmetry.
export function placeInFreeSpace(
  rects: LayoutRect[],
  obstacles: LayoutRect[],
  gap = 60,
  axis: "x" | "y" = "x",
): LayoutRect[] {
  const envelope = boundsOf(rects);
  let offset = 0;
  for (let attempt = 0; attempt <= obstacles.length; attempt++) {
    const hits = obstacles.filter((other) => overlaps({ ...envelope, [axis]: envelope[axis] + offset }, other, gap));
    if (!hits.length) return translateLayout(rects, axis === "x" ? offset : 0, axis === "y" ? offset : 0);
    for (const other of hits)
      offset = Math.max(offset, other[axis] + (axis === "x" ? other.width : other.height) + gap - envelope[axis]);
  }
  throw new Error("无法找到安全空白区域，本次操作未应用");
}

export function placeInsideContainer(
  rects: LayoutRect[],
  obstacles: LayoutRect[],
  container: LayoutRect,
  gap = 40,
  axis?: "x" | "y",
) {
  const bounds = boundsOf(rects);
  const inner = {
    x: container.x + 30,
    y: container.y + 80,
    right: container.x + container.width - 30,
    bottom: container.y + container.height - 30,
  };
  const xs =
    axis === "y" ? [bounds.x] : [Math.max(inner.x, bounds.x), inner.x, ...obstacles.map((r) => r.x + r.width + gap)];
  const ys =
    axis === "x" ? [bounds.y] : [Math.max(inner.y, bounds.y), inner.y, ...obstacles.map((r) => r.y + r.height + gap)];
  for (const y of ys)
    for (const x of xs) {
      if (x < inner.x || y < inner.y || x + bounds.width > inner.right || y + bounds.height > inner.bottom) continue;
      const candidate = { ...bounds, x, y };
      if (obstacles.every((r) => !overlaps(candidate, r, gap)))
        return translateLayout(rects, x - bounds.x, y - bounds.y);
    }
  throw new Error("分组框内没有足够空白空间；请先扩大分组框，原图与本次操作均未改变");
}

/** Iterative postorder uses measured rectangles; neither deep trees nor cycles recurse. */
export function planTreeLayout(
  nodes: LayoutRect[],
  links: LayoutLink[],
  options: AITreeLayoutOptions = {},
): LayoutRect[] {
  if (!nodes.length) return [];
  const ids = new Map(nodes.map((node, i) => [node.id, i]));
  if (ids.size !== nodes.length) throw new Error("节点引用重复");
  for (const node of nodes) {
    if (![node.width, node.height, node.x, node.y].every(Number.isFinite) || node.width <= 0 || node.height <= 0) {
      throw new Error("节点尺寸或坐标无效");
    }
  }
  const down = options.direction === "down";
  const levelGap = Math.max(1, options.levelGap ?? 100);
  const nodeGap = Math.max(1, options.nodeGap ?? 40);
  const treeGap = Math.max(nodeGap, options.treeGap ?? 80);
  const children = nodes.map(() => [] as number[]);
  const parents = nodes.map(() => [] as number[]);
  for (const link of links) {
    const source = ids.get(link.source),
      target = ids.get(link.target);
    if (source === undefined || target === undefined) continue;
    if (!children[source].includes(target)) {
      children[source].push(target);
      parents[target].push(source);
    }
  }
  const indegrees = parents.map((list) => list.length);
  const queue = nodes.map((_, i) => i).filter((i) => indegrees[i] === 0);
  const roots = [...queue];
  const depth = nodes.map(() => 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const child of children[queue[cursor]]) {
      depth[child] = Math.max(depth[child], depth[queue[cursor]] + 1);
      if (--indegrees[child] === 0) queue.push(child);
    }
  }
  if (queue.length !== nodes.length) throw new Error("存在循环连线，请使用整组平移；不能把循环关系改造成树");
  const breadth = nodes.map((n) => (down ? n.width : n.height));
  const length = nodes.map((n) => (down ? n.height : n.width));
  const layerSizes: number[] = [];
  for (let i = 0; i < nodes.length; i++) layerSizes[depth[i]] = Math.max(layerSizes[depth[i]] ?? 0, length[i]);
  const layerStarts = [0];
  for (let i = 1; i < layerSizes.length; i++) layerStarts[i] = layerStarts[i - 1] + layerSizes[i - 1] + levelGap;
  const cross = nodes.map(() => 0);
  if (parents.every((list) => list.length <= 1)) {
    const spans = [...breadth];
    for (let i = queue.length - 1; i >= 0; i--) {
      const index = queue[i];
      if (children[index].length)
        spans[index] = Math.max(
          breadth[index],
          children[index].reduce((sum, child) => sum + spans[child], 0) + nodeGap * (children[index].length - 1),
        );
    }
    const starts = nodes.map(() => 0);
    let start = 0;
    for (const root of roots) {
      starts[root] = start;
      start += spans[root] + treeGap;
    }
    for (const index of queue) {
      cross[index] = starts[index] + (spans[index] - breadth[index]) / 2;
      const groupSpan =
        children[index].reduce((sum, child) => sum + spans[child], 0) +
        nodeGap * Math.max(0, children[index].length - 1);
      let cursor = starts[index] + (spans[index] - groupSpan) / 2;
      for (const child of children[index]) {
        starts[child] = cursor;
        cursor += spans[child] + nodeGap;
      }
    }
  } else {
    // Shared children are retained as a DAG, rather than duplicated or assigned a different parent.
    const layers = layerSizes.map(() => [] as number[]);
    for (const index of queue) layers[depth[index]].push(index);
    for (const layer of layers) {
      const total = layer.reduce((sum, i) => sum + breadth[i], 0) + nodeGap * (layer.length - 1);
      let cursor = -total / 2;
      for (const index of layer) {
        cross[index] = cursor;
        cursor += breadth[index] + nodeGap;
      }
    }
  }
  const planned = nodes.map((node, i) => ({
    ...node,
    x: down ? cross[i] : layerStarts[depth[i]] + (layerSizes[depth[i]] - length[i]) / 2,
    y: down ? layerStarts[depth[i]] + (layerSizes[depth[i]] - length[i]) / 2 : cross[i],
  }));
  const bounds = boundsOf(planned);
  const origin = options.position ?? boundsOf(nodes);
  return translateLayout(planned, origin.x - bounds.x, origin.y - bounds.y);
}

export type AITreeEntry = { text: string; parent: number | null };
export function parseIndentedTree(text: string) {
  const entries: AITreeEntry[] = [];
  const stack: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const whitespace = line.match(/^[ \t]*/)![0].replace(/\t/g, "  ");
    if (whitespace.length % 2) throw new Error("每层必须缩进两个空格，未创建任何节点");
    const depth = whitespace.length / 2;
    if (depth > stack.length) throw new Error("缩进跳过了父级，未创建任何节点");
    const parent = depth ? stack[depth - 1] : null;
    entries.push({ text: line.trim().replaceAll("\\n", "\n").replaceAll("\\t", "\t"), parent });
    stack[depth] = entries.length - 1;
    stack.length = depth + 1;
    if (entries.length > 2000) throw new Error("单次最多生成 2000 个节点，请分批处理");
  }
  return entries;
}
