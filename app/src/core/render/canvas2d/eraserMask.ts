import type { Project } from "@/core/Project";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { eraserFrame, type EraserMark } from "@/core/algorithm/eraserGeometry";
import { Vector } from "@graphif/data-structures";

// Small erased strokes must not share a viewport-sized backing store with large frames.
const scratch = new WeakMap<CanvasRenderingContext2D, Map<string, HTMLCanvasElement>>();

// Committed marks are immutable. Compute the affected fraction of the entity once, while
// a live preview is measured on every draw because the pointer may have extended it.
const markBounds = new WeakMap<EraserMark, { left: number; top: number; right: number; bottom: number }>();
function affectedBounds(mark: EraserMark, preview: boolean) {
  const cached = !preview && markBounds.get(mark);
  if (cached) return cached;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [x, y] of mark.points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const bounds = {
    left: left - mark.radiusX,
    right: right + mark.radiusX,
    top: top - mark.radiusY,
    bottom: bottom + mark.radiusY,
  };
  if (!preview) markBounds.set(mark, bounds);
  return bounds;
}

function scratchLayer(ctx: CanvasRenderingContext2D, width: number, height: number) {
  let pool = scratch.get(ctx);
  if (!pool) scratch.set(ctx, (pool = new Map()));
  const bucket = (size: number, limit: number) => Math.min(limit, 2 ** Math.ceil(Math.log2(size)));
  const w = bucket(width, ctx.canvas.width);
  const h = bucket(height, ctx.canvas.height);
  const key = w + "x" + h;
  const existing = pool.get(key);
  if (existing) return existing;
  const layer = document.createElement("canvas");
  layer.width = w;
  layer.height = h;
  pool.set(key, layer);
  let pixels = 0;
  for (const [id, surface] of Array.from(pool).reverse()) {
    pixels += surface.width * surface.height;
    if (id !== key && pixels > Math.max(1048576, ctx.canvas.width * ctx.canvas.height)) pool.delete(id);
  }
  if (pool.size > 20) pool.delete(pool.keys().next().value!);
  return layer;
}
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
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const visibleMarks = marks.filter((mark) => {
    const b = affectedBounds(mark, mark === preview);
    const x = Math.max(left, origin.x + b.left * frame.width * scale - 2 / dpr);
    const y = Math.max(top, origin.y + b.top * frame.height * scale - 2 / dpr);
    const r = Math.min(right, origin.x + b.right * frame.width * scale + 2 / dpr);
    const d = Math.min(bottom, origin.y + b.bottom * frame.height * scale + 2 / dpr);
    if (x >= r || y >= d) return false;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, r);
    y1 = Math.max(y1, d);
    return true;
  });
  const paintClean = (exclude?: { x: number; y: number; w: number; h: number }) => {
    ctx.save();
    try {
      const clean = new Path2D();
      clean.rect(left, top, right - left, bottom - top);
      ctx.clip(clean);
      if (exclude) {
        const outside = new Path2D();
        outside.rect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
        outside.rect(exclude.x, exclude.y, exclude.w, exclude.h);
        ctx.clip(outside, "evenodd");
      }
      paint(ctx);
    } finally {
      ctx.restore();
    }
  };
  if (!visibleMarks.length) {
    paintClean();
    return;
  }
  // Split exactly on device pixels. The clean part can go straight onto the destination.
  x0 = Math.floor(x0 * dpr) / dpr;
  y0 = Math.floor(y0 * dpr) / dpr;
  const width = Math.ceil(x1 * dpr) - Math.round(x0 * dpr);
  const height = Math.ceil(y1 * dpr) - Math.round(y0 * dpr);
  if (x0 > left || y0 > top || x0 + width / dpr < right || y0 + height / dpr < bottom) {
    paintClean({ x: x0, y: y0, w: width / dpr, h: height / dpr });
  }
  const layer = scratchLayer(ctx, width, height);
  const target = layer.getContext("2d", { willReadFrequently: true });
  if (!target) throw new Error("无法创建橡皮擦遮罩画布");
  target.clearRect(0, 0, width, height);
  target.save();
  try {
    target.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    project.canvas.ctx = target;
    paint(target);
    applyEraserMarks(target, visibleMarks, origin, frame.width * scale, frame.height * scale);
  } finally {
    project.canvas.ctx = ctx;
    target.restore();
  }
  // Composite only this object's pixels, so overlapping objects and the canvas background are never punched out.
  ctx.drawImage(layer, 0, 0, width, height, x0, y0, width / dpr, height / dpr);
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
