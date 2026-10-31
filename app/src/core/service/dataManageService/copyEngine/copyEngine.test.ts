import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clipboard = vi.hoisted(() => ({ text: "", choose: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.hoisted(() =>
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ font: "", measureText: (text: string) => ({ width: [...text].length * 32 }) }),
    }),
  }),
);
vi.mock("@/core/Project", () => ({
  Project: class {},
  ProjectState: { Saved: "saved", Unsaved: "unsaved" },
  service: () => (target: unknown) => target,
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    clipboardPasteMode: "tauri",
    textNodeMaxCharWidth: 15,
    textNodePasteSizeAdjustMode: "auto",
    defaultFontFamily: "sans-serif",
    historyManagerMode: "memoryEfficient",
    historySize: 100,
    watch: () => () => {},
  },
}));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: {} }));
vi.mock("@/utils/platform", () => ({ isMac: false }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({
  DetailsManager: class {
    static markdownToDetails(text: string) {
      return [{ type: "p", children: [{ text }] }];
    }
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: clipboard.read, writeText: clipboard.write }));
vi.mock("./CopyModeDialog", () => ({ chooseCopyMode: clipboard.choose }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));

import type { Project } from "@/core/Project";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { serialize, deserialize } from "@graphif/serializer";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { getMultiLineTextSize } from "@/utils/font";
import { CopyEngine } from "./copyEngine";
import { decodeClipboardPayload, encodeClipboardPayload } from "./ClipboardPayload";
import { toast } from "sonner";
import { ClipboardImageUnavailable, CopyEngineImage } from "./copyEngineImage";
import { Settings } from "@/core/service/Settings";
import { CopyEngineUtils } from "./copyEngineUtils";

function fixture() {
  const p: any = {
    stage: [],
    attachments: new Map(),
    emit: vi.fn(),
    effects: { addEffect: vi.fn() },
    renderer: { transformView2World: (v: Vector) => v.multiply(2).add(new Vector(-5000, 3000)) },
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
    controller: { pressingKeySet: new Set(), resetCountdownTimer: vi.fn() },
    loop: vi.fn(),
    addAttachment(blob: Blob) {
      const id = crypto.randomUUID();
      this.attachments.set(id, blob);
      return id;
    },
  };
  p.stageManager = new StageManager(p);
  p.sectionMethods = new SectionMethods(p);
  p.copyEngine = new CopyEngine(p);
  return p as Project;
}
function addTree(p: Project) {
  const a = new TextNode(p, {
    text: "根节点",
    collisionBox: new CollisionBox([new Rectangle(new Vector(-12000, 5000), new Vector(100, 60))]),
  });
  const b = new TextNode(p, {
    text: "多行文本".repeat(20),
    collisionBox: new CollisionBox([new Rectangle(new Vector(-11000, 5300), new Vector(100, 60))]),
  });
  const edge = new LineEdge(p, { associationList: [a, b], text: "关联" });
  p.stage.push(a, b, edge);
  a.isSelected = b.isSelected = true;
  p.stageManager.updateReferences();
  p.historyManager = new HistoryManager(p);
  return { a, b, edge };
}
function bounds(entities: Entity[]) {
  return Rectangle.getBoundingRectangle(entities.map((n) => n.collisionBox.getRectangle()));
}
function expectPoint(actual: Vector, expected: Vector) {
  expect(actual.x).toBeCloseTo(expected.x, 2);
  expect(actual.y).toBeCloseTo(expected.y, 2);
}

beforeEach(() => {
  vi.spyOn(CopyEngineImage.prototype, "pasteImagesFromFileClipboard").mockResolvedValue(false);
  Settings.clipboardPasteMode = "tauri";
  clipboard.text = "";
  clipboard.read.mockReset().mockImplementation(async () => clipboard.text);
  clipboard.write.mockReset().mockImplementation(async (text: string) => {
    clipboard.text = text;
  });
  clipboard.choose.mockReset().mockResolvedValue("nodes");
  vi.mocked(toast.error).mockClear();
  MouseLocation.x = 200;
  MouseLocation.y = 150;
});
afterEach(() => vi.restoreAllMocks());

describe("PG1.3 clipboard with real nodes, edges, sections and history", () => {
  it("copies each explicit mode without opening the chooser", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    await p.copyEngine.copy("nodes");
    expect(decodeClipboardPayload(clipboard.text)?.stageObjects).toHaveLength(3);
    await p.copyEngine.copy("text");
    expect(clipboard.text).toBe(a.text + "\n\n" + b.text);
    expect(clipboard.choose).not.toHaveBeenCalled();
  });

  it("does not let a slow node preparation overwrite a later text copy", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    let finish!: (value: Awaited<ReturnType<typeof CopyEngineUtils.collectAttachmentFromStageObjects>>) => void;
    vi.spyOn(CopyEngineUtils, "collectAttachmentFromStageObjects").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const nodes = p.copyEngine.copy("nodes");
    const text = p.copyEngine.copy("text");
    expect(await text).toBe(true);
    const expected = a.text + "\n\n" + b.text;
    expect(clipboard.text).toBe(expected);
    finish(new Map());
    expect(await nodes).toBe(false);
    expect(clipboard.text).toBe(expected);
  });

  it("orders native writes when a second copy arrives during the first write", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    let release!: () => void;
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    clipboard.write.mockImplementationOnce(async (value: string) => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      clipboard.text = value;
    });
    const nodes = p.copyEngine.copy("nodes");
    await writing;
    const text = p.copyEngine.copy("text");
    await Promise.resolve();
    expect(clipboard.write).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([nodes, text]);
    expect(clipboard.text).toBe(a.text + "\n\n" + b.text);
  });

  it("waits for an unfinished copy before pasting into another project", async () => {
    const source = fixture();
    addTree(source);
    const target = fixture();
    target.historyManager = new HistoryManager(target);
    let finish!: (value: Awaited<ReturnType<typeof CopyEngineUtils.collectAttachmentFromStageObjects>>) => void;
    vi.spyOn(CopyEngineUtils, "collectAttachmentFromStageObjects").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    clipboard.text = "old clipboard text";
    const copying = source.copyEngine.copy("nodes");
    const pasting = target.copyEngine.paste();
    await Promise.resolve();
    expect(clipboard.read).not.toHaveBeenCalled();
    finish(new Map());
    await Promise.all([copying, pasting]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(target.stage.filter((item) => item instanceof TextNode)).toHaveLength(2);
    expect(target.stage.filter((item) => item instanceof LineEdge)).toHaveLength(1);
  });

  it("allows a subsequent copy and paste after a clipboard write fails", async () => {
    const p = fixture();
    addTree(p);
    clipboard.write.mockRejectedValueOnce(new Error("clipboard is busy"));
    expect(await p.copyEngine.copy("nodes")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("clipboard is busy"));
    expect(await p.copyEngine.copy("nodes")).toBe(true);
    await p.copyEngine.paste();
    expect(p.stage).toHaveLength(6);
  });

  it("routes Explorer image file lists ahead of metadata and bitmap readers", async () => {
    const p = fixture();
    addTree(p);
    clipboard.text = "C:\\Pictures\\test.png";
    vi.mocked(CopyEngineImage.prototype.pasteImagesFromFileClipboard).mockResolvedValue(true);
    const native = vi.spyOn(CopyEngineImage.prototype, "pasteImageFromTauriClipboard").mockResolvedValue(true);
    const record = vi.spyOn(p.historyManager, "recordStep");
    await p.copyEngine.paste();
    expect(CopyEngineImage.prototype.pasteImagesFromFileClipboard).toHaveBeenCalledWith(new Vector(-4600, 3300));
    expect(native).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(p.stage).toHaveLength(3);
    expect(p.controller.resetCountdownTimer).toHaveBeenCalledOnce();
    expect(p.loop).toHaveBeenCalledOnce();
  });

  it("reports an unreadable image file without falling back to filename text", async () => {
    const p = fixture();
    addTree(p);
    clipboard.text = "C:\\Pictures\\missing.png";
    vi.mocked(CopyEngineImage.prototype.pasteImagesFromFileClipboard).mockRejectedValue(new Error("图片文件已删除"));
    const record = vi.spyOn(p.historyManager, "recordStep");
    await p.copyEngine.paste();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("图片文件已删除"));
    expect(record).not.toHaveBeenCalled();
    expect(p.stage).toHaveLength(3);
  });
  it("prioritizes screenshot pixels over accompanying text metadata", async () => {
    const p = fixture();
    addTree(p);
    clipboard.text = "Snipaste screenshot metadata";
    const native = vi.spyOn(CopyEngineImage.prototype, "pasteImageFromTauriClipboard").mockResolvedValue(true);
    const web = vi.spyOn(CopyEngineImage.prototype, "pasteImageFromWebClipboard").mockResolvedValue(false);
    const record = vi.spyOn(p.historyManager, "recordStep");
    await p.copyEngine.paste();
    expect(native).toHaveBeenCalledWith(new Vector(-4600, 3300));
    expect(web).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(p.stage).toHaveLength(3);
  });

  it("uses the web image reader when native clipboard format is unavailable", async () => {
    const p = fixture();
    addTree(p);
    vi.spyOn(CopyEngineImage.prototype, "pasteImageFromTauriClipboard").mockRejectedValue(
      new ClipboardImageUnavailable("unsupported format"),
    );
    const web = vi.spyOn(CopyEngineImage.prototype, "pasteImageFromWebClipboard").mockResolvedValue(true);
    clipboard.read.mockRejectedValueOnce(new Error("no text format"));
    await p.copyEngine.paste();
    expect(web).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falls back to the Windows reader if configured web clipboard permission is denied", async () => {
    const p = fixture();
    addTree(p);
    Settings.clipboardPasteMode = "webview";
    const web = vi
      .spyOn(CopyEngineImage.prototype, "pasteImageFromWebClipboard")
      .mockRejectedValue(new ClipboardImageUnavailable("permission denied"));
    const native = vi.spyOn(CopyEngineImage.prototype, "pasteImageFromTauriClipboard").mockResolvedValue(true);
    await p.copyEngine.paste();
    expect(web).toHaveBeenCalledOnce();
    expect(native).toHaveBeenCalledOnce();
    expect(Settings.clipboardPasteMode).toBe("webview");
  });

  it("reports damaged image data without pasting metadata or recording a false success", async () => {
    const p = fixture();
    addTree(p);
    clipboard.text = "image source text";
    vi.spyOn(CopyEngineImage.prototype, "pasteImageFromTauriClipboard").mockRejectedValue(new Error("incomplete RGBA"));
    const web = vi.spyOn(CopyEngineImage.prototype, "pasteImageFromWebClipboard").mockResolvedValue(false);
    const record = vi.spyOn(p.historyManager, "recordStep");
    await p.copyEngine.paste();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("incomplete RGBA"));
    expect(web).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(p.stage).toHaveLength(3);
  });

  it("keeps node payloads ahead of image formats and stale screenshot data", async () => {
    const p = fixture();
    addTree(p);
    await p.copyEngine.copy("nodes");
    const native = vi.spyOn(CopyEngineImage.prototype, "pasteImageFromTauriClipboard").mockResolvedValue(true);
    await p.copyEngine.paste();
    expect(native).not.toHaveBeenCalled();
    expect(p.stage).toHaveLength(6);
  });

  it("reports an empty clipboard without creating history", async () => {
    const p = fixture();
    addTree(p);
    vi.spyOn(CopyEngineImage.prototype, "pasteImageFromTauriClipboard").mockRejectedValue(
      new ClipboardImageUnavailable("empty"),
    );
    vi.spyOn(CopyEngineImage.prototype, "pasteImageFromWebClipboard").mockResolvedValue(false);
    const record = vi.spyOn(p.historyManager, "recordStep");
    await p.copyEngine.paste();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Snipaste"));
    expect(record).not.toHaveBeenCalled();
    expect(p.stage).toHaveLength(3);
  });
  it("offers both copy modes and keeps the original selection", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    expect(await p.copyEngine.copy()).toBe(true);
    expect(clipboard.choose).toHaveBeenCalledOnce();
    expect(decodeClipboardPayload(clipboard.text)?.stageObjects).toHaveLength(3);
    expect(a.isSelected && b.isSelected).toBe(true);
    clipboard.choose.mockResolvedValue("text");
    await p.copyEngine.copy();
    expect(clipboard.text).toBe(a.text + "\n\n" + b.text);
  });

  it.each([false, true])("centers at the cursor and preserves links for cross-document=%s", async (crossDocument) => {
    const source = fixture();
    const { a, b } = addTree(source);
    const before = serialize(source.stage);
    await source.copyEngine.copy("nodes");
    const target = crossDocument ? fixture() : source;
    if (crossDocument) target.historyManager = new HistoryManager(target);
    const start = target.stage.length;
    await target.copyEngine.paste();
    const pasted = target.stage.slice(start);
    const nodes = pasted.filter((n): n is Entity => n instanceof Entity);
    expectPoint(bounds(nodes).center, new Vector(-4600, 3300));
    expect(nodes.map((n) => n.uuid)).not.toContain(a.uuid);
    const edge = pasted.find((n) => n instanceof LineEdge) as LineEdge;
    expect(nodes).toContain(edge.source);
    expect(nodes).toContain(edge.target);
    expectPoint(
      nodes[1].collisionBox.getRectangle().location.subtract(nodes[0].collisionBox.getRectangle().location),
      b.rectangle.location.subtract(a.rectangle.location),
    );
    expect(serialize(source.stage.slice(0, 3))).toEqual(before);
    const saved = serialize(target.stage);
    target.historyManager.undo();
    expect(target.stage).toHaveLength(start);
    target.historyManager.redo();
    expect(serialize(target.stage)).toEqual(saved);
    expect(serialize(deserialize(structuredClone(saved), target))).toEqual(saved);
  });

  it("repeats node paste with new ids at each new cursor, then obeys external text copy", async () => {
    const p = fixture();
    addTree(p);
    await p.copyEngine.copy("nodes");
    await p.copyEngine.paste();
    const ids = new Set(p.stage.map((n) => n.uuid));
    MouseLocation.x = 800;
    await p.copyEngine.paste();
    expectPoint(
      bounds(p.stage.slice(6).filter((n): n is Entity => n instanceof Entity)).center,
      new Vector(-3400, 3300),
    );
    expect(p.stage.slice(6).every((n) => !ids.has(n.uuid))).toBe(true);
    clipboard.text = "外部复制的文本";
    await p.copyEngine.paste();
    expect(p.stage).toHaveLength(10);
    expect((p.stage.at(-1) as TextNode).text).toBe(clipboard.text);
    expectPoint(p.stage.at(-1)!.collisionBox.getRectangle().center, new Vector(-3400, 3300));
  });

  it("captures the cursor before the asynchronous clipboard read", async () => {
    const p = fixture();
    addTree(p);
    await p.copyEngine.copy("nodes");
    let finish!: (text: string) => void;
    clipboard.read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const task = p.copyEngine.paste();
    MouseLocation.x = 999;
    finish(clipboard.text);
    await task;
    expectPoint(
      bounds(p.stage.slice(3).filter((n): n is Entity => n instanceof Entity)).center,
      new Vector(-4600, 3300),
    );
  });

  it.each([false, true])("preserves nested sections without double movement, locked=%s", async (locked) => {
    const p = fixture();
    const { a, b } = addTree(p);
    const inner = Section.fromEntities(p, [a]);
    const outer = Section.fromEntities(p, [inner, b]);
    outer.locked = locked;
    p.stage.push(inner, outer);
    p.stageManager.updateReferences();
    p.stageManager.clearSelectAll();
    outer.isSelected = true;
    const previous = serialize(p.stage);
    const difference = b.rectangle.location.subtract(a.rectangle.location);
    await p.copyEngine.copy("nodes");
    await p.copyEngine.paste();
    const copied = p.stage.slice(5);
    expect(copied).toHaveLength(5);
    expectPoint(bounds(copied.filter((n): n is Entity => n instanceof Entity)).center, new Vector(-4600, 3300));
    const nodes = copied.filter((n): n is TextNode => n instanceof TextNode);
    expectPoint(nodes[1].rectangle.location.subtract(nodes[0].rectangle.location), difference);
    const sections = copied.filter((n): n is Section => n instanceof Section);
    expect(sections.some((s) => s.children.includes(nodes[0]))).toBe(true);
    expect(serialize(p.stage.slice(0, 5))).toEqual(previous);
  });

  it("cancels and reports write/malformed payload failures without changing the canvas", async () => {
    const p = fixture();
    addTree(p);
    const before = serialize(p.stage);
    clipboard.text = "keep";
    clipboard.choose.mockResolvedValue(undefined);
    expect(await p.copyEngine.copy()).toBe(false);
    expect(clipboard.text).toBe("keep");
    clipboard.write.mockRejectedValueOnce(new Error("denied"));
    expect(await p.copyEngine.copy("nodes")).toBe(false);
    clipboard.text = "ProjectGraphClipboard/1\n{";
    await p.copyEngine.paste();
    expect(serialize(p.stage)).toEqual(before);
    expect(toast.error).toHaveBeenCalled();
  });

  it("round trips binary attachment payloads without dropping bytes", () => {
    const data = new Uint8Array([0, 255, 10, 34, 99]);
    const encoded = encodeClipboardPayload([], new Map([["image", { data: data.buffer, type: "image/png" }]]));
    const attachment = decodeClipboardPayload(encoded)!.attachments.image;
    expect(Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0))).toEqual(data);
  });

  it("centers a collapsed group by its visible frame and retains hidden descendants", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    const section = Section.fromEntities(p, [a, b]);
    section.isCollapsed = true;
    section.locked = true;
    p.stage.push(section);
    p.stageManager.updateReferences();
    p.stageManager.clearSelectAll();
    section.isSelected = true;
    await p.copyEngine.copy("nodes");
    await p.copyEngine.paste();
    const copy = p.stage.slice(4).find((n): n is Section => n instanceof Section)!;
    expect(copy.children).toHaveLength(2);
    expect(copy.isCollapsed && copy.locked).toBe(true);
    expectPoint(copy.collisionBox.getRectangle().center, new Vector(-4600, 3300));
  });

  it("loads attachments in the destination before image construction and centering", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 80, height: 40, close: vi.fn() })),
    );
    try {
      const source = fixture();
      const target = fixture();
      const blob = new Blob([new Uint8Array([1, 2, 3, 255])], { type: "image/png" });
      const id = source.addAttachment(blob);
      const image = new ImageNode(source, { attachmentId: id, scale: 2 });
      await image.waitForClipboardBitmap();
      source.stage.push(image);
      image.isSelected = true;
      target.historyManager = new HistoryManager(target);
      await source.copyEngine.copy("nodes");
      await target.copyEngine.paste();
      const copy = target.stage[0] as ImageNode;
      expect(copy.state).toBe("success");
      expect(copy.scale).toBe(2);
      expect(copy.attachmentId).not.toBe(id);
      expect(new Uint8Array(await target.attachments.get(copy.attachmentId)!.arrayBuffer())).toEqual(
        new Uint8Array(await blob.arrayBuffer()),
      );
      expectPoint(copy.rectangle.center, new Vector(-4600, 3300));
      expect(copy.rectangle.size).toEqual(new Vector(160, 80));
      await image.dispose();
      await copy.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
