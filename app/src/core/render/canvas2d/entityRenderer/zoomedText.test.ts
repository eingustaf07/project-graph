import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/controlService/shortcutKeysEngine/KeyBindsUI", () => ({ KeyBindsUI: {} }));
vi.mock("@/core/render/canvas2d/utilsRenderer/SyncAssociationRenderer", () => ({ SyncAssociationRenderer: {} }));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({ TextNode: class {} }));
vi.mock("@/core/stage/stageObject/entity/UrlNode", () => ({
  UrlNode: class {
    static titleHeight = 40;
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({
  Renderer: { FONT_SIZE: 20, NODE_PADDING: 10, NODE_ROUNDED_RADIUS: 8 },
}));
vi.mock("@/core/service/controlService/MouseLocation", () => ({
  MouseLocation: { vector: () => ({ x: -999, y: -999 }) },
}));
vi.mock("@/utils/font", () => ({
  getTextSize: (text: string, size: number) => ({ x: text.length * size, y: size }),
  getFontIdentity: () => "test-font",
  resolveFont: () => "100px sans-serif",
  textToTextArray: (text: string) => text.split("\n"),
}));
vi.mock("@/utils/keyDisplay", () => ({ formatKeyBindSequenceToString: vi.fn() }));
const settings = vi.hoisted(() => ({
  alwaysRenderNodeText: true,
  ignoreTextNodeTextRenderLessThanFontSize: 5,
  forceHideTextNodeBorder: false,
  enableTagTextNodesBigDisplay: false,
  textIntegerLocationAndSizeRender: false,
}));
vi.mock("@/core/service/Settings", () => ({ Settings: settings }));

import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { TextNodeRenderer } from "./textNode/TextNodeRenderer";
import { UrlNodeRenderer } from "./urlNode/urlNodeRenderer";
import { TextRenderer } from "../basicRenderer/textRenderer";

function fixture(scale: number) {
  const project: any = {
    camera: { currentScale: scale },
    autoComputeUtils: { isNameIsLogicNode: () => false },
    renderer: {
      transformWorld2View: (value: Vector) => value.multiply(scale),
      transformView2World: (value: Vector) => value,
    },
    stageStyleManager: { currentStyle: { StageObjectBorder: Color.Black, Background: Color.White } },
    shapeRenderer: { renderRect: vi.fn(), renderDashedRect: vi.fn() },
    textRenderer: { renderMultiLineText: vi.fn(), renderText: vi.fn() },
    curveRenderer: { renderDashedLine: vi.fn() },
  };
  const node: any = {
    text: "多行节点\n缩小后仍然显示",
    title: "链接标题",
    url: "https://example.com",
    rectangle: new Rectangle(new Vector(20, 30), new Vector(200, 80)),
    titleRectangle: { isPointIn: () => false },
    urlRectangle: { isPointIn: () => false },
    color: Color.Transparent,
    borderStyle: "solid",
    isEditing: false,
    isSelected: false,
    getFontSize: () => 20,
    getPadding: () => 10,
    getTextWrapWidth: () => 180,
    getBorderWidth: () => 2,
    getBorderRadius: () => 8,
  };
  return { project, node };
}

beforeEach(() => {
  settings.alwaysRenderNodeText = true;
  settings.ignoreTextNodeTextRenderLessThanFontSize = 5;
  settings.textIntegerLocationAndSizeRender = false;
});

describe("node labels at small canvas zoom", () => {
  it("reuses each node's line layout across zoom even when more than 1000 labels are visible", () => {
    settings.textIntegerLocationAndSizeRender = true;
    const { project, node } = fixture(0.26);
    project.canvas = { ctx: { save() {}, restore() {}, translate() {}, scale() {}, fillText() {} } };
    project.textRenderer = new TextRenderer(project);
    const split = vi.spyOn(project.textRenderer, "textToTextArray");
    const renderer = new TextNodeRenderer(project);
    const nodes = Array.from({ length: 1200 }, (_, i) => ({ ...node, text: "节点" + i }));
    for (const scale of [0.26, 0.241, 0.17]) {
      project.camera.currentScale = scale;
      for (const item of nodes) renderer.renderTextNode(item);
    }
    expect(split).toHaveBeenCalledTimes(nodes.length);
    nodes[0].text = "修改后的内容";
    renderer.renderTextNode(nodes[0]);
    expect(split).toHaveBeenCalledTimes(nodes.length + 1);
    expect(nodes[0].rectangle.size).toEqual(new Vector(200, 80));
  });
  it.each([false, true])("reaches canvas drawing at subpixel sizes with integer alignment %s", (integerAlignment) => {
    settings.textIntegerLocationAndSizeRender = integerAlignment;
    const { project, node } = fixture(0.001);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fillText: vi.fn(),
    };
    project.canvas = { ctx };
    project.renderer.w = 1000;
    project.renderer.h = 1000;
    project.textRenderer = new TextRenderer(project);
    new TextNodeRenderer(project).renderTextNode(node);
    new UrlNodeRenderer(project).render(node);
    expect(ctx.fillText).toHaveBeenCalledWith("多行节点", 0, 50);
    expect(ctx.fillText).toHaveBeenCalledWith("缩小后仍然显示", 0, 50);
    expect(ctx.fillText).toHaveBeenCalledWith(node.title, 0, 50);
    expect(ctx.fillText).toHaveBeenCalledWith(node.url, 0, 50);
    expect(ctx.scale).toHaveBeenCalledWith(0.02 / 100, 0.02 / 100);
    expect(ctx.scale).toHaveBeenCalledWith(0.01 / 100, 0.01 / 100);
    expect(settings.textIntegerLocationAndSizeRender).toBe(integerAlignment);
  });
  it.each([1, 0.26, 0.25, 0.1, 0.01, 0.001])(
    "renders text and URL labels at zoom %s without enlarging them",
    (scale) => {
      const { project, node } = fixture(scale);
      new TextNodeRenderer(project).renderTextNode(node);
      expect(project.textRenderer.renderMultiLineText).toHaveBeenCalledWith(
        node.text,
        expect.any(Vector),
        20 * scale,
        180 * scale,
        expect.any(Color),
        1.5,
        undefined,
        undefined,
        undefined,
        node,
      );
      expect(project.shapeRenderer.renderRect.mock.calls[0][1]).toBe(node.color);
      new UrlNodeRenderer(project).render(node);
      expect(project.textRenderer.renderText).toHaveBeenCalledWith(
        node.title,
        expect.any(Vector),
        20 * scale,
        expect.any(Color),
      );
      expect(project.textRenderer.renderText).toHaveBeenCalledWith(
        node.url,
        expect.any(Vector),
        10 * scale,
        expect.any(Color),
      );
      expect(node.rectangle.size).toEqual(new Vector(200, 80));
      expect(node.text).toBe("多行节点\n缩小后仍然显示");
    },
  );

  it("retains the old cutoff as an optional behavior and responds to toggling immediately", () => {
    const { project, node } = fixture(0.1);
    const renderer = new TextNodeRenderer(project);
    const urlRenderer = new UrlNodeRenderer(project);
    settings.alwaysRenderNodeText = false;
    renderer.renderTextNode(node);
    urlRenderer.render(node);
    expect(project.textRenderer.renderMultiLineText).not.toHaveBeenCalled();
    expect(project.textRenderer.renderText).not.toHaveBeenCalled();
    settings.alwaysRenderNodeText = true;
    renderer.renderTextNode(node);
    urlRenderer.render(node);
    expect(project.textRenderer.renderMultiLineText).toHaveBeenCalledTimes(1);
    expect(project.textRenderer.renderText).toHaveBeenCalledTimes(2);
    expect(settings.ignoreTextNodeTextRenderLessThanFontSize).toBe(5);
  });
});
