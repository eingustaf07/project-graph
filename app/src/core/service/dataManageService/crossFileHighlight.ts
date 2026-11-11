import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { collectChainNodeIds, collectConnectedNodeIds } from "@/core/algorithm/connectedNodeHighlight";
import { fileKey } from "./CrossFileConnections";

let projects: readonly Project[] = [];
let revision = 0;
let cacheRevision = -1;
let cachedScope = "";
let highlighted = new Map<Project, ConnectableEntity[]>();
let hasLinks = false;
let frame = 0;

export function setHighlightProjects(open: readonly Project[]) {
  projects = open;
  invalidateCrossFileHighlight();
}
export function invalidateCrossFileHighlight() {
  revision++;
  if (!frame && projects.length && typeof requestAnimationFrame === "function") {
    frame = requestAnimationFrame(() => {
      frame = 0;
      // Draw one frame on visible, paused panes so changes from another pane are visible.
      for (const p of projects) {
        if (!p.closing && !p.isRunning && p.canvas?.element.isConnected && !p.canvas.element.closest("[hidden]")) {
          p.controller?.resetCountdownTimer?.();
          p.renderer?.tick?.();
        }
      }
    });
  }
}

export function crossFileHighlightCount() { return [...highlighted.values()].reduce((sum,nodes)=>sum+nodes.length,0); }

export function crossFileHighlighted(project: Project): readonly ConnectableEntity[] | undefined {
  if (!Settings.enableCrossFileConnections || projects.length < 2 || !projects.includes(project)) return;
  const scope = Settings.connectedNodeHighlightScope;
  const cacheKey = scope + Settings.connectedNodeHighlightLocked;
  if (cacheRevision !== revision || cachedScope !== cacheKey) {
    cacheRevision = revision;
    cachedScope = cacheKey;
    highlighted = new Map();
    hasLinks = false;
    const groups = projects.map((p) => p.searchContentHighlightRenderer?.crossFileRoots() ?? new Set<string>());
    if (groups.some((roots) => roots.size)) {
      const nodes = new Map<string, { project: Project; node: ConnectableEntity }>();
      const members: { uuid: string }[][] = [];
      const directed: { source: { uuid: string }; target: { uuid: string } }[] = [];
      const roots = new Set<string>();
      const files = new Map(projects.map((p, i) => [fileKey(p.uri.toString()), i]));
      for (const [i, p] of projects.entries()) {
        const key = (node: ConnectableEntity) => ({ uuid: i + "/" + node.uuid });
        for (const object of p.stage) {
          if (object instanceof ConnectableEntity) {
            nodes.set(key(object).uuid, { project: p, node: object });
            if (groups[i].has(object.uuid)) roots.add(key(object).uuid);
            for (const link of object.crossFileLinks ?? []) {
              const other = files.get(fileKey(link.targetFile));
              if (other === undefined || other === i) continue;
              const a = key(object),
                b = { uuid: other + "/" + link.targetNode };
              members.push([a, b]);
              if (link.direction !== "undirected")
                directed.push(link.direction === "reverse" ? { source: b, target: a } : { source: a, target: b });
              hasLinks = true;
            }
          } else if (object instanceof ConnectableAssociation) {
            members.push(object.associationList.map(key));
            if (object instanceof Edge) directed.push({ source: key(object.source), target: key(object.target) });
          }
        }
      }
      if (hasLinks) {
        const ids =
          scope === "chain"
            ? collectChainNodeIds(nodes.keys(), directed, roots)
            : collectConnectedNodeIds(nodes.keys(), members, roots, scope);
        for (const id of ids) {
          const entry = nodes.get(id)!;
          const list = highlighted.get(entry.project) ?? [];
          list.push(entry.node);
          highlighted.set(entry.project, list);
        }
      }
    }
  }
  return hasLinks ? (highlighted.get(project) ?? []) : undefined;
}
