import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import {
  ConnectableEntity,
  type CrossFileEdgeStyle,
  type CrossFileNodeLink,
} from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { URI } from "vscode-uri";

export type NodeEndpoint = { project: Project; nodeId: string };

export function fileKey(file: string): string {
  const uri = URI.parse(file);
  if (uri.scheme !== "file" || uri.query || uri.fragment) return "";
  return uri.toString().toLowerCase();
}

export function endpointNode(endpoint: NodeEndpoint): ConnectableEntity | undefined {
  return endpoint.project.stage.find(
    (node): node is ConnectableEntity => node instanceof ConnectableEntity && node.uuid === endpoint.nodeId,
  );
}

export function addCrossFileConnection(source: NodeEndpoint, target: NodeEndpoint): CrossFileNodeLink {
  if (!Settings.enableCrossFileConnections || Settings.viewerMode)
    throw new Error("跨文件连接未启用，或当前为只读模式");
  if (source.project.closing || target.project.closing) throw new Error("文件正在关闭，请重新选择");
  const sourceFile = fileKey(source.project.uri.toString());
  const targetFile = fileKey(target.project.uri.toString());
  if (!sourceFile || !targetFile) throw new Error("请先将两个临时草稿保存为本地 .prg 文件");
  if (sourceFile === targetFile) throw new Error("请选择另一个文件中的节点；同文件请使用原有连线方式");
  const from = endpointNode(source),
    to = endpointNode(target);
  if (!from || !to) throw new Error("节点已删除或文件已关闭，请重新选择");
  if (source.project.sectionMethods.isObjectBeLockedBySection(from)) throw new Error("起点节点已锁定");
  if (from.crossFileLinks?.some((link) => fileKey(link.targetFile) === targetFile && link.targetNode === to.uuid))
    throw new Error("这两个节点之间已存在相同方向的跨文件连接");
  const link = {
    curve: Settings.lineStyle !== "vertical" && Settings.rightClickConnectEdgeType === "arc",
    id: crypto.randomUUID(),
    targetFile: target.project.uri.toString(),
    targetNode: to.uuid,
  };
  from.crossFileLinks = [...(from.crossFileLinks ?? []), link];
  source.project.historyManager.recordStep();
  return link;
}

export function editCrossFileConnection(source: NodeEndpoint, id: string, patch: CrossFileEdgeStyle) {
  if (!Settings.enableCrossFileConnections || Settings.viewerMode || source.project.closing)
    throw new Error("当前不能修改跨文件连接");
  const node = endpointNode(source);
  if (!node || source.project.sectionMethods.isObjectBeLockedBySection(node)) throw new Error("起点已删除或锁定");
  const link = node.crossFileLinks?.find((item) => item.id === id);
  if (!link || Object.entries(patch).every(([key, value]) => link[key as keyof CrossFileEdgeStyle] === value)) return;
  node.crossFileLinks = node.crossFileLinks!.map((item) => (item === link ? { ...link, ...patch } : item));
  source.project.historyManager.recordStep();
}

export function removeCrossFileConnection(source: NodeEndpoint, id: string): void {
  if (!Settings.enableCrossFileConnections || Settings.viewerMode) throw new Error("当前不能修改跨文件连接");
  const node = endpointNode(source);
  if (!node) throw new Error("起点节点已不存在");
  if (source.project.sectionMethods.isObjectBeLockedBySection(node)) throw new Error("起点节点已锁定");
  if (!node.crossFileLinks?.some((link) => link.id === id)) return;
  node.crossFileLinks = node.crossFileLinks.filter((link) => link.id !== id);
  source.project.historyManager.recordStep();
}

export function resolveCrossFileTarget(
  link: CrossFileNodeLink,
  projects: readonly Project[],
): NodeEndpoint | undefined {
  const key = fileKey(link.targetFile);
  if (!key) return;
  const project = projects.find((candidate) => !candidate.closing && fileKey(candidate.uri.toString()) === key);
  if (!project) return;
  const endpoint = { project, nodeId: link.targetNode };
  return endpointNode(endpoint) ? endpoint : undefined;
}
