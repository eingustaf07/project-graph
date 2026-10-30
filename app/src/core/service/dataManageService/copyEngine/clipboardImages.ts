import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { SvgNode } from "@/core/stage/stageObject/entity/SvgNode";
import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";

export async function waitForClipboardImages(entities: Entity[]): Promise<void> {
  await Promise.all(
    entities.map(async (entity) => {
      if (entity instanceof ImageNode) await entity.waitForClipboardBitmap();
      if (entity instanceof SvgNode) await waitForClipboardSvg(entity);
    }),
  );
}

export function waitForClipboardSvg(svg: SvgNode): Promise<void> {
  if (svg.image.complete && svg.image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoad = svg.image.onload;
    const onError = svg.image.onerror;
    const cleanup = () => {
      clearTimeout(timeout);
      svg.image.onload = onLoad;
      svg.image.onerror = onError;
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("SVG 图片读取超时"));
    }, 15000);
    svg.image.onload = (event) => {
      onLoad?.call(svg.image, event);
      cleanup();
      resolve();
    };
    svg.image.onerror = () => {
      cleanup();
      reject(new Error("SVG 图片无法读取"));
    };
  });
}
