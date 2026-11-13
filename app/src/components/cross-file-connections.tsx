import { isSelectionMode } from "@/core/service/controlService/selectionMode";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "jotai";
import { store, activeResourceTabAtom, tabGroupRootAtom, tabsAtom } from "@/state";
import { findTabGroupByTabId } from "@/core/TabGroup";
import { URI } from "vscode-uri";
import {
  invalidateCrossFileHighlight,
  setHighlightProjects,
  remoteIncomingFiles,
} from "@/core/service/dataManageService/crossFileHighlight";
import { Project, ProjectState } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { TabWorkspace } from "@/core/TabWorkspace";
import { ConnectableEntity, type CrossFileNodeLink } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import {
  addCrossFileConnection,
  editCrossFileConnection,
  fileKey,
  endpointNode,
  removeCrossFileConnection,
  type NodeEndpoint,
} from "@/core/service/dataManageService/CrossFileConnections";
import { Button } from "./ui/button";
import CrossWindowConnections from "./cross-window-connections";
import { toast } from "sonner";
import { PanelsTopLeft, Search, X } from "lucide-react";

type Point = { x: number; y: number };
type Row = {
  source: NodeEndpoint;
  link: CrossFileNodeLink;
  target?: NodeEndpoint;
  a?: Point;
  b?: Point;
  label: string;
};

export function endpointOnScreen(endpoint: NodeEndpoint, node = endpointNode(endpoint)): Point | undefined {
  const canvas = endpoint.project.canvas?.element;
  if (!node || node.isHiddenBySectionCollapse || !canvas?.isConnected) return;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const p = endpoint.project.canvas.viewToClient(endpoint.project.renderer.transformWorld2View(node.geometryCenter));
  if (p.x < bounds.left || p.x > bounds.right || p.y < bounds.top || p.y > bounds.bottom) return;
  // A floating tab or dialog may cover the underlying canvas.
  const hit = document.elementFromPoint(p.x, p.y);
  if (
    hit !== canvas &&
    !(
      hit?.closest("svg [data-cross-edge]") &&
      document.elementsFromPoint(p.x, p.y).find((el) => !el.closest("svg [data-cross-edge]")) === canvas
    )
  )
    return;
  return p;
}

export function endpointAtPoint(projects: readonly Project[], x: number, y: number): NodeEndpoint | undefined {
  const element = document.elementFromPoint(x, y);
  const project = projects.find((p) => !p.closing && p.canvas?.element === element);
  if (!project) return;
  const node = project.stageManager.findConnectableEntityByLocation(
    project.renderer.transformView2World(project.canvas.clientToView(x, y)),
  );
  return node ? { project, nodeId: node.uuid } : undefined;
}

function SearchButton() {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label="查询"
      title="查询节点和框"
      onClick={() =>
        void import("@/sub/FindWindow")
          .then(({ default: FindWindow }) => FindWindow.open())
          .catch((error) => toast.error(String(error)))
      }
    >
      <Search />
    </Button>
  );
}

function SearchOnlyToolbar() {
  const active = useAtomValue(activeResourceTabAtom);
  const [mode, setMode] = useState(Settings.mouseLeftMode);
  useEffect(() => Settings.watch("mouseLeftMode", setMode), []);
  return isSelectionMode(mode) && active instanceof Project
    ? createPortal(
        <div className="bg-popover fixed bottom-0 left-1/2 z-50 -translate-x-1/2 rounded-t border">
          <SearchButton />
        </div>,
        document.body,
      )
    : null;
}

export default function CrossFileConnections() {
  const [enabled, setEnabled] = useState(Settings.enableCrossFileConnections);
  useEffect(() => Settings.watch("enableCrossFileConnections", setEnabled), []);
  return enabled ? (
    <>
      <Connections />
      <CrossWindowConnections />
    </>
  ) : (
    <SearchOnlyToolbar />
  );
}

function Connections() {
  const tabs = useAtomValue(tabsAtom);
  const projects = tabs.filter((tab): tab is Project => tab instanceof Project && !tab.closing);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const active = useAtomValue(activeResourceTabAtom);
  const [showList, setShowList] = useState(false);
  const [lineStyle, setLineStyle] = useState(Settings.lineStyle);
  const [bidirectional, setBidirectional] = useState(Settings.showBidirectionalArrows);
  useEffect(() => Settings.watch("showBidirectionalArrows", setBidirectional), []);
  useEffect(() => Settings.watch("lineStyle", setLineStyle), []);
  const [mode, setMode] = useState(Settings.mouseLeftMode);
  const [viewer, setViewer] = useState(Settings.viewerMode);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row>();
  const [incoming, setIncoming] = useState<Record<string, string[]>>({});
  const [, refreshRemoteFiles] = useState(0);
  useEffect(() => {
    const changed = () => refreshRemoteFiles((n) => n + 1);
    window.addEventListener("pg-cross-window-graphs", changed);
    return () => window.removeEventListener("pg-cross-window-graphs", changed);
  }, []);
  useEffect(() => Settings.watch("viewerMode", setViewer), []);
  useEffect(() => Settings.watch("mouseLeftMode", setMode), []);
  useEffect(() => {
    setShowList(false);
  }, [active, mode]);
  useEffect(() => {
    const open = projectsRef.current;
    setHighlightProjects(open);
    let dirty = true;
    const invalidate = () => {
      dirty = true;
      invalidateCrossFileHighlight();
    };
    const stamps = new Map<Project, unknown>();
    let links: {
      source: NodeEndpoint;
      node: ConnectableEntity;
      link: CrossFileNodeLink;
      destination?: ConnectableEntity;
      target?: NodeEndpoint;
    }[] = [];
    let saved: Record<string, string[]> = {};
    try {
      saved = JSON.parse(localStorage.getItem("pg-cross-file-index") ?? "{}") ?? {};
    } catch (error) {
      toast.error("关联文件列表缓存无法读取：" + String(error));
    }
    for (const p of open) {
      p.on("stage-commit", invalidate);
      p.on("state-change", invalidate);
    }
    const refresh = () => {
      for (const p of open) {
        const stamp = p.stageManager.topLevelEntities ?? p.stage;
        if (stamps.get(p) !== stamp) {
          stamps.set(p, stamp);
          dirty = true;
        }
      }
      if (dirty) {
        dirty = false;
        invalidateCrossFileHighlight();
        const byFile = new Map(open.map((p) => [fileKey(p.uri.toString()), p]));
        const nodes = new Map(
          open.map((p) => [
            p,
            new Map(
              p.stage.filter((n): n is ConnectableEntity => n instanceof ConnectableEntity).map((n) => [n.uuid, n]),
            ),
          ]),
        );
        links = [];
        let indexChanged = false;
        for (const p of open) {
          const targets = new Set<string>();
          for (const node of nodes.get(p)!.values())
            for (const link of node.crossFileLinks ?? []) {
              const dest = byFile.get(fileKey(link.targetFile));
              const destination = dest && nodes.get(dest)?.get(link.targetNode);
              targets.add(link.targetFile);
              links.push({
                source: { project: p, nodeId: node.uuid },
                node,
                link,
                destination,
                target: dest && destination ? { project: dest, nodeId: destination.uuid } : undefined,
              });
            }
          const uri = p.uri.toString(),
            next = [...targets];
          if (
            p.projectState === ProjectState.Saved &&
            fileKey(uri) &&
            JSON.stringify(saved[uri] ?? []) !== JSON.stringify(next)
          ) {
            saved[uri] = next;
            indexChanged = true;
          }
        }
        if (indexChanged)
          try {
            localStorage.setItem("pg-cross-file-index", JSON.stringify(saved));
          } catch (error) {
            toast.error("关联文件列表缓存无法保存：" + String(error));
          }
        setIncoming({ ...saved });
      }
      const result = links.map(({ source, node, link, target, destination }) => {
        let a = endpointOnScreen(source, node);
        let b = target && endpointOnScreen(target, destination);
        if (a && b && target && destination) {
          const from = a,
            to = b;
          const boundary = (p: Project, n: ConnectableEntity, center: Point, towards: Point) => {
            const corner = p.canvas.viewToClient(
              p.renderer.transformWorld2View(n.collisionBox.getRectangle().location),
            );
            const dx = towards.x - center.x,
              dy = towards.y - center.y;
            const ratio = Math.min(
              dx ? Math.abs((center.x - corner.x) / dx) : Infinity,
              dy ? Math.abs((center.y - corner.y) / dy) : Infinity,
              0.49,
            );
            return { x: center.x + dx * ratio, y: center.y + dy * ratio };
          };
          a = boundary(source.project, node, from, to);
          b = boundary(target.project, destination, to, from);
        }
        return { source, node, link, target, a, b, label: link.text ?? "" };
      });
      setRows((old) =>
        old.length === result.length &&
        old.every(
          (r, i) =>
            r.link === result[i].link &&
            r.source.project === result[i].source.project &&
            r.target?.project === result[i].target?.project &&
            r.a?.x === result[i].a?.x &&
            r.a?.y === result[i].a?.y &&
            r.b?.x === result[i].b?.x &&
            r.b?.y === result[i].b?.y,
        )
          ? old
          : result,
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 100);
    return () => {
      clearInterval(timer);
      for (const p of open) {
        p.off("stage-commit", invalidate);
        p.off("state-change", invalidate);
      }
      setHighlightProjects([]);
    };
  }, [tabs]);
  useEffect(() => {
    let gesture:
      | { source: NodeEndpoint; target: NodeEndpoint; x: number; y: number; moved: boolean; pointer: number }
      | undefined;
    let suppressMenuUntil = 0;
    const down = (event: PointerEvent) => {
      gesture = undefined;
      if (
        event.button !== 2 ||
        Settings.viewerMode ||
        !Settings.enableRightClickConnect ||
        !isSelectionMode(Settings.mouseLeftMode)
      )
        return;
      const source = store.get(activeResourceTabAtom);
      if (
        !(source instanceof Project) ||
        source.canvas?.element === event.target ||
        !(event.target instanceof HTMLCanvasElement)
      )
        return;
      const selected = source.stageManager.getSelectedEntities().filter((n) => n instanceof ConnectableEntity);
      if (selected.length !== 1) return;
      const target = endpointAtPoint(projectsRef.current, event.clientX, event.clientY);
      if (!target || source === target.project) return;
      gesture = {
        source: { project: source, nodeId: selected[0].uuid },
        target,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        pointer: event.pointerId,
      };
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const move = (event: PointerEvent) => {
      if (
        gesture &&
        event.pointerId === gesture.pointer &&
        Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5
      )
        gesture.moved = true;
    };
    const up = (event: PointerEvent) => {
      if (event.button !== 2 || !gesture || gesture.pointer !== event.pointerId) return;
      const g = gesture;
      gesture = undefined;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressMenuUntil = performance.now() + 350;
      if (g.moved || Math.hypot(event.clientX - g.x, event.clientY - g.y) > 5) return;
      const hit = endpointAtPoint(projectsRef.current, event.clientX, event.clientY);
      if (hit?.project !== g.target.project || hit.nodeId !== g.target.nodeId) return;
      try {
        addCrossFileConnection(g.source, hit);
      } catch (e) {
        toast.error(String(e));
      }
    };
    const menu = (e: MouseEvent) => {
      if ((gesture || performance.now() < suppressMenuUntil) && e.target instanceof HTMLCanvasElement) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const cancel = () => {
      gesture = undefined;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("contextmenu", menu, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("contextmenu", menu, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const edge = rows.find((r) => selected?.source.project === r.source.project && selected.link.id === r.link.id);
  function edit(patch: Parameters<typeof editCrossFileConnection>[2]) {
    if (edge)
      try {
        editCrossFileConnection(edge.source, edge.link.id, patch);
      } catch (e) {
        toast.error(String(e));
      }
  }
  function remove() {
    if (edge)
      try {
        removeCrossFileConnection(edge.source, edge.link.id);
        setSelected(undefined);
      } catch (e) {
        toast.error(String(e));
      }
  }
  useEffect(() => {
    if (!edge) return;
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element && !e.target.closest("[data-cross-edge]")) setSelected(undefined);
    };
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.matches("input,select,textarea") || e.target.isContentEditable))
        return;
      if (e.key === "Escape") setSelected(undefined);
      if (!viewer && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        remove();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [edge, viewer]);
  const related = new Map<string, string>();
  if (showList && active instanceof Project) {
    const current = fileKey(active.uri.toString());
    const add = (uri: string) => {
      const key = fileKey(uri);
      if (key && key !== current) related.set(key, uri);
    };
    for (const row of rows) {
      if (row.source.project === active) add(row.link.targetFile);
      if (fileKey(row.link.targetFile) === current) add(row.source.project.uri.toString());
    }
    remoteIncomingFiles(current).forEach(add);
    for (const [uri, targets] of Object.entries(incoming))
      if (
        !projectsRef.current.some((p) => fileKey(p.uri.toString()) === fileKey(uri)) &&
        Array.isArray(targets) &&
        targets.some((target) => fileKey(target) === current)
      )
        add(uri);
  }
  const splitRight = async (uri: string) => {
    if (!(active instanceof Project)) return;
    try {
      if (active.layout !== "docked") TabWorkspace.dock(active.id);
      const group = findTabGroupByTabId(store.get(tabGroupRootAtom), active.id);
      if (!group) return;
      const existing = projectsRef.current.find((p) => fileKey(p.uri.toString()) === fileKey(uri));
      const other =
        existing ?? (await (await import("@/core/service/GlobalMenu")).onOpenFile(URI.parse(uri), "跨文件连线"));
      if (!other || other === active || active.closing) return;
      TabWorkspace.focus(active.id);
      if (!TabWorkspace.moveTab(other.id, { groupId: group.id, edge: "right" }))
        throw new Error("无法在当前文件右侧拆分");
      setShowList(false);
    } catch (error) {
      toast.error(String(error));
    }
  };
  return createPortal(
    <>
      <svg aria-label="跨文件连接线" className="pointer-events-none fixed inset-0 z-[45] size-full">
        {rows.map((row) => {
          const { source, link, a, b } = row;
          if (!a || !b) return null;
          const start = link.direction === "reverse" ? b : a,
            end = link.direction === "reverse" ? a : b;
          const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
          const off = link.curve ? Math.min(48, Math.hypot(end.x - start.x, end.y - start.y) / 8) : 0;
          const path =
            lineStyle === "vertical"
              ? ["M", start.x, start.y, "L", mid.x, start.y, "L", mid.x, end.y, "L", end.x, end.y].join(" ")
              : ["M", start.x, start.y, ...(off ? ["Q", mid.x, mid.y - off] : ["L"]), end.x, end.y].join(" ");
          const color = link.color ?? "currentColor";
          const marker = "cross-arrow-" + (source.project.id + link.id).replace(/[^a-zA-Z0-9_-]/g, "_");
          return (
            <g key={marker} data-cross-edge="">
              <defs>
                <marker
                  id={marker}
                  markerUnits="userSpaceOnUse"
                  markerWidth="13"
                  markerHeight="12"
                  refX="12"
                  refY="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d={
                      !bidirectional && link.arrow?.includes("diamond")
                        ? "M1 6 L6 1 L12 6 L6 11 Z"
                        : "M1 1 L12 6 L1 11 Z"
                    }
                    stroke={color}
                    fill={!bidirectional && link.arrow?.startsWith("hollow") ? "var(--background)" : color}
                  />
                </marker>
              </defs>
              {edge === row && <path d={path} fill="none" stroke="var(--primary)" strokeWidth="7" opacity=".6" />}
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={link.lineType === "double" ? 4 : 2}
                strokeDasharray={link.lineType === "dashed" ? "6 4" : undefined}
                markerStart={bidirectional ? "url(#" + marker + ")" : undefined}
                markerEnd={!bidirectional && link.direction === "undirected" ? undefined : "url(#" + marker + ")"}
              />
              {link.lineType === "double" && <path d={path} fill="none" stroke="var(--background)" strokeWidth="1.5" />}
              {link.text && (
                <text x={mid.x} y={mid.y - off / 2 - 5} fill={color} textAnchor="middle">
                  {link.text}
                </text>
              )}
              <path
                d={path}
                stroke="transparent"
                strokeWidth="8"
                fill="none"
                style={{ pointerEvents: "stroke" }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  TabWorkspace.focus(source.project.id);
                  setSelected(row);
                }}
              />
            </g>
          );
        })}
      </svg>
      {edge && !viewer && (
        <div
          key={edge.link.id}
          data-cross-edge=""
          className="bg-popover fixed top-12 right-3 z-50 flex flex-wrap items-center gap-2 rounded border p-2"
        >
          <input
            aria-label="连线文字"
            placeholder="连线文字"
            key={edge.link.id + edge.link.text}
            defaultValue={edge.link.text}
            onBlur={(e) => edit({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <select
            aria-label="连线方向"
            value={edge.link.direction ?? "forward"}
            onChange={(e) => edit({ direction: e.target.value as CrossFileNodeLink["direction"] })}
          >
            <option value="forward">正向</option>
            <option value="reverse">反向</option>
            <option value="undirected">无向</option>
          </select>
          <input
            aria-label="线条颜色"
            type="color"
            value={edge.link.color ?? "#808080"}
            onChange={(e) => edit({ color: e.target.value })}
          />
          <select
            aria-label="线型"
            value={edge.link.lineType ?? "solid"}
            onChange={(e) => edit({ lineType: e.target.value as CrossFileNodeLink["lineType"] })}
          >
            <option value="solid">实线</option>
            <option value="dashed">虚线</option>
            <option value="double">双线</option>
          </select>
          <select
            aria-label="箭头"
            value={edge.link.arrow ?? "default"}
            onChange={(e) => edit({ arrow: e.target.value as CrossFileNodeLink["arrow"] })}
          >
            {Object.entries({
              default: "默认箭头",
              "filled-triangle": "实心三角",
              "hollow-triangle": "空心三角",
              "filled-diamond": "实心菱形",
              "hollow-diamond": "空心菱形",
            }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={!!edge.link.curve} onChange={(e) => edit({ curve: e.target.checked })} />
            弧线
          </label>
          <Button size="icon" aria-label="删除连线" onClick={remove}>
            <X />
          </Button>
        </div>
      )}
      {isSelectionMode(mode) && active instanceof Project && (
        <div
          data-cross-file-controls=""
          className="bg-popover fixed bottom-0 left-1/2 z-50 -translate-x-1/2 rounded-t border"
        >
          <SearchButton />
          {showList && (
            <div className="max-h-56 max-w-lg overflow-auto p-2">
              {related.size === 0 && <p>此文件暂无已知的跨文件连线。</p>}
              {[...related.values()].map((uri) => (
                <Button
                  className="block"
                  key={uri}
                  variant="ghost"
                  title={URI.parse(uri).fsPath}
                  onClick={() => void splitRight(uri)}
                >
                  {URI.parse(uri).fsPath} → 向右拆分
                </Button>
              ))}
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label="查看关联文件"
            title="查看关联文件并向右拆分"
            aria-expanded={showList}
            onClick={() => setShowList(!showList)}
          >
            <PanelsTopLeft />
          </Button>
        </div>
      )}
    </>,
    document.body,
  );
}
