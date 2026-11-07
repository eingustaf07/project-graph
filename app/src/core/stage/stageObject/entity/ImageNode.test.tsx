// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/Project", () => ({ Project: class Project {}, service: () => (target: unknown) => target }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({
  ConnectableEntity: class ConnectableEntity {
    details = [];
    parentSection = null;
    updateFatherSectionByMove() {}
  },
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    compressImageToBlackAndWhite: false,
    compressImageToWebp: false,
    maxPastedImageSize: 1024,
    resizePastedImages: false,
    webpQuality: 0.8,
  },
}));
vi.mock("@/core/service/dataManageService/imageUtils", () => ({ applyBlackAndWhite: vi.fn() }));

import { ImageNode } from "./ImageNode";
import { Vector } from "@graphif/data-structures";
import { serialize, deserialize } from "@graphif/serializer";
import { ControllerEntityResizeClass } from "@/core/service/controlService/controller/concrete/ControllerEntityResize";
import { ImageRenderer } from "@/core/render/canvas2d/basicRenderer/ImageRenderer";

vi.mock("./TextNode", () => ({ TextNode: class {} }));
vi.mock("./SvgNode", () => ({ SvgNode: class {} }));
vi.mock("./ReferenceBlockNode", () => ({ ReferenceBlockNode: class {} }));
vi.mock("@/core/render/canvas2d/eraserMask", () => ({
  paintWithErasures: (project: any, _entity: any, paint: any) => paint(project.canvas.ctx),
}));

describe("ImageNode cleanup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for an in-flight bitmap and closes it when disposal has started", async () => {
    let resolveBitmap: ((bitmap: ImageBitmap) => void) | undefined;
    const bitmap = { close: vi.fn(), width: 20, height: 10 } as unknown as ImageBitmap;
    const createBitmap = vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          resolveBitmap = resolve;
        }),
    );
    vi.stubGlobal("createImageBitmap", createBitmap);
    const project = {
      addAttachment: vi.fn(),
      attachments: new Map([["image", new Blob(["image"])]]),
    };
    const node = new ImageNode(project as never, { attachmentId: "image" });
    const dispose = (node as unknown as { dispose?: () => Promise<void> }).dispose;

    expect(dispose).toBeTypeOf("function");
    const disposal = dispose!.call(node);
    resolveBitmap?.(bitmap);
    await disposal;

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(node.bitmap).toBeUndefined();
  });

  it("reports bitmap loading failure to the DOM and preserves it for cleanup", async () => {
    const failure = new Error("bitmap decode failed");
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => Promise.reject(failure)),
    );
    const project = {
      addAttachment: vi.fn(),
      attachments: new Map([["image", new Blob(["image"])]]),
    };
    const onError = vi.fn((event: ErrorEvent) => event.preventDefault());
    window.addEventListener("error", onError);
    const node = new ImageNode(project as never, { attachmentId: "image" });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].error).toBe(failure);
    await expect(node.dispose()).rejects.toEqual(
      expect.objectContaining({ errors: [failure], message: "ImageNode cleanup failed" }),
    );

    window.removeEventListener("error", onError);
  });
});

describe("independent image dimensions", () => {
  async function fixture(options = {}) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 200, height: 100, close: vi.fn() })),
    );
    const project: any = {
      attachments: new Map([["image", new Blob(["image"])]]),
      camera: { currentScale: 2 },
      canvas: { element: document.createElement("canvas"), ctx: { drawImage: vi.fn() } },
      historyManager: { recordStep: vi.fn() },
      renderer: { transformView2World: (p: Vector) => p.divide(2) },
    };
    const node = new ImageNode(project, { attachmentId: "image", ...options });
    await node.waitForClipboardBitmap();
    project.stageManager = { getSelectedEntities: () => [node] };
    return { project, node };
  }

  it("loads legacy images at their original aspect ratio and independently changes both dimensions", async () => {
    const { node } = await fixture({ scale: 2 });
    expect(node.rectangle.size).toEqual(new Vector(400, 200));
    node.resizeHandle(new Vector(80, 0));
    expect(node.rectangle.size).toEqual(new Vector(480, 200));
    node.resizeHandle(new Vector(0, 50));
    expect(node.rectangle.size).toEqual(new Vector(480, 250));
    const ratio = node.rectangle.width / node.rectangle.height;
    node.scaleUpdate(0.1);
    expect(node.rectangle.width / node.rectangle.height).toBeCloseTo(ratio);
  });

  it("keeps the opposite side anchored when resizing from the left and top", async () => {
    const { node } = await fixture();
    node.moveTo(new Vector(30, 40));
    const before = node.rectangle.clone();
    node.resizeHandle(new Vector(-60, -20), new Vector(-1, -1));
    expect(node.rectangle.right).toBe(before.right);
    expect(node.rectangle.bottom).toBe(before.bottom);
    expect(node.rectangle.size).toEqual(new Vector(260, 120));
    node.resizeHandle(new Vector(1e6, 1e6), new Vector(-1, -1));
    expect(node.rectangle.size).toEqual(new Vector(20, 10));
    expect(node.rectangle.right).toBe(before.right);
    expect(node.rectangle.bottom).toBe(before.bottom);
  });

  it("preserves stretched geometry through serialization and asynchronous image decoding", async () => {
    const { project, node } = await fixture();
    node.resizeHandle(new Vector(80, 120));
    node.moveTo(new Vector(123, 456));
    const saved = serialize(node);
    const restored = deserialize(structuredClone(saved), project) as ImageNode;
    await restored.waitForClipboardBitmap();
    expect(restored.rectangle).toEqual(node.rectangle);
    expect(restored.heightScale).toBe(node.heightScale);
    expect(restored.scale).toBe(node.scale);
  });

  it("draws the independently stretched display rectangle", async () => {
    const { project, node } = await fixture();
    node.resizeHandle(new Vector(80, 120));
    const renderer = new ImageRenderer(project);
    renderer.renderImageElement(node.bitmap!, new Vector(20, 30), node.scale, node, node.rectangle.size);
    expect(project.canvas.ctx.drawImage).toHaveBeenCalledWith(node.bitmap, 20, 30, 560, 440);
  });

  it.each([
    [1, 0, 250, 100],
    [0, 1, 200, 140],
    [1, 1, 250, 140],
  ])("routes handle (%s,%s) through the controller and records one completed drag", async (x, y, width, height) => {
    const { project, node } = await fixture();
    const controller = new ControllerEntityResizeClass(project);
    try {
      const handle = node.getResizeHandles().find((h) => h.direction.x === x && h.direction.y === y)!;
      const point = handle.rectangle.center.multiply(2);
      controller.mousedown(new MouseEvent("mousedown", { button: 0, clientX: point.x, clientY: point.y }));
      controller.mousemove(new MouseEvent("mousemove", { clientX: point.x + 100, clientY: point.y + 80 }));
      expect(node.rectangle.size).toEqual(new Vector(width, height));
      expect(project.historyManager.recordStep).not.toHaveBeenCalled();
      controller.mouseup(new MouseEvent("mouseup", { button: 0 }));
      expect(project.historyManager.recordStep).toHaveBeenCalledTimes(1);
    } finally {
      controller.dispose();
    }
  });
});
