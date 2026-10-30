import type { Project } from "@/core/Project";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { eraserFrame, type EraserMark } from "@/core/algorithm/eraserGeometry";
import { Vector } from "@graphif/data-structures";

const scratch = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
export function paintWithErasures(
  project: Project,
  entity: Entity,
  paint: (ctx: CanvasRenderingContext2D) => void,
  padding = 4,
): void {
  const ctx = project.canvas.ctx;
  const preview = project.controller?.penStrokeDrawing?.getEraserPreview?.(entity);
  const marks = preview ? [...(entity.erasures ?? []), preview] : (entity.erasures ?? []);
  if (!marks.length) {
    paint(ctx);
    return;
  }
  const frame = eraserFrame(entity.eraserBounds),
    scale = project.camera.currentScale;
  const origin = project.renderer.transformWorld2View(frame.location),
    transform = ctx.getTransform();
  const dpr = Math.max(0.01, Math.hypot(transform.a, transform.b));
  const inset = Math.max(1, padding * scale);
  const left = Math.max(0, Math.floor(origin.x - inset)),
    top = Math.max(0, Math.floor(origin.y - inset));
  const right = Math.min(ctx.canvas.width / dpr, Math.ceil(origin.x + frame.width * scale + inset));
  const bottom = Math.min(ctx.canvas.height / dpr, Math.ceil(origin.y + frame.height * scale + inset));
  if (right <= left || bottom <= top) return;
  let layer = scratch.get(ctx);
  if (!layer) {
    layer = document.createElement("canvas");
    scratch.set(ctx, layer);
  }
  layer.width = Math.max(1, Math.ceil((right - left) * dpr));
  layer.height = Math.max(1, Math.ceil((bottom - top) * dpr));
  const target = layer.getContext("2d");
  if (!target) throw new Error("无法创建橡皮擦遮罩画布");
  target.setTransform(dpr, 0, 0, dpr, -left * dpr, -top * dpr);
  try {
    project.canvas.ctx = target;
    paint(target);
  } finally {
    project.canvas.ctx = ctx;
  }
  applyEraserMarks(target, marks, origin, frame.width * scale, frame.height * scale);
  // Composite only this object's pixels, so overlapping objects and the canvas background are never punched out.
  ctx.drawImage(layer, left, top, right - left, bottom - top);
}

export function applyEraserMarks(
  target: CanvasRenderingContext2D,
  marks: EraserMark[],
  origin: Vector,
  width: number,
  height: number,
): void {
  target.save();
  target.globalCompositeOperation = "destination-out";
  target.lineCap = "round";
  target.lineJoin = "round";
  target.lineWidth = 2;
  target.strokeStyle = "#000";
  target.fillStyle = "#000";
  for (const mark of marks) {
    const rx = mark.radiusX * width,
      ry = mark.radiusY * height;
    if (!(rx > 0 && ry > 0) || !mark.points.length) continue;
    target.save();
    target.translate(origin.x, origin.y);
    target.scale(rx, ry);
    target.beginPath();
    mark.points.forEach(([x, y], i) => {
      const px = (x * width) / rx,
        py = (y * height) / ry;
      if (i) target.lineTo(px, py);
      else target.moveTo(px, py);
    });
    if (mark.points.length === 1 || mark.points.every(([x, y]) => x === mark.points[0][0] && y === mark.points[0][1])) {
      const [x, y] = mark.points[0];
      target.arc((x * width) / rx, (y * height) / ry, 1, 0, Math.PI * 2);
      target.fill();
    } else target.stroke();
    target.restore();
  }
  target.restore();
}
