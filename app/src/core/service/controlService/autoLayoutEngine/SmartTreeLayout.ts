import {
  boundsOf,
  findOverlaps,
  translateLayout,
  type LayoutRect,
} from "@/core/service/dataManageService/aiEngine/AITreeLayout";

export type TreeDirection = "right" | "left" | "down" | "up";
export type SmartTreeOptions = {
  mode: "preserve" | "standard";
  direction: TreeDirection;
  levelGap: number;
  nodeGap: number;
  subtreeGap: number;
};
export type TreeLink = { source: string; target: string; direction: TreeDirection };

/** Ordered contour packing: sibling subtrees keep separate contours at every depth. */
function tidyBranch(
  nodes: LayoutRect[],
  links: TreeLink[],
  root: LayoutRect,
  direction: TreeDirection,
  options: SmartTreeOptions,
) {
  const vertical = direction === "up" || direction === "down";
  const negative = direction === "left" || direction === "up";
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const edge of links) children.get(edge.source)!.push(edge.target);
  const order = [root.id];
  const depth = new Map([[root.id, 0]]);
  const layerSizes: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i],
      node = byId.get(id)!,
      d = depth.get(id)!;
    layerSizes[d] = Math.max(layerSizes[d] ?? 0, vertical ? node.height : node.width);
    for (const child of children.get(id)!) {
      order.push(child);
      depth.set(child, d + 1);
    }
  }
  const layers = [0];
  for (let i = 1; i < layerSizes.length; i++) layers[i] = layers[i - 1] + layerSizes[i - 1] + options.levelGap;
  const contours = new Map<string, { low: number[]; high: number[] }>();
  const offsets = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i],
      node = byId.get(id)!,
      kids = children.get(id)!;
    const low: number[] = [],
      high: number[] = [];
    for (const child of kids) {
      const contour = contours.get(child)!;
      let shift = 0;
      for (let d = 0; d < Math.min(high.length, contour.low.length); d++) {
        shift = Math.max(shift, high[d] + (d === 0 ? options.nodeGap : options.subtreeGap) - contour.low[d]);
      }
      offsets.set(child, shift);
      for (let d = 0; d < contour.low.length; d++) {
        low[d] = Math.min(low[d] ?? Infinity, contour.low[d] + shift);
        high[d] = Math.max(high[d] ?? -Infinity, contour.high[d] + shift);
      }
    }
    const center = kids.length ? (offsets.get(kids[0])! + offsets.get(kids[kids.length - 1])!) / 2 : 0;
    for (const child of kids) offsets.set(child, offsets.get(child)! - center);
    const half = (vertical ? node.width : node.height) / 2;
    contours.set(id, { low: [-half, ...low.map((v) => v - center)], high: [half, ...high.map((v) => v - center)] });
  }
  const cross = new Map([[root.id, 0]]);
  for (const id of order) for (const child of children.get(id)!) cross.set(child, cross.get(id)! + offsets.get(child)!);
  const planned = order.map((id) => {
    const node = byId.get(id)!,
      d = depth.get(id)!,
      size = vertical ? node.height : node.width;
    const main = negative ? -layers[d] - size : layers[d];
    return {
      ...node,
      x: vertical ? cross.get(id)! - node.width / 2 : main,
      y: vertical ? main : cross.get(id)! - node.height / 2,
    };
  });
  const plannedRoot = planned[0];
  return translateLayout(planned, root.x - plannedRoot.x, root.y - plannedRoot.y);
}

export function planSmartTree(
  nodes: LayoutRect[],
  links: TreeLink[],
  rootId: string,
  options: SmartTreeOptions,
): LayoutRect[] {
  if (nodes.length > 2000) throw new Error("实验布局单棵树最多支持 2000 个节点，请选择较小子树");
  if (![options.levelGap, options.nodeGap, options.subtreeGap].every((v) => Number.isFinite(v) && v >= 1))
    throw new Error("布局间距必须是正数");
  if (nodes.some((n) => ![n.x, n.y, n.width, n.height].every(Number.isFinite) || n.width <= 0 || n.height <= 0))
    throw new Error("节点尺寸或坐标无效");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (byId.size !== nodes.length || !byId.has(rootId)) throw new Error("节点引用重复或根节点不存在");
  const children = new Map(nodes.map((n) => [n.id, [] as TreeLink[]]));
  const parents = new Set<string>();
  for (const link of links) {
    if (!byId.has(link.source) || !byId.has(link.target)) throw new Error("树边指向范围外节点");
    if (parents.has(link.target)) throw new Error("存在多父节点或重复树边；请将额外关联边标为虚线后再规整");
    parents.add(link.target);
    children.get(link.source)!.push(link);
  }
  const visited = new Set([rootId]),
    queue = [rootId];
  for (let i = 0; i < queue.length; i++)
    for (const edge of children.get(queue[i])!) {
      if (visited.has(edge.target)) throw new Error("存在环路，无法安全规整为树；未移动任何节点");
      visited.add(edge.target);
      queue.push(edge.target);
    }
  if (visited.size !== nodes.length || parents.has(rootId)) throw new Error("结构不是一棵有根树；未移动任何节点");
  const root = byId.get(rootId)!;
  if (options.mode === "standard") return tidyBranch(nodes, links, root, options.direction, options);
  const result = [root];
  // Each root-side is independent. A turn inside a branch is ambiguous, so preserve mode refuses it.
  for (const direction of ["right", "left", "down", "up"] as const) {
    const branchLinks = children.get(rootId)!.filter((e) => e.direction === direction);
    const members = new Set([rootId]);
    for (let i = 0; i < branchLinks.length; i++) {
      const edge = branchLinks[i];
      if (edge.direction !== direction)
        throw new Error("子树内部存在转向；智能规整保留方向，无法安全处理。可改选更小子树，或选择统一方向模式");
      members.add(edge.target);
      branchLinks.push(...children.get(edge.target)!);
    }
    if (members.size === 1) continue;
    result.push(
      ...tidyBranch(
        nodes.filter((n) => members.has(n.id)),
        branchLinks,
        root,
        direction,
        options,
      ).slice(1),
    );
  }
  if (findOverlaps(result).length)
    throw new Error("混合方向分支无法同时保持方向并消除重叠；未移动任何节点，请改选较小子树或使用统一方向模式");
  return result;
}

export { boundsOf, findOverlaps };
