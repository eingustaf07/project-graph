import type { Project } from "@/core/Project";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { Settings } from "@/core/service/Settings";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { useEffect, useRef, useState, lazy, Suspense, type PointerEvent, type ComponentProps } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Circle,
  MousePointer2,
  RectangleHorizontal,
  Settings2,
  Eraser,
  Slash,
  SlidersHorizontal,
  Frame,
  Square,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";
import type { DoodleShape } from "@/core/algorithm/doodleBounds";
import {
  doodleCommandEvent,
  type DoodleCommand,
} from "@/core/service/controlService/shortcutKeysEngine/doodleCommands";

const LegacyToolbar = lazy(() => import("./right-toolbar"));
function ToolButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-8 shrink-0"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}
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
  const [titleEditingId, setTitleEditingId] = useState<string>();
  const titleInput = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [viewer, setViewer] = useState(Settings.viewerMode);
  const [penLine, setPenLine] = useState(Settings.penStrokeStraightLine);
  const [penWidth, setPenWidth] = useState(Settings.penStrokeLineWidth);
  const [eraser, setEraser] = useState(Settings.penStrokeEraser);
  const [eraserSize, setEraserSize] = useState(Settings.penStrokeEraserSize);
  const [penInk, setPenInk] = useState(Settings.autoFillPenStrokeColor);
  const [penInkEnabled, setPenInkEnabled] = useState(Settings.autoFillPenStrokeColorEnable);
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
    const stops = [
      Settings.watch("penStrokeEraser", setEraser),
      Settings.watch("penStrokeEraserSize", setEraserSize),
      Settings.watch("penStrokeStraightLine", setPenLine),
      Settings.watch("penStrokeLineWidth", setPenWidth),
      Settings.watch("autoFillPenStrokeColor", setPenInk),
      Settings.watch("autoFillPenStrokeColorEnable", setPenInkEnabled),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);
  const resolvedInk =
    penInkEnabled && penInk && penInk[3] > 0
      ? new Color(...penInk)
      : project.stageStyleManager.currentStyle.StageObjectBorder;
  const setInk = (hex: string, alpha: number) => {
    const next = Color.fromHex(hex).toNewAlpha(alpha).toArray();
    Settings.autoFillPenStrokeColorEnable = true;
    Settings.autoFillPenStrokeColor = next;
    setPenInkEnabled(true);
    setPenInk(next);
    refresh();
  };
  useEffect(() => {
    let frame = 0;
    let moving: { entity: Doodle; pointerId: number; start: Vector; original: Vector; moved: boolean } | undefined;
    const moveFrame = (event: globalThis.PointerEvent) => {
      if (!moving || moving.pointerId !== event.pointerId) return;
      const point = project.canvas.clientToView(event.clientX, event.clientY);
      const delta = project.renderer.transformView2World(point).subtract(moving.start);
      if (!moving.moved && delta.magnitude() * project.camera.currentScale < 3) return;
      moving.moved = true;
      moving.entity.moveTo(moving.original.add(delta));
      project.controller.resetCountdownTimer();
      project.loop();
      redraw((value) => value + 1);
    };
    const stopFrameDrag = (event: globalThis.PointerEvent) => {
      if (!moving || moving.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      moveFrame(event);
      const finished = moving;
      moving = undefined;
      if (project.canvas.element.hasPointerCapture(event.pointerId))
        project.canvas.element.releasePointerCapture(event.pointerId);
      if (finished.moved) {
        project.stageManager.updateReferences();
        project.historyManager.recordStep();
      }
    };
    const cancelFrameDrag = () => {
      if (!moving) return;
      const cancelled = moving;
      moving = undefined;
      if (cancelled.moved) cancelled.entity.moveTo(cancelled.original);
      if (project.canvas.element.hasPointerCapture(cancelled.pointerId))
        project.canvas.element.releasePointerCapture(cancelled.pointerId);
      project.controller.resetCountdownTimer();
      project.loop();
      redraw((value) => value + 1);
    };
    const cancelFrameDragByKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelFrameDrag();
    };
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
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        Settings.viewerMode ||
        project.controller.camera?.isPreGrabbingWhenSpace ||
        Settings.penStrokeEraser
      )
        return;
      const point = project.canvas.clientToView(event.clientX, event.clientY);
      const entity = project.stageManager.findEntityByLocation(project.renderer.transformView2World(point));
      if (entity instanceof Doodle && !project.sectionMethods.isObjectBeLockedBySection(entity)) {
        project.stageManager.clearSelectAll();
        entity.isSelected = true;
        setSelected(entity);
        setEditingId(entity.uuid);
      }
      schedule();
    };
    const selectFrameInDrawingMode = (event: globalThis.PointerEvent) => {
      if (
        Settings.mouseLeftMode !== "draw" ||
        project.controller.camera?.isPreGrabbingWhenSpace ||
        Settings.penStrokeEraser ||
        Settings.viewerMode ||
        event.pointerType === "pen" ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const point = project.canvas.clientToView(event.clientX, event.clientY);
      const entity = project.stageManager.findEntityByLocation(project.renderer.transformView2World(point));
      if (!(entity instanceof Doodle) || project.sectionMethods.isObjectBeLockedBySection(entity)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      project.stageManager.clearSelectAll();
      entity.isSelected = true;
      setSelected(entity);
      setEditingId(entity.uuid);
      moving = {
        entity,
        pointerId: event.pointerId,
        start: project.renderer.transformView2World(point),
        original: entity.frame.location.clone(),
        moved: false,
      };
      project.canvas.element.setPointerCapture(event.pointerId);
      project.controller.resetCountdownTimer();
      project.loop();
    };
    const editTitle = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        Settings.viewerMode ||
        Settings.penStrokeEraser
      )
        return;
      const point = project.canvas.clientToView(event.clientX, event.clientY);
      const entity = project.stageManager.findEntityByLocation(project.renderer.transformView2World(point));
      if (!(entity instanceof Doodle) || project.sectionMethods.isObjectBeLockedBySection(entity)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      project.stageManager.clearSelectAll();
      entity.isSelected = true;
      setSelected(entity);
      setName(entity.text);
      setEditingId(entity.uuid);
      setTitleEditingId(entity.uuid);
      setOptionsOpen(false);
      project.controller.resetCountdownTimer();
      project.loop();
    };
    project.on("state-change", schedule);
    project.canvas.element.addEventListener("dblclick", editTitle, true);
    project.canvas.element.addEventListener("pointermove", moveFrame, true);
    project.canvas.element.addEventListener("pointerup", stopFrameDrag, true);
    project.canvas.element.addEventListener("pointercancel", cancelFrameDrag);
    project.canvas.element.addEventListener("lostpointercapture", cancelFrameDrag);
    window.addEventListener("keydown", cancelFrameDragByKey);
    project.canvas.element.addEventListener("pointerdown", selectFrameInDrawingMode, true);
    project.canvas.element.addEventListener("pointerup", clickFrame);
    window.addEventListener("pointerup", schedule);
    window.addEventListener("keyup", schedule);
    window.addEventListener("wheel", schedule);
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      project.off("state-change", schedule);
      project.canvas.element.removeEventListener("dblclick", editTitle, true);
      project.canvas.element.removeEventListener("pointermove", moveFrame, true);
      project.canvas.element.removeEventListener("pointerup", stopFrameDrag, true);
      project.canvas.element.removeEventListener("pointercancel", cancelFrameDrag);
      project.canvas.element.removeEventListener("lostpointercapture", cancelFrameDrag);
      window.removeEventListener("keydown", cancelFrameDragByKey);
      cancelFrameDrag();
      project.canvas.element.removeEventListener("pointerdown", selectFrameInDrawingMode, true);
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
      setTitleEditingId(undefined);
      return;
    }
    setBounded(selected.bounded);
    setName(selected.text);
    setColor(selected.color.toHexStringWithoutAlpha());
    setWidth(String(Math.round(selected.frame.width)));
    setHeight(String(Math.round(selected.frame.height)));
  }, [selected]);
  useEffect(() => {
    if (titleEditingId && selected?.uuid === titleEditingId) {
      titleInput.current?.focus();
      titleInput.current?.select();
    }
  }, [titleEditingId, selected]);
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

  const editing = !!selected && editingId === selected.uuid && !tool && !viewer && !eraser;
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
        text: name,
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
    if (!selected || viewer) return false;
    try {
      const dimensionsChanged =
        width !== String(Math.round(selected.frame.width)) || height !== String(Math.round(selected.frame.height));
      const changed =
        dimensionsChanged ||
        selected.text !== name ||
        selected.color.toHexStringWithoutAlpha() !== color ||
        selected.bounded !== bounded;
      if (dimensionsChanged)
        selected.resizeFrame(new Rectangle(selected.frame.location.clone(), new Vector(Number(width), Number(height))));
      if (selected.text !== name) selected.rename(name);
      if (selected.color.toHexStringWithoutAlpha() !== color) selected.color = Color.fromHex(color);
      if (selected.bounded !== bounded) selected.setBounded(bounded);
      if (changed) {
        project.stageManager.updateReferences();
        project.historyManager.recordStep();
      }
      setEditingId(undefined);
      setTitleEditingId(undefined);
      setOptionsOpen(false);
      refresh();
      return true;
    } catch (error) {
      toast.error(String(error));
      return false;
    }
  };
  useEffect(() => {
    if (!editing || !selected) return;
    const finishOnOutside = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest("[data-pg-doodle-toolbar], [data-pg-doodle-parameters], [data-pg-doodle-handle]"))
        return;
      if (event.target === project.canvas.element) {
        const point = project.canvas.clientToView(event.clientX, event.clientY);
        if (project.stageManager.findEntityByLocation(project.renderer.transformView2World(point)) === selected) return;
      }
      if (!fixBoundary()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOptionsOpen(true);
      }
    };
    window.addEventListener("pointerdown", finishOnOutside, true);
    return () => window.removeEventListener("pointerdown", finishOnOutside, true);
  });
  const startTool = (next: DoodleShape) => {
    if (editing && !fixBoundary()) return;
    project.stageManager.clearSelectAll();
    setSelected(undefined);
    setEditingId(undefined);
    setName("");
    setTool(next);
    setOptionsOpen(false);
    setLegacy(false);
    refresh();
  };

  useEffect(() => {
    const run = (command: DoodleCommand) => {
      if (viewer) return;
      if (command === "rectangle" || command === "circle") {
        startTool(command);
        return;
      }
      if (command === "parameters") {
        setLegacy(false);
        setOptionsOpen((open) => !open);
        return;
      }
      if (command === "container") {
        setLegacy(false);
        setBounded(true);
        return;
      }
      if (command === "decoration") {
        setLegacy(false);
        setBounded(false);
        return;
      }
      if (command === "eraser") {
        if (!eraser && editing && !fixBoundary()) return;
        Settings.mouseLeftMode = "draw";
        Settings.penStrokeEraser = true;
        setEraser(true);
        setLegacy(false);
        refresh();
        return;
      }
      if (command === "line") {
        Settings.mouseLeftMode = "draw";
        Settings.penStrokeEraser = false;
        setEraser(false);
        Settings.penStrokeStraightLine = true;
        setPenLine(true);
        setLegacy(false);
        refresh();
        return;
      }
      if (command === "legacy") {
        if (editing && !fixBoundary()) return;
        setTool(null);
        setLegacy(true);
      }
    };
    project.on(doodleCommandEvent, run);
    return () => {
      project.off(doodleCommandEvent, run);
    };
  });
  return (
    <>
      {editing && titleEditingId === selected?.uuid && viewFrame && (
        <Input
          ref={titleInput}
          data-pg-doodle-parameters
          aria-label="编辑图形标题"
          placeholder="标题（可留空）"
          className="bg-popover absolute z-50 h-8"
          style={{
            left: Math.max(4, viewFrame.left),
            top: Math.max(4, viewFrame.top - 38),
            width: Math.max(160, Math.min(360, viewFrame.width)),
          }}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              fixBoundary();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setName(selected.text);
              setTitleEditingId(undefined);
            }
          }}
        />
      )}
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
              data-pg-doodle-handle
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
          data-pg-doodle-toolbar
          className="bg-popover/95 supports-backdrop-blur:bg-popover/80 border-border/50 absolute top-1/2 right-2 z-50 flex max-h-[calc(100%-16px)] w-11 -translate-y-1/2 flex-col items-center gap-0.5 overflow-y-auto rounded-lg border px-1 py-1.5 shadow-xl backdrop-blur-md"
        >
          <ToolButton
            label="橡皮模式"
            role="switch"
            aria-checked={eraser ?? false}
            variant={eraser ? "default" : "ghost"}
            disabled={viewer}
            onClick={() => {
              if (!eraser && editing && !fixBoundary()) return;
              const value = !eraser;
              Settings.penStrokeEraser = value;
              setEraser(value);
              refresh();
            }}
          >
            <Eraser className="size-4" />
          </ToolButton>
          <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
            <PopoverTrigger asChild>
              <ToolButton label="涂鸦参数">
                <SlidersHorizontal className="size-4" />
              </ToolButton>
            </PopoverTrigger>
            <PopoverContent
              data-pg-doodle-parameters
              side="left"
              align="center"
              sideOffset={8}
              className="flex max-h-[85vh] w-48 max-w-[calc(100vw-64px)] flex-col gap-2 overflow-y-auto p-3 text-xs"
            >
              <strong>涂鸦参数</strong>
              <label className="flex items-center justify-between gap-2 text-xs">
                橡皮大小
                <Input
                  aria-label="橡皮大小"
                  type="number"
                  min={4}
                  max={300}
                  className="w-20"
                  value={eraserSize ?? 32}
                  disabled={viewer}
                  onChange={(event) => {
                    const size = Math.max(4, Math.min(300, Number(event.target.value) || 4));
                    Settings.penStrokeEraserSize = size;
                    setEraserSize(size);
                    refresh();
                  }}
                />
              </label>
              <p className="text-muted-foreground text-xs">
                图片和涂鸦局部擦除，节点与连线整块删除。松开提交，Esc取消；一笔可撤销。
              </p>
              {eraser && (
                <p className="text-muted-foreground text-xs">擦除容器边线不改变其固定范围；解除限制请切换涂鸦模式。</p>
              )}
              <p className="text-muted-foreground text-xs">
                用于已有鼠标涂鸦模式；开启后拖动画直线，Shift 对齐水平、垂直或45°。
              </p>
              <label className="flex items-center justify-between gap-2 text-xs">
                笔迹颜色
                <input
                  aria-label="涂鸦笔迹颜色"
                  type="color"
                  value={resolvedInk.toHexStringWithoutAlpha()}
                  disabled={viewer}
                  onChange={(event) => setInk(event.target.value, penInkEnabled && penInk?.[3] > 0 ? penInk[3] : 1)}
                  className="h-6 w-10"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                不透明度 %
                <Input
                  aria-label="涂鸦不透明度"
                  type="number"
                  min={1}
                  max={100}
                  className="w-20"
                  value={Math.round((penInkEnabled && penInk?.[3] > 0 ? penInk[3] : 1) * 100)}
                  disabled={viewer}
                  onChange={(event) =>
                    setInk(
                      resolvedInk.toHexStringWithoutAlpha(),
                      Math.max(1, Math.min(100, Number(event.target.value) || 1)) / 100,
                    )
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                直线粗细
                <Input
                  aria-label="直线涂鸦粗细"
                  type="number"
                  min={1}
                  max={50}
                  className="w-20"
                  value={penWidth ?? 5}
                  disabled={viewer || !penLine}
                  onChange={(event) => {
                    const next = Math.max(1, Math.min(50, Number(event.target.value) || 1));
                    Settings.penStrokeLineWidth = next;
                    setPenWidth(next);
                    refresh();
                  }}
                />
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={viewer}
                onClick={() => {
                  Settings.autoFillPenStrokeColorEnable = true;
                  Settings.autoFillPenStrokeColor = [0, 0, 0, 0];
                  setPenInkEnabled(true);
                  setPenInk([0, 0, 0, 0]);
                  refresh();
                }}
              >
                笔迹跟随主题颜色
              </Button>
              <div className="border-border border-t" />
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
                  placeholder="标题（可留空）"
                  value={name}
                  disabled={viewer || (!!selected && !editing)}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
              {selected && (
                <>
                  <span className="text-xs">
                    {editing ? "拖动四角调整大小，点击其他位置自动固定" : "已固定；点击图形边框重新编辑"}
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
                    </>
                  ) : (
                    <Button size="sm" variant="outline" disabled={viewer} onClick={() => setEditingId(selected.uuid)}>
                      调整边界尺寸
                    </Button>
                  )}
                </>
              )}
            </PopoverContent>
          </Popover>
          <div className="border-border w-6 border-t" />
          <ToolButton
            label="容器模式"
            variant={bounded ? "default" : "ghost"}
            aria-pressed={bounded}
            onClick={() => setBounded(true)}
            disabled={viewer}
          >
            <Square className="size-4" />
          </ToolButton>
          <ToolButton
            label="涂鸦模式"
            variant={bounded ? "ghost" : "default"}
            aria-pressed={!bounded}
            onClick={() => setBounded(false)}
            disabled={viewer}
          >
            <Frame className="size-4" />
          </ToolButton>
          <ToolButton
            label="直线涂鸦"
            role="switch"
            aria-checked={penLine ?? false}
            variant={penLine ? "default" : "ghost"}
            disabled={viewer}
            onClick={() => {
              const value = !penLine;
              Settings.penStrokeStraightLine = value;
              setPenLine(value);
              refresh();
            }}
          >
            <Slash className="size-4" />
          </ToolButton>
          <ToolButton
            label="长方形"
            variant={tool === "rectangle" ? "default" : "ghost"}
            onClick={() => startTool("rectangle")}
            disabled={viewer}
          >
            <RectangleHorizontal className="size-4" />
          </ToolButton>
          <ToolButton
            label="圆形"
            variant={tool === "circle" ? "default" : "ghost"}
            onClick={() => startTool("circle")}
            disabled={viewer}
          >
            <Circle className="size-4" />
          </ToolButton>
          {tool && (
            <ToolButton
              label="返回选择"
              onClick={() => {
                setTool(null);
                setGesture(undefined);
              }}
            >
              <MousePointer2 className="size-4" />
            </ToolButton>
          )}
          {selected && !editing && (
            <ToolButton
              label="编辑边界"
              disabled={viewer}
              onClick={() => {
                setEditingId(selected.uuid);
                setOptionsOpen(true);
              }}
            >
              <LockKeyhole className="size-4" />
            </ToolButton>
          )}
          <ToolButton
            label="原快捷设置"
            onClick={() => {
              if (editing && !fixBoundary()) return;
              setTool(null);
              setLegacy(true);
            }}
          >
            <Settings2 className="size-4" />
          </ToolButton>
        </aside>
      )}
    </>
  );
}
