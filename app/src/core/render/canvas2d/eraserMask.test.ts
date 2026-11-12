// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import type { Project } from "@/core/Project";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { paintWithErasures } from "./eraserMask";

function scene() {
  vi.stubGlobal(
    "Path2D",
    class {
      rect() {}
    },
  );
  const canvas = document.createElement("canvas");
  canvas.width = 1500;
  canvas.height = 850;
  const ctx = {
    canvas,
    getTransform: () => ({ a: 1, b: 0 }),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
  };
  const project = {
    canvas: { ctx },
    camera: { currentScale: 1 },
    renderer: { transformWorld2View: (v: Vector) => v },
  } as unknown as Project;
  const entity = {
    eraserBounds: new Rectangle(Vector.getZero(), new Vector(10000, 10000)),
    erasures: [{ radiusX: 0.001, radiusY: 0.001, points: [[0.01, 0.02]] }],
  } as unknown as Entity;
  return { ctx, project, entity };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("bounds compositing to the visible erase mark even on a huge frame", () => {
  const { ctx, project, entity } = scene();
  const layer = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(layer as never);
  paintWithErasures(project, entity, vi.fn());
  expect(ctx.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 24, 24, 88, 188, 24, 24]);
  expect(project.canvas.ctx).toBe(ctx);
});

it("draws directly when panning puts all marks outside the viewport", () => {
  const { ctx, project, entity } = scene();
  Object.assign(project.renderer, { transformWorld2View: (v: Vector) => v.subtract(new Vector(2000, 2000)) });
  const acquire = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
  const paint = vi.fn();
  paintWithErasures(project, entity, paint);
  expect(acquire).not.toHaveBeenCalled();
  expect(paint).toHaveBeenCalledExactlyOnceWith(ctx);
  expect(ctx.drawImage).not.toHaveBeenCalled();
});
