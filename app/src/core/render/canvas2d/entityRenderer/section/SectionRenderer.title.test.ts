import { expect, it, vi } from "vitest";
vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: {} }));
vi.mock("@/core/service/Settings", () => ({ Settings: { defaultFontFamily: "sans-serif" } }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/stage/stageObject/entity/Doodle", () => ({ Doodle: class {} }));
vi.mock("@/utils/font", () => ({
  getTextSize: (text: string, size: number) => ({ x: text.length * size, y: size }),
}));
vi.mock("../../eraserMask", () => ({
  paintWithErasures: (p: any, _entity: unknown, paint: (ctx: unknown) => void, padding: number) => {
    p.padding = padding;
    paint(p.canvas.ctx);
  },
}));
import { SectionRenderer } from "./SectionRenderer";
import { Settings } from "@/core/service/Settings";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
it("renders transparent Ctrl+G containers using the theme border without changing stored colors", () => {
  const ctx: any = {
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {},
    rect() {},
    stroke: vi.fn(),
    fillText: vi.fn(),
  };
  const border = Color.White;
  const p: any = {
    canvas: { ctx },
    camera: { currentScale: 1 },
    renderer: { w: 1000, h: 800, transformWorld2View: (v: Vector) => v },
    stageStyleManager: { currentStyle: { StageObjectBorder: border } },
  };
  const d = Object.assign(new Doodle({} as any), {
    text: "",
    shape: "rectangle",
    color: Color.Transparent,
    frame: new Rectangle(new Vector(10, 10), new Vector(400, 250)),
  });
  new SectionRenderer(p).render(d);
  expect(ctx.stroke).toHaveBeenCalledOnce();
  expect(ctx.strokeStyle).toBe(border.toString());
  expect(d.color.a).toBe(0);
});
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

it.each(["rectangle", "circle"])(
  "recolors an existing %s border without changing its title, saved color or original appearance when disabled",
  (shape) => {
    const ctx: any = {
      save() {},
      restore() {},
      setLineDash() {},
      beginPath() {},
      rect() {},
      arc() {},
      stroke: vi.fn(),
      fillText: vi.fn(),
    };
    const p: any = {
      canvas: { ctx },
      camera: { currentScale: 1 },
      renderer: { w: 1000, h: 800, transformWorld2View: (v: Vector) => v },
    };
    const frame = Object.assign(new Doodle({} as any), {
      text: "旧框？",
      shape,
      color: Color.Red,
      frame: new Rectangle(new Vector(10, 10), new Vector(400, 250)),
    });
    const renderer = new SectionRenderer(p);
    try {
      Object.assign(Settings, { questionMarkYellow: true });
      renderer.render(frame);
      expect(ctx.strokeStyle).toBe(new Color(255, 235, 59, 1).toString());
      expect(ctx.fillStyle).toBe(Color.Red.toString());
      expect(frame.color).toBe(Color.Red);
      Object.assign(Settings, { questionMarkYellow: false });
      renderer.render(frame);
      expect(ctx.strokeStyle).toBe(Color.Red.toString());
      Object.assign(Settings, { questionMarkYellow: true });
      frame.text = "已解答";
      renderer.render(frame);
      expect(ctx.strokeStyle).toBe(Color.Red.toString());
    } finally {
      Reflect.deleteProperty(Settings, "questionMarkYellow");
    }
  },
);

it.each(["rectangle", "circle"])("fits a zoomed-out %s title inside the shape", (shape) => {
  const config = {
    sectionBitTitleRenderType: "cover",
    sectionBigTitleCameraScaleThreshold: 0.5,
    sectionBigTitleThresholdRatio: 0.25,
  };
  const previous = { ...Settings };
  Object.assign(Settings, config);
  try {
    const scale = 0.2;
    const ctx = {
      save() {},
      restore() {},
      setLineDash() {},
      beginPath() {},
      rect() {},
      arc() {},
      stroke() {},
      fillText: vi.fn(),
    };
    const renderTextInRectangle = vi.fn();
    const renderer = new SectionRenderer({
      camera: { currentScale: scale },
      canvas: { ctx },
      textRenderer: { renderTextInRectangle },
      renderer: { w: 1000, h: 800, transformWorld2View: (p: Vector) => p.multiply(scale) },
    } as any);
    const d = Object.assign(new Doodle({} as any), {
      text: "标题",
      shape,
      color: Color.Black,
      frame: new Rectangle(new Vector(100, 200), new Vector(400, 250)),
    });
    renderer.render(d);
    const [label, rect] = renderTextInRectangle.mock.calls[0];
    expect(label).toBe(d.text);
    expect(rect.center.x).toBeCloseTo(60);
    expect(rect.center.y).toBeCloseTo(65);
    expect(rect.width).toBeCloseTo(shape === "circle" ? 50 / Math.SQRT2 : 80);
    expect(ctx.fillText).not.toHaveBeenCalled();
    Settings.sectionBitTitleRenderType = "top";
    renderer.render(d);
    expect(ctx.fillText).toHaveBeenCalledOnce();
  } finally {
    for (const key of Object.keys(config)) Reflect.deleteProperty(Settings, key);
    Object.assign(Settings, previous);
  }
});

it.each([0.01, 0.1, 0.5, 1, 4, 16])("keeps a visible off-border title eligible at zoom %s", (scale) => {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    textAlign: "right",
    textBaseline: "top",
    font: "",
  };
  const p: any = {
    canvas: { ctx },
    camera: { currentScale: scale },
    renderer: { transformWorld2View: (v: Vector) => v.multiply(scale) },
  };
  const renderer = new SectionRenderer(p);
  const d = Object.assign(new Doodle({} as any), {
    text: "容器标题 WWW",
    shape: "rectangle",
    color: Color.Black,
    frame: new Rectangle(new Vector(100, 100), new Vector(600, 400)),
  });
  const fontSize = Math.max(12, 24 * scale);
  // The viewport is above the border, while the title's baseline is inside it.
  const view = new Rectangle(
    new Vector(100, 100 - (fontSize * 2 + 20) / scale),
    new Vector(2000 / scale, (fontSize * 2 + 19) / scale),
  );
  expect(view.isCollideWith(d.frame)).toBe(false);
  expect(renderer.isDoodleTitleInView(d, view)).toBe(true);
  renderer.render(d);
  expect(ctx.fillText).toHaveBeenCalledWith(d.text, 100 * scale + 8, 100 * scale - 8);
  expect(ctx.font).toBe(fontSize + "px sans-serif");
  expect(ctx.textAlign).toBe("left");
  expect(ctx.textBaseline).toBe("alphabetic");
  expect(p.padding * scale).toBeGreaterThanOrEqual(fontSize * 1.6 + 16);
  d.text = "";
  expect(renderer.isDoodleTitleInView(d, view)).toBe(false);
  ctx.fillText.mockClear();
  renderer.render(d);
  expect(ctx.fillText).not.toHaveBeenCalled();
});
