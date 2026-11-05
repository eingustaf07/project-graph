import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "jotai";
import { tabsAtom } from "@/state";
import { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { TabWorkspace } from "@/core/TabWorkspace";
import { ConnectableEntity, type CrossFileNodeLink } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import {
  addCrossFileConnection,
  endpointNode,
  removeCrossFileConnection,
  resolveCrossFileTarget,
  type NodeEndpoint,
} from "@/core/service/dataManageService/CrossFileConnections";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { Link2, List, X } from "lucide-react";

type Point = { x: number; y: number };
type Row = {
  source: NodeEndpoint;
  link: CrossFileNodeLink;
  target?: NodeEndpoint;
  a?: Point;
  b?: Point;
  label: string;
};

export function endpointOnScreen(endpoint: NodeEndpoint): Point | undefined {
  const node = endpointNode(endpoint);
  const canvas = endpoint.project.canvas?.element;
  if (!node || node.isHiddenBySectionCollapse || !canvas?.isConnected) return;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const p = endpoint.project.canvas.viewToClient(endpoint.project.renderer.transformWorld2View(node.geometryCenter));
  if (p.x < bounds.left || p.x > bounds.right || p.y < bounds.top || p.y > bounds.bottom) return;
  // A floating tab or dialog may cover the underlying canvas.
  const hit = document.elementFromPoint(p.x, p.y);
  if (hit !== canvas) return;
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

export default function CrossFileConnections() {
  const [enabled, setEnabled] = useState(Settings.enableCrossFileConnections);
  useEffect(() => Settings.watch("enableCrossFileConnections", setEnabled), []);
  return enabled ? <Connections /> : null;
}

function Connections() {
  const tabs = useAtomValue(tabsAtom);
  const projects = tabs.filter((tab): tab is Project => tab instanceof Project && !tab.closing);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const [connecting, setConnecting] = useState(false);
  const [showList, setShowList] = useState(false);
  const [viewer, setViewer] = useState(Settings.viewerMode);
  const [rows, setRows] = useState<Row[]>([]);
  const [preview, setPreview] = useState<{ a: Point; b: Point }>();
  useEffect(() => Settings.watch("viewerMode", setViewer), []);
  useEffect(() => {
    if (viewer) setConnecting(false);
  }, [viewer]);
  useEffect(() => {
    const refresh = () => {
      const current = projectsRef.current;
      const result: Row[] = [];
      for (const project of current)
        for (const node of project.stage) {
          if (!(node instanceof ConnectableEntity)) continue;
          for (const link of node.crossFileLinks ?? []) {
            const source = { project, nodeId: node.uuid };
            const target = resolveCrossFileTarget(link, current);
            result.push({
              source,
              target,
              link,
              a: endpointOnScreen(source),
              b: target && endpointOnScreen(target),
              label: `${project.title} → ${link.targetFile.split("/").pop()} (${target ? "已连接" : "目标未打开、已移动或节点已删除"})`,
            });
          }
        }
      setRows(result);
    };
    refresh();
    const timer = window.setInterval(refresh, 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!connecting) return;
    let source: NodeEndpoint | undefined;
    const cancel = () => {
      source = undefined;
      setPreview(undefined);
      setConnecting(false);
    };
    const commit = (target: NodeEndpoint) => {
      if (!source) return;
      try {
        addCrossFileConnection(source, target);
        TabWorkspace.focus(source.project.id);
        toast.success("已建立跨文件连接，请保存起点文件；可在起点文件撤销");
        cancel();
      } catch (error) {
        toast.error(String(error));
      }
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element)?.closest?.("[data-cross-file-controls]")) return;
      const hit = endpointAtPoint(projectsRef.current, event.clientX, event.clientY);
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (source) {
        commit(hit);
        return;
      }
      source = hit;
      const a = endpointOnScreen(hit);
      if (a) setPreview({ a, b: a });
    };
    const move = (event: PointerEvent) => {
      if (!source) return;
      if (!projectsRef.current.includes(source.project)) {
        cancel();
        return;
      }
      const a = endpointOnScreen(source);
      if (a) setPreview({ a, b: { x: event.clientX, y: event.clientY } });
    };
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || !source) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const hit = endpointAtPoint(projectsRef.current, event.clientX, event.clientY);
      if (hit && (hit.project !== source.project || hit.nodeId !== source.nodeId)) commit(hit);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    const stopClick = (event: MouseEvent) => {
      if ((event.target as Element)?.tagName === "CANVAS") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("click", stopClick, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("click", stopClick, true);
      window.removeEventListener("blur", cancel);
      setPreview(undefined);
    };
  }, [connecting]);

  const focus = (endpoint: NodeEndpoint) => {
    const node = endpointNode(endpoint);
    if (!node) {
      toast.error("节点已不存在");
      return;
    }
    TabWorkspace.focus(endpoint.project.id);
    endpoint.project.stageManager.clearSelectAll();
    node.isSelected = true;
    endpoint.project.camera.location = node.geometryCenter.clone();
    endpoint.project.controller.resetCountdownTimer();
    endpoint.project.loop();
  };
  return createPortal(
    <>
      <svg aria-label="跨文件连接线" className="pointer-events-none fixed inset-0 z-[45] size-full">
        <defs>
          <marker id="pg-cross-file-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#16a085" />
          </marker>
        </defs>
        {rows.map(
          ({ source, link, a, b }) =>
            a &&
            b && (
              <line
                key={`${source.project.id}:${source.nodeId}:${link.id}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#16a085"
                strokeWidth="2"
                strokeDasharray="6 4"
                markerEnd="url(#pg-cross-file-arrow)"
              />
            ),
        )}
        {preview && (
          <line
            x1={preview.a.x}
            y1={preview.a.y}
            x2={preview.b.x}
            y2={preview.b.y}
            stroke="#16a085"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        )}
      </svg>
      <div
        data-cross-file-controls
        className="bg-popover fixed top-16 right-3 z-50 max-w-sm rounded-lg border p-2 shadow-lg"
      >
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={connecting ? "default" : "outline"}
            disabled={viewer}
            onClick={() => setConnecting(!connecting)}
          >
            <Link2 className="size-4" />
            {connecting ? "取消连线" : "跨文件连线"}
          </Button>
          <Button size="icon" variant="ghost" aria-label="跨文件连接列表" onClick={() => setShowList(!showList)}>
            <List className="size-4" />
          </Button>
        </div>
        {connecting && <p className="mt-2 text-xs">从起点拖到另一文件的节点，或依次点击两个节点。Esc 取消。</p>}
        {showList && (
          <div className="mt-2 max-h-64 overflow-y-auto text-xs">
            {rows.length === 0 && <p>尚无跨文件连接。请先保存两份文件，再分栏或浮动显示。</p>}
            {rows.map((row) => (
              <div key={`${row.source.project.id}:${row.source.nodeId}:${row.link.id}`} className="my-2 border-t pt-2">
                <p className="break-all">{row.label}</p>
                <Button size="sm" variant="ghost" onClick={() => focus(row.source)}>
                  起点
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!row.target}
                  onClick={() => row.target && focus(row.target)}
                >
                  终点
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={viewer}
                  aria-label="删除跨文件连接"
                  onClick={() => {
                    try {
                      removeCrossFileConnection(row.source, row.link.id);
                      TabWorkspace.focus(row.source.project.id);
                    } catch (error) {
                      toast.error(String(error));
                    }
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
