import type { Project } from "@/core/Project";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { Settings } from "@/core/service/Settings";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { useEffect, useRef, useState, lazy, Suspense, type PointerEvent } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Circle, MousePointer2, RectangleHorizontal, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { DoodleShape } from "@/core/algorithm/doodleBounds";

const LegacyToolbar = lazy(() => import("./right-toolbar"));
type Gesture = { start: Vector; end: Vector; pointerId: number };
type Resize = { original: Rectangle; anchor: Vector; end: Vector; pointerId: number; entity: Doodle };

function frameFromPoints(start: Vector, end: Vector, shape: DoodleShape): Rectangle {
  let width = Math.abs(end.x - start.x),
    height = Math.abs(end.y - start.y);
  if (shape === "circle") width = height = Math.max(width, height);
  return new Rectangle(
    new Vector(end.x < start.x ? start.x - width : start.x, end.y < start.y ? start.y - height : start.y),
    new Vector(width, height),
  );
}

export default function DoodleToolbar({ project }: { project: Project }) {
  const [tool, setTool] = useState<DoodleShape | null>(null);
  const [bounded, setBounded] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#16a085");
  const [selected, setSelected] = useState<Doodle>();
  const [editingId, setEditingId] = useState<string>();
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [viewer, setViewer] = useState(Settings.viewerMode);
  const [gesture, setGesture] = useState<Gesture>();
  const [resize, setResize] = useState<Resize>();
  const [, redraw] = useState(0);
  const layer = useRef<HTMLDivElement>(null);

  const refresh = () => {
    project.controller.resetCountdownTimer();
    project.loop();
    redraw((value) => value + 1);
  };
  const world = (event: { clientX: number; clientY: number }) => {
    const point = project.canvas.clientToView(event.clientX, event.clientY);
    MouseLocation.x = point.x;
    MouseLocation.y = point.y;
    return project.renderer.transformView2World(point);
  };
  useEffect(() => Settings.watch("viewerMode", setViewer), []);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      setSelected(
        project.stageManager.getSelectedEntities().find((entity): entity is Doodle => entity instanceof Doodle),
      );
      redraw((value) => value + 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const clickFrame = (event: globalThis.PointerEvent) => {
      const point = project.canvas.clientToView(event.clientX, event.clientY);
      const entity = project.stageManager.findEntityByLocation(project.renderer.transformView2World(point));
      if (entity instanceof Doodle) setEditingId(entity.uuid);
      schedule();
    };
    project.on("state-change", schedule);
    project.canvas.element.addEventListener("pointerup", clickFrame);
    window.addEventListener("pointerup", schedule);
    window.addEventListener("keyup", schedule);
    window.addEventListener("wheel", schedule);
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      project.off("state-change", schedule);
      project.canvas.element.removeEventListener("pointerup", clickFrame);
      window.removeEventListener("pointerup", schedule);
      window.removeEventListener("keyup", schedule);
      window.removeEventListener("wheel", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [project]);
  useEffect(() => {
    if (!selected) {
      setEditingId(undefined);
      return;
    }
    setBounded(selected.bounded);
    setName(selected.text);
    setColor(selected.color.toHexStringWithoutAlpha());
    setWidth(String(Math.round(selected.frame.width)));
    setHeight(String(Math.round(selected.frame.height)));
  }, [selected]);
  useEffect(() => {
    if (!tool && !resize) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setTool(null);
      setGesture(undefined);
      setResize(undefined);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [tool, resize]);
  useEffect(() => {
    if (viewer) {
      setTool(null);
      setGesture(undefined);
      setResize(undefined);
    }
  }, [viewer]);

  const editing = !!selected && editingId === selected.uuid && !tool && !viewer;
  const shape = tool ?? selected?.shape ?? "rectangle";
  const preview = gesture
    ? frameFromPoints(gesture.start, gesture.end, shape)
    : resize
      ? frameFromPoints(resize.anchor, resize.end, resize.entity.shape)
      : undefined;
  const showFrame = preview ?? selected?.frame;
  const viewFrame = showFrame
    ? new Rectangle(
        project.renderer.transformWorld2View(showFrame.location),
        showFrame.size.multiply(project.camera.currentScale),
      )
    : undefined;

  const drawComplete = (event: PointerEvent<HTMLDivElement>) => {
    if (!gesture || !tool || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = frameFromPoints(gesture.start, world(event), tool);
    setGesture(undefined);
    if (frame.width < 40 || frame.height < 40) {
      toast.info("请画大一些，图形宽高至少为40个画布单位");
      return;
    }
    try {
      const doodle = new Doodle(project, {
        frame,
        shape: tool,
        bounded,
        text: name || (bounded ? "容器" : ""),
        color: Color.fromHex(color),
      });
      doodle.captureEnclosed();
      project.stageManager.add(doodle);
      project.stageManager.clearSelectAll();
      doodle.isSelected = true;
      project.historyManager.recordStep();
      setSelected(doodle);
      setEditingId(doodle.uuid);
      setTool(null);
      refresh();
    } catch (error) {
      toast.error(`无法创建图形：${String(error)}`);
    }
  };
  const finishResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (!resize || event.pointerId !== resize.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const frame = frameFromPoints(resize.anchor, world(event), resize.entity.shape);
      resize.entity.resizeFrame(frame);
      project.stageManager.updateReferences();
      project.historyManager.recordStep();
      setWidth(String(Math.round(resize.entity.frame.width)));
      setHeight(String(Math.round(resize.entity.frame.height)));
      refresh();
    } catch (error) {
      toast.error(String(error));
    }
    setResize(undefined);
  };
  const fixBoundary = () => {
    if (!selected || viewer) return;
    try {
      selected.resizeFrame(new Rectangle(selected.frame.location.clone(), new Vector(Number(width), Number(height))));
      selected.rename(name);
      selected.color = Color.fromHex(color);
      selected.setBounded(bounded);
      project.stageManager.updateReferences();
      project.historyManager.recordStep();
      setEditingId(undefined);
      refresh();
      toast.success(bounded ? "容器边界已固定，内部节点不能越界" : "涂鸦已保存，不限制节点");
    } catch (error) {
      toast.error(String(error));
    }
  };
  const startTool = (next: DoodleShape) => {
    project.stageManager.clearSelectAll();
    setSelected(undefined);
    setEditingId(undefined);
    setName(bounded ? "容器" : "");
    setTool(next);
    setLegacy(false);
    refresh();
  };

  return (
    <>
      {tool && !viewer && (
        <div
          ref={layer}
          data-pg-doodle-layer
          className="absolute inset-0 z-30 cursor-crosshair touch-none"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = world(event);
            setGesture({ start: point, end: point, pointerId: event.pointerId });
          }}
          onPointerMove={(event) => {
            if (gesture) setGesture({ ...gesture, end: world(event) });
          }}
          onPointerUp={drawComplete}
          onPointerCancel={() => setGesture(undefined)}
        />
      )}
      {preview && viewFrame && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-40 size-full"
          style={{ overflow: "visible" }}
        >
          {shape === "circle" ? (
            <circle
              cx={viewFrame.center.x}
              cy={viewFrame.center.y}
              r={viewFrame.width / 2}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          ) : (
            <rect
              x={viewFrame.left}
              y={viewFrame.top}
              width={viewFrame.width}
              height={viewFrame.height}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
        </svg>
      )}
      {editing &&
        viewFrame &&
        [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([dx, dy]) => {
          const rect = selected.frame;
          const anchor = new Vector(dx < 0 ? rect.right : rect.left, dy < 0 ? rect.bottom : rect.top);
          return (
            <button
              key={`${dx},${dy}`}
              aria-label={`调整${dy < 0 ? "上" : "下"}${dx < 0 ? "左" : "右"}角`}
              type="button"
              className="bg-background border-primary absolute z-40 size-3 rounded-sm border-2"
              style={{
                left: (dx < 0 ? viewFrame.left : viewFrame.right) - 6,
                top: (dy < 0 ? viewFrame.top : viewFrame.bottom) - 6,
                cursor: dx === dy ? "nwse-resize" : "nesw-resize",
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setResize({
                  original: rect.clone(),
                  anchor,
                  end: world(event),
                  pointerId: event.pointerId,
                  entity: selected,
                });
              }}
              onPointerMove={(event) => {
                if (resize && event.pointerId === resize.pointerId) setResize({ ...resize, end: world(event) });
              }}
              onPointerUp={finishResize}
              onPointerCancel={() => setResize(undefined)}
            />
          );
        })}
      {legacy ? (
        <>
          <Suspense fallback={<div className="absolute top-1/2 right-2">加载快捷设置…</div>}>
            <LegacyToolbar />
          </Suspense>
          <Button className="absolute right-2 bottom-6 z-50" variant="outline" onClick={() => setLegacy(false)}>
            返回涂鸦面板
          </Button>
        </>
      ) : (
        <aside
          aria-label="涂鸦面板"
          className="bg-popover/95 border-border absolute top-1/2 right-2 z-50 flex max-h-[85%] w-52 -translate-y-1/2 flex-col gap-2 overflow-auto rounded-lg border p-3 text-sm shadow-xl backdrop-blur-md"
        >
          <strong>涂鸦与容器</strong>
          <div className="grid grid-cols-2 gap-1">
            <Button
              size="sm"
              variant={bounded ? "outline" : "default"}
              aria-pressed={!bounded}
              onClick={() => setBounded(false)}
              disabled={viewer}
            >
              涂鸦模式
            </Button>
            <Button
              size="sm"
              variant={bounded ? "default" : "outline"}
              aria-pressed={bounded}
              onClick={() => setBounded(true)}
              disabled={viewer}
            >
              容器模式
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {bounded ? "圈住节点并固定边界，可编辑名称" : "只作图形标注，不限制节点"}
          </p>
          <div className="grid grid-cols-2 gap-1">
            <Button
              size="sm"
              variant={tool === "rectangle" ? "default" : "outline"}
              onClick={() => startTool("rectangle")}
              disabled={viewer}
            >
              <RectangleHorizontal className="size-4" />
              长方形
            </Button>
            <Button
              size="sm"
              variant={tool === "circle" ? "default" : "outline"}
              onClick={() => startTool("circle")}
              disabled={viewer}
            >
              <Circle className="size-4" />
              圆形
            </Button>
          </div>
          {tool && (
            <>
              <p className="text-xs">在画布拖动绘制，Esc 取消</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTool(null);
                  setGesture(undefined);
                }}
              >
                <MousePointer2 className="size-4" />
                返回选择
              </Button>
            </>
          )}
          <label className="flex items-center gap-2 text-xs">
            线条颜色
            <input
              aria-label="涂鸦线条颜色"
              type="color"
              value={color}
              disabled={viewer || (!!selected && !editing)}
              onChange={(event) => setColor(event.target.value)}
              className="h-6 w-10"
            />
          </label>
          {(bounded || selected) && (
            <Input
              aria-label="图形或容器名称"
              placeholder="容器名称"
              value={name}
              disabled={viewer || (!!selected && !editing)}
              onChange={(event) => setName(event.target.value)}
            />
          )}
          {selected && (
            <>
              <span className="text-xs">
                {editing ? "边界编辑中：可拖动四角调整大小" : "已固定；点击图形边框重新编辑"}
              </span>
              {editing ? (
                <>
                  <label className="text-xs">
                    宽度
                    <Input
                      aria-label="图形宽度"
                      type="number"
                      min={40}
                      value={width}
                      onChange={(event) => {
                        setWidth(event.target.value);
                        if (selected.shape === "circle") setHeight(event.target.value);
                      }}
                    />
                  </label>
                  <label className="text-xs">
                    高度
                    <Input
                      aria-label="图形高度"
                      type="number"
                      min={40}
                      value={height}
                      onChange={(event) => {
                        setHeight(event.target.value);
                        if (selected.shape === "circle") setWidth(event.target.value);
                      }}
                    />
                  </label>
                  <Button size="sm" onClick={fixBoundary}>
                    固定边界
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={viewer} onClick={() => setEditingId(selected.uuid)}>
                  编辑边界
                </Button>
              )}
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTool(null);
              setLegacy(true);
            }}
          >
            <Settings2 className="size-4" />
            原快捷设置
          </Button>
        </aside>
      )}
    </>
  );
}
