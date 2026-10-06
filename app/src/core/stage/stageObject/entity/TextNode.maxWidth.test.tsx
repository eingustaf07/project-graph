import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        font: "",
        measureText(text: string) {
          return {
            width: Array.from(text).reduce((width, char) => width + (char.codePointAt(0)! > 127 ? 100 : 50), 0),
          };
        },
      }),
    }),
  });
});
vi.mock("@/core/service/Settings", () => ({
  Settings: { textNodeMaxCharWidth: 15, defaultFontFamily: "sans-serif" },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 30, NODE_PADDING: 10 } }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({
  ConnectableEntity: class {
    updateFatherSectionByMove() {}
    updateOtherEntityLocationByMove() {}
  },
}));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/NodeMoveShadowEffect", () => ({
  NodeMoveShadowEffect: class {},
}));

import { Settings } from "@/core/service/Settings";
import { getMultiLineTextSize, textToTextArray } from "@/utils/font";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { CollisionBox } from "../collisionBox/collisionBox";
import { TextNode } from "./TextNode";
import { SvgUtils } from "@/core/render/svg/SvgUtils";
import { Color } from "@graphif/data-structures";
import { renderToStaticMarkup } from "react-dom/server";

const project = {
  syncAssociationManager: { syncFrom: vi.fn() },
  textRenderer: {
    measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
      getMultiLineTextSize(text, size, height, width),
  },
};
const node = (text: string) => new TextNode(project as never, { text });

describe("Text node maximum width", () => {
  it("exports wrapped text with the node's chosen font and weight", () => {
    const markup = renderToStaticMarkup(
      SvgUtils.multiLineTextFromLeftTopWithWrap(
        "中".repeat(16),
        Vector.getZero(),
        30,
        Color.White,
        450,
        1.5,
        "Example CJK",
        "bold",
      ),
    );
    expect(markup.match(/<text /g)).toHaveLength(2);
    expect(markup).toContain('font-family="Example CJK"');
    expect(markup).toContain('font-weight="bold"');
  });
  beforeEach(() => {
    Settings.textNodeMaxCharWidth = 15;
  });

  it("shrinks short text and wraps only beyond 15 CJK characters", () => {
    expect(node("交易").rectangle.size).toEqual(new Vector(80, 65));
    expect(node("中".repeat(15)).rectangle.size).toEqual(new Vector(470, 65));
    expect(node("中".repeat(16)).rectangle.size).toEqual(new Vector(470, 110));
  });

  it("grows and shrinks when editing an existing node without changing its text", () => {
    const item = node("短");
    item.rename("中".repeat(31));
    expect(item.rectangle.height).toBe(155);
    expect(item.text).toBe("中".repeat(31));
    item.rename("短");
    expect(item.rectangle.size).toEqual(new Vector(50, 65));
  });

  it("recomputes restored or pasted auto nodes instead of retaining stale geometry", () => {
    const item = new TextNode(project as never, {
      text: "中".repeat(20),
      sizeAdjust: "auto",
      collisionBox: new CollisionBox([new Rectangle(new Vector(100, 200), new Vector(900, 30))]),
    });
    expect(item.rectangle.location).toEqual(new Vector(100, 200));
    expect(item.rectangle.size).toEqual(new Vector(470, 110));
  });

  it("applies changed limits and scales the width with the font", () => {
    const item = node("中".repeat(16));
    Settings.textNodeMaxCharWidth = 8;
    item.forceAdjustSizeByText();
    expect(item.rectangle.size).toEqual(new Vector(260, 110));
    item.setFontScaleLevel(2);
    expect(item.rectangle.size).toEqual(new Vector(520, 220));
  });

  it("measures mixed Latin/CJK text by rendered width", () => {
    expect(node("a".repeat(30)).rectangle.height).toBe(65);
    expect(node("中" + "a".repeat(29)).rectangle.height).toBe(110);
  });

  it("preserves intentional newlines, blank lines and trailing newlines", () => {
    expect(textToTextArray("\n中\n\n", 30, 450)).toEqual(["", "中", "", ""]);
    expect(node("").rectangle.height).toBe(65);
    expect(node("中\n").rectangle.height).toBe(110);
  });

  it("does not split surrogate pairs or add spurious blank lines at a narrow limit", () => {
    expect(textToTextArray("😀😀", 30, 30)).toEqual(["😀", "😀"]);
    expect(textToTextArray("中", 30, 0)).toEqual(["中"]);
  });

  it("keeps an explicitly manual width", () => {
    const item = new TextNode(project as never, {
      text: "中".repeat(20),
      sizeAdjust: "manual",
      collisionBox: new CollisionBox([new Rectangle(Vector.getZero(), new Vector(620, 30))]),
    });
    item.rename("短");
    expect(item.rectangle.width).toBe(620);
  });
});
