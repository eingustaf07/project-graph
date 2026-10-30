import { Project } from "@/core/Project";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { MouseLocation } from "../../controlService/MouseLocation";
import { Settings } from "@/core/service/Settings";
import { applyBlackAndWhite, prepareImageBlobForImport, type PreparedImageBlob } from "../imageUtils";
import { toast } from "sonner";
import { createImageNodeFromBlob } from "../imageNodeFactory";
import { Vector } from "@graphif/data-structures";
import { readClipboardImagePaths, readFile } from "./clipboardFiles";

export class ClipboardImageUnavailable extends Error {
  constructor(cause: unknown) {
    super("当前剪贴板未提供可读取的图片格式", { cause });
  }
}

export class CopyEngineImage {
  constructor(private project: Project) {}

  public async pasteImageFromTauriClipboard(
    location = this.project.renderer.transformView2World(MouseLocation.vector()).clone(),
  ) {
    // 从系统粘贴板里读取图片
    let image;
    try {
      image = await readImage();
    } catch (error) {
      throw new ClipboardImageUnavailable(error);
    }
    let prepared: PreparedImageBlob;
    try {
      const { width: origW, height: origH } = await image.size();

      if (
        !Number.isSafeInteger(origW) ||
        !Number.isSafeInteger(origH) ||
        origW <= 0 ||
        origH <= 0 ||
        origW > 16384 ||
        origH > 16384 ||
        origW * origH > 64 * 1024 * 1024
      )
        throw new Error("剪贴板图片尺寸不受支持");

      const rgba = await image.rgba();
      const expectedLength = origW * origH * 4;
      const clamped = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
      if (clamped.length !== expectedLength) throw new Error("剪贴板图片数据不完整，请重新复制图片");
      const data = new Uint8ClampedArray(clamped);

      const origCanvas = document.createElement("canvas");
      origCanvas.width = origW;
      origCanvas.height = origH;
      const origCtx = origCanvas.getContext("2d");
      if (!origCtx) throw new Error("无法创建图片画布");
      origCtx.putImageData(new ImageData(data, origW, origH), 0, 0);

      let w = origW;
      let h = origH;
      if (Settings.resizePastedImages) {
        const maxSize = Settings.maxPastedImageSize;
        const maxDim = Math.max(w, h);
        if (maxDim > maxSize) {
          const scale = maxSize / maxDim;
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建图片画布");
      ctx.drawImage(origCanvas, 0, 0, w, h);

      if (Settings.compressImageToBlackAndWhite) {
        applyBlackAndWhite(canvas);
      }

      const outputType = Settings.compressImageToBlackAndWhite
        ? "image/png"
        : Settings.compressImageToWebp
          ? "image/webp"
          : "image/png";
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) {
              if (outputType === "image/webp" && !b.type.includes("webp")) {
                toast.warning("当前系统 webview 不支持 WebP 编码，已回退为 PNG");
              }
              resolve(b);
            } else reject(new Error("canvas.toBlob returned null"));
          },
          outputType,
          Settings.compressImageToBlackAndWhite
            ? undefined
            : Settings.compressImageToWebp
              ? Settings.webpQuality
              : undefined,
        );
      });
      prepared = { blob, width: w, height: h };
    } finally {
      await image.close();
    }
    await this.pastePreparedImages([prepared], location);
    return true;
  }

  private async pastePreparedImages(images: PreparedImageBlob[], location: Vector) {
    const gap = 24;
    const width = images.reduce((total, image) => total + image.width, 0) + gap * (images.length - 1);
    let x = location.x - width / 2;
    const nodes = [];
    for (const image of images) {
      const result = await createImageNodeFromBlob(this.project, image.blob, {
        location: new Vector(x + image.width / 2, location.y),
        centerAtLocation: true,
        waitForReady: true,
        intrinsicSize: { width: image.width, height: image.height },
      });
      nodes.push(result.node);
      x += image.width + gap;
    }
    this.project.stageManager.clearSelectAll();
    nodes.forEach((node) => {
      node.isSelected = true;
    });
  }

  public async pasteImagesFromFileClipboard(location: Vector) {
    const paths = await readClipboardImagePaths();
    if (!paths.length) return false;
    const images: PreparedImageBlob[] = [];
    for (const path of paths) {
      const bytes = await readFile(path);
      if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("单张图片文件不能超过64MiB");
      const suffix = path.split(".").at(-1)?.toLowerCase();
      const type = suffix === "jpg" || suffix === "jpeg" ? "image/jpeg" : `image/${suffix}`;
      images.push(await prepareImageBlobForImport(new Blob([new Uint8Array(bytes)], { type })));
    }
    await this.pastePreparedImages(images, location);
    return true;
  }

  public async pasteImageFromWebClipboard(
    location = this.project.renderer.transformView2World(MouseLocation.vector()).clone(),
  ) {
    const clipboard = navigator.clipboard as any;
    if (!clipboard || typeof clipboard.read !== "function") return false;

    let items: Array<{
      types: readonly string[];
      getType: (type: string) => Promise<Blob>;
    }>;
    try {
      items = await clipboard.read();
    } catch (error) {
      throw new ClipboardImageUnavailable(error);
    }

    const preparedImages: PreparedImageBlob[] = [];
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (!imageType) continue;
      let blob: Blob;
      try {
        blob = await item.getType(imageType);
      } catch (error) {
        throw new ClipboardImageUnavailable(error);
      }
      const prepared = await prepareImageBlobForImport(blob);
      preparedImages.push(prepared);
    }
    if (!preparedImages.length) return false;
    await this.pastePreparedImages(preparedImages, location);
    return true;
  }
}
