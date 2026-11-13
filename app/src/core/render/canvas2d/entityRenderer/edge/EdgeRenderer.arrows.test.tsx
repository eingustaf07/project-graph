import { beforeEach, expect, it, vi } from "vitest";
import { Color, Vector } from "@graphif/data-structures";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: { showBidirectionalArrows: true } }));
vi.mock("./concrete/StraightEdgeRenderer", () => ({}));
vi.mock("./concrete/SymmetryCurveEdgeRenderer", () => ({}));
vi.mock("./concrete/VerticalPolyEdgeRenderer", () => ({}));
vi.mock("./renderArcEdge", () => ({}));
vi.mock("./renderCrEdge", () => ({}));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/stage/stageObject/association/LineEdge", () => ({ LineEdge: class {} }));
vi.mock("@/core/stage/stageObject/association/Edge", () => ({ Edge: class {} }));
import { EdgeRenderer } from "./EdgeRenderer";
import { Settings } from "@/core/service/Settings";

beforeEach(() => {
  Settings.showBidirectionalArrows = true;
});

it("uses the first segment tangent at the source, leaving endpoints and tangents unchanged", () => {
  const renderer = Object.create(EdgeRenderer.prototype) as EdgeRenderer;
  const draw = vi.spyOn(renderer, "renderArrowHead").mockImplementation(() => {});
  const start = new Vector(0, 0),
    end = new Vector(100, 80);
  const sourceDirection = new Vector(0, 1),
    targetDirection = new Vector(1, 0);
  renderer.renderArrowByType(end, start, targetDirection, 15, Color.White, "hollow-diamond", 2, sourceDirection);
  expect(draw).toHaveBeenCalledTimes(2);
  expect(draw.mock.calls[0].slice(0, 2)).toEqual([end, targetDirection]);
  expect(draw.mock.calls[1][0]).toEqual(start);
  expect(draw.mock.calls[1][1].x).toBeCloseTo(0);
  expect(draw.mock.calls[1][1].y).toBe(-1);
  expect(sourceDirection).toEqual(new Vector(0, 1));
  expect(start).toEqual(new Vector(0, 0));
  Settings.showBidirectionalArrows = false;
  const diamond = vi.spyOn(renderer as any, "renderDiamondAtSource").mockImplementation(() => {});
  draw.mockClear();
  renderer.renderArrowByType(end, start, targetDirection, 15, Color.White, "hollow-diamond", 2, sourceDirection);
  expect(draw).not.toHaveBeenCalled();
  expect(diamond).toHaveBeenCalledOnce();
});

it("exports two SVG arrows and restores one when switched off, without endpoint circles", () => {
  const renderer = Object.create(EdgeRenderer.prototype) as EdgeRenderer;
  const svg = () =>
    renderToStaticMarkup(
      <svg>
        {renderer.generateEdgeArrowsSvg(new Vector(100, 0), new Vector(0, 0), new Vector(1, 0), 15, Color.White)}
      </svg>,
    );
  expect(svg().match(/<polygon/g)).toHaveLength(2);
  expect(svg()).not.toContain("circle");
  Settings.showBidirectionalArrows = false;
  expect(svg().match(/<polygon/g)).toHaveLength(1);
});
