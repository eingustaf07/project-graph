import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "jotai";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Project } from "@/core/Project";
import { tabsAtom, activeResourceTabAtom, store } from "@/state";
import { Settings } from "@/core/service/Settings";
import { isSelectionMode } from "@/core/service/controlService/selectionMode";
import { isDesktop } from "@/utils/platform";
import {
  ConnectableEntity,
  type CrossFileEdgeStyle,
  type CrossFileNodeLink,
} from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import {
  fileKey,
  addCrossFileConnectionToReference,
  editCrossFileConnection,
  removeCrossFileConnection,
} from "@/core/service/dataManageService/CrossFileConnections";
import {
  CrossWindowConnectionBus,
  adjacentWindowGeometries,
  screenToClient,
  type WindowGraphSnapshot,
  type WindowGeometry,
  type FileNodeRef,
  type WindowFileGraph,
} from "@/core/service/dataManageService/CrossWindowConnections";
import { setRemoteHighlightGraphs } from "@/core/service/dataManageService/crossFileHighlight";
import { Button } from "./ui/button";

type VisibleLink = {
  owner: string;
  source: FileNodeRef;
  link: CrossFileNodeLink;
  routing?: string;
  scale?: number;
  a: { x: number; y: number };
  b: { x: number; y: number };
};

async function readGeometry(): Promise<WindowGeometry | undefined> {
  if (!isDesktop) {
    const scale = window.devicePixelRatio || 1;
    return {
      outer: {
        x: window.screenX * scale,
        y: window.screenY * scale,
        width: window.outerWidth * scale,
        height: window.outerHeight * scale,
      },
      origin: { x: window.screenX * scale, y: window.screenY * scale },
      scale,
    };
  }
  const native = getCurrentWindow();
  const [origin, position, size, contentSize, scale, minimized, visible] = await Promise.all([
    native.innerPosition(),
    native.outerPosition(),
    native.outerSize(),
    native.innerSize(),
    native.scaleFactor(),
    native.isMinimized(),
    native.isVisible(),
  ]);
  if (minimized || !visible || !Number.isFinite(scale) || scale <= 0) return;
  return { origin, outer: { ...position, ...size }, content: { ...origin, ...contentSize }, scale };
}

export default function CrossWindowConnections() {
  const tabs = useAtomValue(tabsAtom);
  const projects = useRef<Project[]>([]);
  projects.current = tabs.filter((p): p is Project => p instanceof Project && !p.closing);
  const [view, setView] = useState<{ geometry?: WindowGeometry; links: VisibleLink[] }>({ links: [] });
  const [selected, setSelected] = useState<VisibleLink>();
  const bus = useRef<CrossWindowConnectionBus | undefined>(undefined);
  const local = useRef<WindowGraphSnapshot | undefined>(undefined);
  const lastAction = useRef<{ owner: string; source: FileNodeRef } | undefined>(undefined);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel("project-graph-cross-window-v1");
    } catch (error) {
      toast.error("跨窗口连接暂不可用：" + String(error));
      return;
    }
    const id = crypto.randomUUID();
    let disposed = false;
    let geometry: WindowGeometry | undefined;
    let readingGeometry = false;
    let pendingGeometry = false;
    let selectionSignature: string | undefined;
    let selectedAt = 0;
    const open = [...projects.current];
    let previousFiles: WindowFileGraph[] = [];
    const cache = new Map<Project, { stamp: unknown; graph: WindowFileGraph }>();
    const findSource = (source: FileNodeRef) => {
      const project = projects.current.find((p) => fileKey(p.uri.toString()) === source.file);
      if (!project) throw new Error("连线来源文件已关闭");
      return { project, nodeId: source.nodeId };
    };
    const draw = () => {
      if (disposed || !local.current?.geometry) return;
      const current = local.current;
      const snapshots = peer.snapshots();
      const neighbors = snapshots.filter((p) => p.geometry && adjacentWindowGeometries(current.geometry!, p.geometry));
      setRemoteHighlightGraphs(snapshots.flatMap((p) => p.files));
      const links: VisibleLink[] = [];
      for (const remote of neighbors) {
        for (const [owner, other] of [
          [current, remote],
          [remote, current],
        ]) {
          for (const file of owner.files)
            for (const edge of file.links) {
              const target = fileKey(edge.link.targetFile);
              if (!other.files.some((f) => f.file === target)) continue;
              const a = owner.points.find((p) => p.file === file.file && p.nodeId === edge.source);
              const b = other.points.find((p) => p.file === target && p.nodeId === edge.link.targetNode);
              if (a && b) {
                const boundary = (from: typeof a, to: typeof b) => {
                  const dx = to.x - from.x,
                    dy = to.y - from.y;
                  const ratio = Math.min(
                    dx ? Math.abs((from.halfWidth ?? 0) / dx) : Infinity,
                    dy ? Math.abs((from.halfHeight ?? 0) / dy) : Infinity,
                    0.49,
                  );
                  return { x: from.x + dx * ratio, y: from.y + dy * ratio };
                };
                links.push({
                  owner: owner.id,
                  source: { file: file.file, nodeId: edge.source },
                  link: edge.link,
                  routing: owner.lineStyle,
                  scale: owner.geometry!.scale / current.geometry!.scale,
                  a: screenToClient(boundary(a, b), current.geometry!),
                  b: screenToClient(boundary(b, a), current.geometry!),
                });
              }
            }
        }
      }
      setView((old) =>
        JSON.stringify(old.geometry) === JSON.stringify(geometry) && JSON.stringify(old.links) === JSON.stringify(links)
          ? old
          : { geometry, links },
      );
    };
    const peer: CrossWindowConnectionBus = new CrossWindowConnectionBus(id, channel, draw, async (request) => {
      const currentGeometry = await readGeometry(),
        sender = peer.snapshots().find((p) => p.id === request.from);
      if (
        disposed ||
        !currentGeometry ||
        !sender?.geometry ||
        !adjacentWindowGeometries(currentGeometry, sender.geometry)
      )
        throw new Error("两个窗口已分开，请重新贴合后操作");
      const source = findSource(request.source);
      if (Settings.viewerMode || source.project.closing) throw new Error("来源文件当前不可修改");
      if (request.action === "connect") addCrossFileConnectionToReference(source, request.target!);
      else if (request.action === "edit") editCrossFileConnection(source, request.linkId!, request.patch!);
      else if (request.action === "remove") removeCrossFileConnection(source, request.linkId!);
      else if (request.action === "undo") source.project.historyManager.undo();
      else source.project.historyManager.redo();
      cache.delete(source.project);
    });
    bus.current = peer;
    const refreshGeometry = async () => {
      if (disposed) return;
      if (readingGeometry) {
        pendingGeometry = true;
        return;
      }
      readingGeometry = true;
      try {
        geometry = await readGeometry();
      } catch (e) {
        geometry = undefined;
        toast.error("无法读取窗口位置：" + String(e));
      } finally {
        readingGeometry = false;
        if (pendingGeometry) {
          pendingGeometry = false;
          void refreshGeometry();
        }
      }
    };
    const publish = () => {
      if (disposed) return;
      const files: WindowFileGraph[] = [];
      const interested = new Set<string>();
      const peers = peer.snapshots();
      for (const remote of peers)
        for (const file of remote.files)
          for (const { link } of file.links) interested.add(fileKey(link.targetFile) + "/" + link.targetNode);
      const points: WindowGraphSnapshot["points"] = [];
      const selectedNodes: FileNodeRef[] = [];
      for (const p of projects.current) {
        const file = fileKey(p.uri.toString());
        if (!file) continue;
        const stamp = p.stageManager.topLevelEntities ?? p.stage;
        let cached = cache.get(p);
        if (!cached || cached.stamp !== stamp) {
          const nodes = p.stage.filter((n): n is ConnectableEntity => n instanceof ConnectableEntity);
          const edges = p.stage.filter((n): n is ConnectableAssociation => n instanceof ConnectableAssociation);
          cached = {
            stamp,
            graph: {
              file,
              nodes: nodes.map((n) => n.uuid),
              members: edges.map((e) => e.associationList.map((n) => n.uuid)),
              directed: edges
                .filter((e): e is Edge => e instanceof Edge)
                .map((e) => ({ source: e.source.uuid, target: e.target.uuid })),
              links: nodes.flatMap((n) => (n.crossFileLinks ?? []).map((link) => ({ source: n.uuid, link }))),
              roots: [],
            },
          };
          cache.set(p, cached);
        }
        const roots = [...(p.searchContentHighlightRenderer?.crossFileRoots() ?? [])];
        files.push({ ...cached.graph, roots });
        for (const n of p.stage) {
          if (!(n instanceof ConnectableEntity)) continue;
          if (n.isSelected && store.get(activeResourceTabAtom) === p) selectedNodes.push({ file, nodeId: n.uuid });
          if (!peers.length) continue;
          if (!(n.isSelected || n.crossFileLinks?.length || interested.has(file + "/" + n.uuid))) continue;
          if (!geometry || n.isHiddenBySectionCollapse || !p.canvas.element.isConnected) continue;
          const client = p.canvas.viewToClient(p.renderer.transformWorld2View(n.geometryCenter));
          const bounds = p.canvas.element.getBoundingClientRect();
          if (client.x < bounds.left || client.x > bounds.right || client.y < bounds.top || client.y > bounds.bottom)
            continue;
          const hit = document.elementFromPoint(client.x, client.y);
          if (hit !== p.canvas.element && !hit?.closest("[data-cross-window-edges]")) continue;
          const rectangle = n.collisionBox.getRectangle();
          const corner = p.canvas.viewToClient(p.renderer.transformWorld2View(rectangle.location));
          points.push({
            file,
            nodeId: n.uuid,
            x: geometry.origin.x + client.x * geometry.scale,
            y: geometry.origin.y + client.y * geometry.scale,
            halfWidth: Math.abs(client.x - corner.x) * geometry.scale,
            halfHeight: Math.abs(client.y - corner.y) * geometry.scale,
          });
        }
      }
      const signature = JSON.stringify(selectedNodes);
      if (signature !== selectionSignature) {
        // Observe background selections too. Focusing or zooming must not turn
        // an old selection into a newer connection source in another window.
        if (selectionSignature !== undefined && document.hasFocus()) selectedAt = Date.now();
        selectionSignature = signature;
      }
      const selection = selectedNodes.length === 1 ? { ...selectedNodes[0], at: selectedAt } : undefined;
      const sameFiles =
        files.length === previousFiles.length &&
        files.every((f, i) => {
          const prior = previousFiles[i];
          return (
            f.file === prior.file &&
            f.nodes === prior.nodes &&
            f.members === prior.members &&
            f.links === prior.links &&
            JSON.stringify(f.roots) === JSON.stringify(prior.roots)
          );
        });
      if (!sameFiles) previousFiles = files;
      local.current = { id, geometry, files: previousFiles, points, selection, lineStyle: Settings.lineStyle };
      peer.publish(local.current);
      draw();
    };
    const invalidate = () => cache.clear();
    for (const p of open) {
      p.on("stage-commit", invalidate);
      p.on("state-change", invalidate);
    }
    void refreshGeometry();
    const unlisten: (() => void)[] = [];
    if (isDesktop) {
      const observe = async () => {
        const native = getCurrentWindow(),
          changed = () => void refreshGeometry();
        const observers = [
          native.onMoved?.(changed),
          native.onResized?.(changed),
          native.onScaleChanged?.(changed),
          native.onFocusChanged?.(changed),
        ].filter(Boolean);
        const listeners = await Promise.allSettled(observers);
        let failure: unknown;
        for (const result of listeners) {
          if (result.status === "rejected") {
            failure = result.reason;
            continue;
          }
          const stop = result.value;
          if (!stop) continue;
          if (disposed) stop();
          else unlisten.push(stop);
        }
        if (failure) throw failure;
      };
      void observe().catch((error) => toast.error("无法监听窗口位置变化：" + String(error)));
    }
    window.addEventListener("resize", refreshGeometry);
    document.addEventListener("visibilitychange", refreshGeometry);
    const timer = window.setInterval(publish, 180);
    const targetAt = (x: number, y: number) => {
      const canvas = document.elementFromPoint(x, y);
      const p = projects.current.find((p) => p.canvas.element === canvas);
      if (!p) return;
      const node = p.stageManager.findConnectableEntityByLocation(
        p.renderer.transformView2World(p.canvas.clientToView(x, y)),
      );
      return node ? { file: fileKey(p.uri.toString()), nodeId: node.uuid } : undefined;
    };
    let gesture:
      | {
          peer: string;
          source: FileNodeRef;
          target: FileNodeRef;
          x: number;
          y: number;
          pointer: number;
          moved: boolean;
        }
      | undefined;
    const down = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-cross-window-edges], [data-cross-window-editor]")
      ) {
        setSelected(undefined);
        lastAction.current = undefined;
      }
      gesture = undefined;
      if (
        event.button !== 2 ||
        Settings.viewerMode ||
        !Settings.enableRightClickConnect ||
        !isSelectionMode(Settings.mouseLeftMode)
      )
        return;
      const target = targetAt(event.clientX, event.clientY);
      if (!target?.file || !geometry) return;
      const candidates = peer
        .snapshots()
        .filter((p) => p.selection && p.geometry && adjacentWindowGeometries(geometry!, p.geometry))
        .sort((a, b) => b.selection!.at - a.selection!.at);
      const source = candidates[0];
      if (!source?.selection || (local.current?.selection?.at ?? 0) > source.selection.at) return;
      if (source.selection.file === target.file) return;
      gesture = {
        peer: source.id,
        source: source.selection,
        target,
        x: event.clientX,
        y: event.clientY,
        pointer: event.pointerId,
        moved: false,
      };
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const move = (event: PointerEvent) => {
      if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
    };
    const up = (event: PointerEvent) => {
      if (event.button === 0) {
        const project = projects.current.find((p) => p.canvas.element === event.target);
        const target = project && targetAt(event.clientX, event.clientY);
        if (target && project?.stage.some((node) => node.uuid === target.nodeId && node.isSelected))
          selectedAt = Date.now();
        publish();
        return;
      }
      if (!gesture || event.button !== 2 || event.pointerId !== gesture.pointer) return;
      const g = gesture;
      gesture = undefined;
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = targetAt(event.clientX, event.clientY);
      if (g.moved || target?.file !== g.target.file || target.nodeId !== g.target.nodeId) return;
      void (async () => {
        geometry = await readGeometry();
        publish();
        await peer.request(g.peer, "connect", g.source, { target: g.target });
        lastAction.current = { owner: g.peer, source: g.source };
      })().catch((e) => toast.error(String(e)));
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    const cancel = () => {
      gesture = undefined;
    };
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      disposed = true;
      clearInterval(timer);
      unlisten.forEach((stop) => stop());
      window.removeEventListener("resize", refreshGeometry);
      document.removeEventListener("visibilitychange", refreshGeometry);
      for (const p of open) {
        p.off("stage-commit", invalidate);
        p.off("state-change", invalidate);
      }
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
      peer.dispose();
      bus.current = undefined;
      local.current = undefined;
      setRemoteHighlightGraphs([]);
    };
  }, [tabs]);

  const change = async (row: VisibleLink, action: "edit" | "remove" | "undo" | "redo", patch?: CrossFileEdgeStyle) => {
    if (Settings.viewerMode) return;
    try {
      if (row.owner === local.current?.id) {
        const p = projects.current.find((p) => fileKey(p.uri.toString()) === row.source.file);
        if (!p) throw new Error("来源文件已关闭");
        const endpoint = { project: p, nodeId: row.source.nodeId };
        if (action === "edit") editCrossFileConnection(endpoint, row.link.id, patch!);
        else if (action === "remove") removeCrossFileConnection(endpoint, row.link.id);
        else if (action === "undo") p.historyManager.undo();
        else p.historyManager.redo();
      } else await bus.current?.request(row.owner, action, row.source, { linkId: row.link.id, patch });
      lastAction.current = { owner: row.owner, source: row.source };
      if (patch) setSelected({ ...row, link: { ...row.link, ...patch } });
      if (action === "remove") setSelected(undefined);
    } catch (e) {
      toast.error(String(e));
    }
  };
  useEffect(() => {
    if (selected && !view.links.some((row) => row.owner === selected.owner && row.link.id === selected.link.id))
      setSelected(undefined);
  }, [view.links, selected]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.matches("input,textarea,select") || e.target.isContentEditable))
        return;
      if (e.key === "Escape") {
        setSelected(undefined);
        lastAction.current = undefined;
      }
      const history = lastAction.current;
      if ((e.ctrlKey || e.metaKey) && history && ["z", "y"].includes(e.key.toLowerCase())) {
        const action = e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo";
        e.preventDefault();
        e.stopImmediatePropagation();
        void change(
          selected ?? {
            ...history,
            link: { id: "", targetFile: "", targetNode: "" },
            a: { x: 0, y: 0 },
            b: { x: 0, y: 0 },
          },
          action,
        );
      } else if (
        selected &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        ["Backspace", "Delete", "r", "g"].includes(e.key)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === "r")
          void change(selected, "edit", { direction: selected.link.direction === "reverse" ? "forward" : "reverse" });
        else if (e.key === "g") void change(selected, "edit", { direction: "undirected" });
        else void change(selected, "remove");
      } else if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
        lastAction.current = undefined;
        if (selected) setSelected(undefined);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  return createPortal(
    <>
      <svg
        data-cross-window-edges=""
        aria-label="跨窗口连接线"
        className="pointer-events-none fixed inset-0 z-40 h-full w-full overflow-hidden"
      >
        {view.links.map((row) => {
          const scale = row.scale ?? 1;
          const a = row.link.direction === "reverse" ? row.b : row.a,
            b = row.link.direction === "reverse" ? row.a : row.b;
          const middle = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2,
            off = row.link.curve ? Math.min(48 * (row.scale ?? 1), Math.hypot(b.x - a.x, b.y - a.y) / 8) : 0;
          const path =
            row.routing === "vertical"
              ? `M ${a.x} ${a.y} L ${middle} ${a.y} L ${middle} ${b.y} L ${b.x} ${b.y}`
              : off
                ? `M ${a.x} ${a.y} Q ${middle} ${midY - off} ${b.x} ${b.y}`
                : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
          const marker = "window-edge-" + row.link.id;
          return (
            <g key={row.owner + row.link.id}>
              <defs>
                <marker
                  id={marker}
                  markerUnits="userSpaceOnUse"
                  markerWidth={13 * scale}
                  markerHeight={12 * scale}
                  viewBox="0 0 13 12"
                  refX="12"
                  refY="6"
                  orient="auto"
                >
                  <path
                    d={row.link.arrow?.includes("diamond") ? "M1 6 L6 1 L12 6 L6 11 Z" : "M1 1 L12 6 L1 11 Z"}
                    stroke={row.link.color ?? "var(--foreground)"}
                    fill={
                      row.link.arrow?.startsWith("hollow")
                        ? "var(--background)"
                        : (row.link.color ?? "var(--foreground)")
                    }
                  />
                </marker>
              </defs>
              {row.link.lineType === "double" && (
                <path d={path} fill="none" stroke={row.link.color ?? "var(--foreground)"} strokeWidth={6 * scale} />
              )}
              <path
                d={path}
                fill="none"
                stroke={row.link.color ?? "var(--foreground)"}
                strokeWidth={(selected?.link.id === row.link.id ? 4 : 2) * scale}
                strokeDasharray={row.link.lineType === "dashed" ? `${7 * scale} ${5 * scale}` : undefined}
                markerEnd={row.link.direction === "undirected" ? undefined : `url(#${marker})`}
              />
              {row.link.lineType === "double" && (
                <path d={path} fill="none" stroke="var(--background)" strokeWidth={2 * scale} />
              )}
              {[a, b].map((point, i) => (
                <circle key={i} cx={point.x} cy={point.y} r={2.5} fill={row.link.color ?? "var(--foreground)"} />
              ))}
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={12 * scale}
                style={{ pointerEvents: "stroke" }}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(row);
                  lastAction.current = { owner: row.owner, source: row.source };
                }}
              />
              {row.link.text && (
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - 8 * scale}
                  fontSize={12 * scale}
                  fill="var(--foreground)"
                  textAnchor="middle"
                >
                  {row.link.text}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {selected && (
        <div
          data-cross-window-editor=""
          className="bg-popover fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded border p-2"
        >
          <input
            key={selected.owner + selected.link.id}
            aria-label="跨窗口连线文字"
            defaultValue={selected.link.text ?? ""}
            onChange={(e) => void change(selected, "edit", { text: e.target.value })}
          />
          <input
            type="color"
            aria-label="跨窗口连线颜色"
            value={selected.link.color ?? "#16a085"}
            onChange={(e) => void change(selected, "edit", { color: e.target.value })}
          />
          <Button
            onClick={() =>
              void change(selected, "edit", {
                direction: selected.link.direction === "reverse" ? "forward" : "reverse",
              })
            }
          >
            反向
          </Button>
          <Button onClick={() => void change(selected, "edit", { direction: "undirected" })}>无向</Button>
          <select
            aria-label="跨窗口连线线型"
            value={selected.link.lineType ?? "solid"}
            onChange={(e) =>
              void change(selected, "edit", { lineType: e.target.value as CrossFileEdgeStyle["lineType"] })
            }
          >
            <option value="solid">实线</option>
            <option value="dashed">虚线</option>
            <option value="double">双线</option>
          </select>
          <select
            aria-label="跨窗口连线箭头"
            value={selected.link.arrow ?? "default"}
            onChange={(e) => void change(selected, "edit", { arrow: e.target.value as CrossFileEdgeStyle["arrow"] })}
          >
            <option value="default">默认箭头</option>
            <option value="filled-triangle">实心三角</option>
            <option value="hollow-triangle">空心三角</option>
            <option value="filled-diamond">实心菱形</option>
            <option value="hollow-diamond">空心菱形</option>
          </select>
          <Button onClick={() => void change(selected, "remove")}>删除</Button>
          <Button onClick={() => setSelected(undefined)}>关闭</Button>
        </div>
      )}
    </>,
    document.body,
  );
}
