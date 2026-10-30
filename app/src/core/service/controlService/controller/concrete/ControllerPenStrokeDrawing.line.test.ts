import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() =>
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ font: "", measureText: (s: string) => ({ width: [...s].length * 32 }) }),
    }),
  }),
);
vi.mock("@/core/Project", () => ({
  Project: class {},
  ProjectState: { Saved: "saved", Unsaved: "unsaved" },
  service: () => (c: unknown) => c,
}));
vi.mock("@/core/service/Settings", () => ({ Settings: { watch: () => () => {} } }));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: {} }));
vi.mock("@/utils/platform", () => ({ isMac: false, isWeb: false }));
vi.mock("@/core/stage/stageObject/entity/LatexNode", () => ({ LatexNode: class {} }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), promise: vi.fn() } }));
import { Settings } from "@/core/service/Settings";
import type { Project } from "@/core/Project";
import { ControllerPenStrokeDrawingClass } from "./ControllerPenStrokeDrawing";
import { DrawingControllerRenderer } from "@/core/render/canvas2d/controllerRenderer/drawingRenderer";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { SectionInOutManager } from "@/core/stage/stageManager/concreteMethods/StageSectionInOutManager";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { PenStroke } from "@/core/stage/stageObject/entity/PenStroke";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { Vector, Color } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { serialize, deserialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";
import { toast } from "sonner";
const controls: ControllerPenStrokeDrawingClass[] = [];
function fixture() {
  const p: any = {
    stage: [],
    attachments: new Map(),
    emit: vi.fn(),
    canvas: { element: new EventTarget(), clientToView: (x: number, y: number) => new Vector(x, y) },
    camera: { currentScale: 2 },
    controller: {
      isMouseDown: [true, false, false],
      pressingKeySet: new Set(),
      camera: { isPreGrabbingWhenSpace: false },
      setCursorName: vi.fn(),
      penStrokeControl: { isAdjusting: false },
    },
    effects: { addEffect: vi.fn() },
    sectionCollisionSolver: { solveOverlaps: vi.fn() },
    syncAssociationManager: { syncFrom: vi.fn() },
    stageStyleManager: { currentStyle: { StageObjectBorder: new Color(200, 200, 200) } },
    curveRenderer: { renderSolidLine: vi.fn(), renderPenStroke: vi.fn() },
    shapeRenderer: { renderCircle: vi.fn() },
  };
  p.renderer = {
    transformView2World: (v: Vector) => v.divide(2).add(new Vector(100, 50)),
    transformWorld2View: (v: Vector) => v.subtract(new Vector(100, 50)).multiply(2),
  };
  p.stageManager = new StageManager(p);
  p.sectionMethods = new SectionMethods(p);
  p.sectionInOutManager = new SectionInOutManager(p);
  p.historyManager = new HistoryManager(p);
  const drawing = new ControllerPenStrokeDrawingClass(p);
  controls.push(drawing);
  p.controller.penStrokeDrawing = drawing;
  p.drawingControllerRenderer = new DrawingControllerRenderer(p);
  const record = vi.spyOn(p.historyManager, "recordStep");
  return { p: p as Project, drawing, record };
}
function event(x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    clientX: x,
    clientY: y,
    button: 0,
    shiftKey: false,
    pointerType: "mouse",
    ...extra,
  } as unknown as PointerEvent;
}
function stroke(p: Project) {
  return p.stageManager.getPenStrokes()[0];
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(Settings, {
    mouseLeftMode: "draw",
    penStrokeStraightLine: true,
    penStrokeLineWidth: 8,
    autoFillPenStrokeColorEnable: true,
    autoFillPenStrokeColor: [220, 30, 80, 0.6],
    enableOCR: false,
    textNodeMaxCharWidth: 15,
    defaultFontFamily: "sans-serif",
    historyManagerMode: "memoryEfficient",
    historySize: 100,
    isEnableEntityCollision: false,
  });
});
afterEach(() => {
  controls.splice(0).forEach((c) => c.dispose());
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("straight and colored drawing with real PG strokes", () => {
  it("commits exact press/release endpoints despite curved mouse movement, with one history step", () => {
    const { p, drawing, record } = fixture();
    drawing.mousedown(event(100, 100));
    drawing.mousemove(event(180, 350));
    drawing.mousemove(event(240, 20));
    drawing.mouseup(event(400, 200));
    expect(stroke(p).segments).toHaveLength(2);
    expect(stroke(p).getPath()).toEqual([new Vector(150, 100), new Vector(300, 150)]);
    expect(stroke(p).segments[0].pressure).toBe(8 / 5);
    expect(stroke(p).color.toArray()).toEqual([220, 30, 80, 0.6]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(drawing.currentSegments).toEqual([]);
  });
  it("creates a fast drag even without intermediate move events", () => {
    const { p, drawing } = fixture();
    drawing.mousedown(event(100, 100));
    drawing.mouseup(event(600, 500));
    expect(stroke(p)).toBeInstanceOf(PenStroke);
  });
  it.each([
    [300, 115],
    [115, 300],
    [290, 300],
    [-100, 290],
    [-100, -90],
    [300, -100],
  ])("snaps Shift line towards %s,%s and keeps preview identical to committed geometry", (x, y) => {
    const { p, drawing } = fixture();
    drawing.mousedown(event(100, 100));
    p.controller.pressingKeySet.add("shift");
    MouseLocation.x = x;
    MouseLocation.y = y;
    drawing.mousemove(event(x, y, { shiftKey: true }));
    const preview = drawing.getStraightLinePreview(p.renderer.transformView2World(new Vector(x, y)))!;
    p.drawingControllerRenderer.renderTempDrawing();
    const args = vi.mocked(p.curveRenderer.renderSolidLine).mock.calls[0];
    expect(args[0]).toEqual(p.renderer.transformWorld2View(preview[0]));
    expect(args[1]).toEqual(p.renderer.transformWorld2View(preview[1]));
    expect(args[3]).toBe(16);
    drawing.mouseup(event(x, y, { shiftKey: true }));
    expect(stroke(p).getPath()).toEqual(preview);
    const delta = preview[1].subtract(preview[0]);
    expect(
      Math.min(Math.abs(delta.x), Math.abs(delta.y), Math.abs(Math.abs(delta.x) - Math.abs(delta.y))),
    ).toBeLessThan(1e-8);
  });
  it("a click in straight mode never recolors the existing node", () => {
    const { p, drawing, record } = fixture();
    const n = new TextNode(p, {
      text: "原节点",
      color: new Color(10, 20, 30),
      collisionBox: new CollisionBox([new Rectangle(new Vector(150, 100), new Vector(80, 60))]),
    });
    p.stageManager.add(n);
    drawing.mousedown(event(100, 100));
    drawing.mouseup(event(100, 100));
    expect(n.color.toArray()).toEqual([10, 20, 30, 1]);
    expect(p.stageManager.getPenStrokes()).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });
  it("preserves old freehand samples, chosen color and legacy Shift/Control straight drawing", () => {
    Settings.penStrokeStraightLine = false;
    const { p, drawing } = fixture();
    drawing.mousedown(event(100, 100));
    for (const [x, y] of [
      [110, 110],
      [200, 300],
      [300, 120],
      [400, 300],
    ])
      drawing.mousemove(event(x, y));
    drawing.mouseup(event(400, 300));
    expect(stroke(p).segments).toHaveLength(4);
    expect(stroke(p).color.toArray()).toEqual([220, 30, 80, 0.6]);
    p.controller.pressingKeySet.add("shift");
    p.controller.pressingKeySet.add("control");
    drawing.mousedown(event(100, 100));
    for (const [x, y] of [
      [110, 110],
      [200, 300],
      [300, 120],
      [400, 300],
    ])
      drawing.mousemove(event(x, y));
    drawing.mouseup(event(400, 300));
    const oldLine = p.stageManager.getPenStrokes()[1];
    expect(oldLine.segments).toHaveLength(2);
    expect(oldLine.segments[0].location.y).toBe(oldLine.segments[1].location.y);
  });
  it.each(["escape", "right", "mode"])("cancels safely via %s without committing or changing nodes", (kind) => {
    const { p, drawing, record } = fixture();
    drawing.mousedown(event(100, 100));
    drawing.mousemove(event(400, 300));
    if (kind === "escape") drawing.keydown({ key: "Escape" } as KeyboardEvent);
    if (kind === "right") drawing.mousedown(event(400, 300, { button: 2 }));
    if (kind === "mode") Settings.mouseLeftMode = "selectAndMove";
    drawing.mouseup(event(400, 300));
    expect(p.stage).toEqual([]);
    expect(drawing.isUsingStraightLine).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
  it("supports undo, redo and binary serialization with identical geometry and color", () => {
    const { p, drawing } = fixture();
    drawing.mousedown(event(100, 100));
    drawing.mouseup(event(400, 300));
    const saved = serialize(p.stage);
    p.historyManager.undo();
    expect(p.stage).toEqual([]);
    p.historyManager.redo();
    expect(serialize(p.stage)).toEqual(saved);
    p.stage = deserialize(decode(new Encoder().encode(saved)), p);
    p.stageManager.updateReferences();
    expect(serialize(p.stage)).toEqual(saved);
  });
  it("refuses an oversized line inside a fixed container without leaving a partial stroke", () => {
    const { p, drawing, record } = fixture();
    p.stageManager.add(new Doodle(p, { frame: new Rectangle(Vector.getZero(), new Vector(400, 300)), bounded: true }));
    const before = serialize(p.stage);
    drawing.mousedown(event(100, 100));
    drawing.mouseup(event(3000, 3000));
    expect(serialize(p.stage)).toEqual(before);
    expect(record).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(drawing.isUsingStraightLine).toBe(false);
  });
});
