// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: "",
    measureText: (text: string) => ({ width: Array.from(text).length * 50 }),
  })) as never;
});
vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: { watch: () => () => {} } }));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: { play: {} } }));
vi.mock("@/utils/platform", () => ({ isMac: false, isIpad: false }));
vi.mock("@/utils/externalOpen", () => ({ openBrowserOrFileByEntity: vi.fn() }));
vi.mock("./ControllerCamera/mac", () => ({ ControllerCameraMac: class {} }));
import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { ControllerCameraClass } from "./ControllerCamera";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { getMultiLineTextSize } from "@/utils/font";
import { Vector } from "@graphif/data-structures";
import { deserialize, serialize } from "@graphif/serializer";
import { Rectangle } from "@graphif/shapes";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Decoder } from "@msgpack/msgpack";
import { parseProjectFile } from "@/core/ProjectFile";

const controls: ControllerCameraClass[] = [];
beforeEach(() => {
  Object.assign(Settings, {
    textNodeMaxCharWidth: 9,
    defaultFontFamily: "sans-serif",
    isEnableEntityCollision: false,
    isEnableSectionCollision: false,
    autoRefreshStageByMouseAction: true,
    mouseRightDragBackground: "moveCamera",
  });
});
afterEach(() => {
  controls.splice(0).forEach((control) => control.dispose());
  vi.restoreAllMocks();
});

function fixture() {
  const p = {
    stage: [],
    canvas: { element: document.createElement("canvas") },
    controller: {
      isCameraLocked: false,
      pressingKeySet: new Set(),
      isMouseDown: [false, false, true],
      nodeConnection: { isUsing: false },
      setCursorName: vi.fn(),
    },
    camera: { location: Vector.getZero(), currentScale: 1 },
    renderer: { frameIndex: 0, transformView2World: (view: Vector) => view.add(p.camera.location) },
    effects: { addEffect: vi.fn() },
    sectionCollisionSolver: { solveOverlaps: vi.fn() },
    syncAssociationManager: { syncFrom: vi.fn() },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
  } as unknown as Project;
  p.stageManager = new StageManager(p);
  p.sectionMethods = new SectionMethods(p);
  const control = new ControllerCameraClass(p);
  controls.push(control);
  return { p, control };
}

const down = (control: ControllerCameraClass) =>
  control.mousedown({ button: 2, clientX: -1000, clientY: -1000 } as MouseEvent);

it("starts ten pans on a large tree without resizing unchanged nodes or moving content", () => {
  const { p, control } = fixture();
  const nodes = Array.from(
    { length: 1000 },
    (_, i) =>
      new TextNode(p, {
        text: `节点 ${i}`,
        collisionBox: new CollisionBox([new Rectangle(new Vector(i * 500, (i % 3) * 500), Vector.same(100))]),
      }),
  );
  p.stage = [...nodes, ...nodes.slice(1).map((node, i) => new LineEdge(p, { associationList: [nodes[i], node] }))];
  const before = JSON.stringify(serialize(p.stage));
  const recompute = vi.spyOn(TextNode.prototype as any, "adjustSizeByText");
  Settings.isEnableEntityCollision = true;
  for (let i = 0; i < 10; i++) {
    down(control);
    control.mousemove({ clientX: -980, clientY: -990 } as MouseEvent);
    control.mouseup({ button: 2 } as MouseEvent);
  }
  expect(recompute).not.toHaveBeenCalled();
  expect(JSON.stringify(serialize(p.stage))).toBe(before);
  expect(p.camera.location).toEqual(new Vector(-200, -100));
});

it("still refreshes changed auto nodes and their parent while keeping manual widths", () => {
  const { p, control } = fixture();
  const child = new TextNode(p, { text: "短" });
  const parent = new Section(p, { text: "框", children: [child] });
  const manual = new TextNode(p, {
    text: "手动宽度",
    sizeAdjust: "manual",
    collisionBox: new CollisionBox([new Rectangle(new Vector(2000, 0), new Vector(600, 100))]),
  });
  p.stage = [child, parent, manual];
  p.stageManager.updateReferences();
  child.text = "中".repeat(20);
  const width = manual.rectangle.width;
  down(control);
  expect(child.rectangle.width).toBeCloseTo(child.getAutoMaxTextWidth() + child.getPadding() * 2);
  expect(parent.rectangle.right).toBeGreaterThan(child.rectangle.right);
  expect(manual.rectangle.width).toBe(width);
});

it.skipIf(!process.env.PG_PAN_READ_FILE)(
  "profiles right-button pan on a read-only project snapshot",
  async () => {
    const path = process.env.PG_PAN_READ_FILE!;
    const bytes = await readFile(path);
    const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
    const parsed = await parseProjectFile(new Uint8Array(bytes), new Decoder(), new Map());
    if (process.env.PG_PAN_SETTINGS) {
      const saved = JSON.parse(await readFile(process.env.PG_PAN_SETTINGS, "utf8"));
      for (const key of [
        "textNodeMaxCharWidth",
        "defaultFontFamily",
        "isEnableEntityCollision",
        "isEnableSectionCollision",
        "autoRefreshStageByMouseAction",
        "mouseRightDragBackground",
      ] as const) {
        if (key in saved) Object.assign(Settings, { [key]: saved[key] });
      }
    }
    const { p, control } = fixture();
    p.stage = deserialize(parsed.serializedStageObjects, p);
    p.stageManager.updateReferences();
    const before = JSON.stringify(serialize(p.stage));
    const resize = vi.spyOn(TextNode.prototype, "forceAdjustSizeByText");
    const recompute = vi.spyOn(TextNode.prototype as any, "adjustSizeByText");
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      down(control);
      samples.push(performance.now() - start);
      control.mouseup({ button: 2 } as MouseEvent);
    }
    const report = {
      objects: p.stage.length,
      nodes: p.stageManager.getTextNodes().length,
      edges: p.stageManager.getAssociations().length,
      sections: p.stageManager.getSections().length,
      panStartMs: samples,
      forcedNodeResizes: resize.mock.calls.length,
      textRecomputations: recompute.mock.calls.length,
      geometryUnchanged: JSON.stringify(serialize(p.stage)) === before,
      originalFileUnchanged: hash(await readFile(path)) === hash(bytes),
    };
    if (process.env.PG_PAN_REPORT) await writeFile(process.env.PG_PAN_REPORT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    expect(report.originalFileUnchanged).toBe(true);
    expect(report.geometryUnchanged).toBe(true);
    expect(report.textRecomputations).toBe(0);
  },
  60000,
);
