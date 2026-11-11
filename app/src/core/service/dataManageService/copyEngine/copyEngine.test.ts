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
vi.mock("@/core/service/GlobalMenu", () => ({ onOpenFile: vi.fn() }));
vi.mock("@/core/service/dataGenerateService/generateScreenshot", () => ({ GenerateScreenshot: {} }));
vi.mock("@/core/service/dataFileService/RecentFileManager", () => ({ RecentFileManager: {} }));
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
import { MultiTargetUndirectedEdge } from "@/core/stage/stageObject/association/MutiTargetUndirectedEdge";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { GraphMethods } from "@/core/stage/stageManager/basicMethods/GraphMethods";
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
import { DeleteManager } from "@/core/stage/stageManager/concreteMethods/StageDeleteManager";
import { SearchContentHighlightRenderer } from "@/core/render/canvas2d/utilsRenderer/searchContentHighlightRenderer";
import { setHighlightProjects } from "@/core/service/dataManageService/crossFileHighlight";
import { URI } from "vscode-uri";
import { SectionInOutManager } from "@/core/stage/stageManager/concreteMethods/StageSectionInOutManager";

function fixture() {
  const p: any = {
    uri: URI.file("C:/highlight-copy-test/" + crypto.randomUUID() + ".prg"),
    stage: [],
    attachments: new Map(),
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    effects: { addEffect: vi.fn() },
    syncAssociationManager: { onStageObjectDeleted: vi.fn() },
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
  p.graphMethods = new GraphMethods(p);
  p.sectionInOutManager = new SectionInOutManager(p);
  p.deleteManager = new DeleteManager(p);
  p.copyEngine = new CopyEngine(p);
  p.searchContentHighlightRenderer = new SearchContentHighlightRenderer(p);
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
  Settings.connectedNodeHighlightLocked = false;
  Settings.connectedNodeHighlightScope = "all";
  Settings.enableCrossFileConnections = false;
  setHighlightProjects([]);
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
afterEach(() => {
  setHighlightProjects([]);
  vi.restoreAllMocks();
});

describe("PG1.3 clipboard with real nodes, edges, sections and history", () => {
  it.each([1, 3, 4])("retains surviving multi-target branches when deleting %s members", (count) => {
    const p = fixture();
    const nodes = Array.from({ length: 5 }, (_, i) => new TextNode(p, { text: `member ${i}` }));
    const rates = nodes.map((_, i) => new Vector(i / 5, i / 10));
    const relation = new MultiTargetUndirectedEdge(p, { associationList: nodes, rectRates: rates, text: "keep relation" });
    p.stage.push(...nodes, relation);
    p.stageManager.updateReferences();
    p.historyManager = new HistoryManager(p);
    nodes.slice(1, count + 1).forEach((node) => { node.isSelected = true; });
    p.stageManager.deleteSelectedStageObjects();
    expect(p.stageManager.getEntities()).toHaveLength(5 - count);
    if (count < 4) {
      expect(p.stageManager.getAssociations()).toContain(relation);
      expect(relation.associationList).toEqual(nodes.filter((_, i) => i === 0 || i > count));
      expect(relation.rectRates).toEqual(rates.filter((_, i) => i === 0 || i > count));
    } else expect(p.stageManager.getAssociations()).toHaveLength(0);
    expect(relation.text).toBe("keep relation");
    p.historyManager.undo();
    expect(p.stageManager.getAssociations()[0].associationList).toHaveLength(5);
    p.historyManager.redo();
    if (count < 4) expect(p.stageManager.getAssociations()[0].associationList).toHaveLength(5 - count);
    else expect(p.stageManager.getAssociations()).toHaveLength(0);
  });
  it("deletes one child while retaining its parent, siblings and their directed edges through undo and redo", () => {
    const p = fixture();
    const parent = new TextNode(p, { text: "parent" });
    const children = Array.from({ length: 12 }, (_, i) => new TextNode(p, { text: `child ${i}` }));
    const edges = children.map((child) => new LineEdge(p, { associationList: [parent, child] }));
    p.stage.push(parent, ...children, ...edges);
    p.stageManager.updateReferences();
    p.historyManager = new HistoryManager(p);
    children[5].isSelected = true;
    p.stageManager.deleteSelectedStageObjects();
    expect(p.stageManager.getTextNodes()).toHaveLength(12);
    expect(p.stageManager.getTextNodes()).toContain(parent);
    expect(p.stageManager.getTextNodes()).not.toContain(children[5]);
    expect(p.stageManager.getAssociations()).toEqual(edges.filter((_, i) => i !== 5));
    expect(parent.isSelected).toBe(true);
    p.historyManager.undo();
    expect(p.stageManager.getTextNodes()).toHaveLength(13);
    expect(p.stageManager.getAssociations()).toHaveLength(12);
    p.historyManager.redo();
    expect(p.stageManager.getTextNodes()).toHaveLength(12);
    expect(p.stageManager.getAssociations()).toHaveLength(11);
    const surviving = p.stageManager.getTextNodes().find((node) => node.uuid === parent.uuid);
    expect(surviving).toBeDefined();
    expect(p.stageManager.getLineEdges().every((edge) => edge.source === surviving)).toBe(true);
  });
  it("selects every locked highlighted node without copying, then supports normal Ctrl+C", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    b.isSelected = false;
    Settings.connectedNodeHighlightLocked = true;
    const before = serialize(p.stage);
    clipboard.text = "existing clipboard";
    expect(p.stageManager.selectHighlightedNodes()).toBe(2);
    expect(clipboard.text).toBe("existing clipboard");
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(p.stageManager.getSelectedEntities()).toEqual([a, b]);
    expect(serialize(p.stage)).toEqual(before);
    expect(await p.copyEngine.copy("nodes")).toBe(true);
    const target = fixture();
    target.historyManager = new HistoryManager(target);
    await target.copyEngine.paste();
    expect(target.stageManager.getTextNodes().map((node) => node.text)).toEqual([a.text, b.text]);
    expect(target.stageManager.getAssociations()).toHaveLength(1);
    expectPoint(bounds(target.stageManager.getEntities()).center, target.renderer.transformView2World(MouseLocation.vector()));
  });
  it("copies highlighted text through the current highlight rule without selecting neighbours", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    b.isSelected = false;
    Settings.connectedNodeHighlightLocked = true;
    expect(await p.copyEngine.copyHighlightedText()).toBe(true);
    expect(clipboard.text).toBe(a.text + "\n\n" + b.text);
    expect(p.stageManager.getSelectedEntities()).toEqual([a]);
  });
  it("does not alter the clipboard when highlight lock is disabled", async () => {
    const p = fixture();
    addTree(p);
    clipboard.text = "existing clipboard";
    expect(p.stageManager.selectHighlightedNodes()).toBe(0);
    expect(await p.copyEngine.copyHighlightedText()).toBe(false);
    expect(clipboard.text).toBe("existing clipboard");
    expect(clipboard.write).not.toHaveBeenCalled();
  });
  it("copies only the current file when locked highlights extend into another file", async () => {
    const source = fixture(), other = fixture();
    const { a, b } = addTree(source);
    const foreign = addTree(other);
    b.isSelected = foreign.a.isSelected = foreign.b.isSelected = false;
    a.crossFileLinks = [{
      id: crypto.randomUUID(), targetFile: other.uri.toString(), targetNode: foreign.a.uuid,
    }];
    Settings.connectedNodeHighlightLocked = true;
    Settings.enableCrossFileConnections = true;
    setHighlightProjects([source, other]);
    expect(other.searchContentHighlightRenderer.getConnectedHighlightedNodes()).toHaveLength(2);
    expect(source.stageManager.selectHighlightedNodes()).toBe(2);
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(other.stageManager.getSelectedEntities()).toHaveLength(0);
    expect(await source.copyEngine.copyHighlightedText()).toBe(true);
    expect(clipboard.text).toBe(a.text + "\n\n" + b.text);
    expect(await source.copyEngine.copy("nodes")).toBe(true);
    expect(decodeClipboardPayload(clipboard.text)?.stageObjects).toHaveLength(3);
    expect(other.stageManager.getEntities()).toHaveLength(2);
    expect(source.stageManager.getSelectedEntities()).toEqual([a, b]);
  });
  it.each([false, true])("cuts and pastes at the cursor with undo, cross-document=%s", async (crossDocument) => {
    const source = fixture();
    addTree(source);
    const original = serialize(source.stage);
    await source.copyEngine.cut();
    expect(source.stage).toHaveLength(0);
    const target = crossDocument ? fixture() : source;
    if (crossDocument) target.historyManager = new HistoryManager(target);
    await target.copyEngine.paste();
    expect(target.stageManager.getTextNodes()).toHaveLength(2);
    expect(target.stageManager.getAssociations()).toHaveLength(1);
    expectPoint(
      bounds(target.stageManager.getEntities()).center,
      target.renderer.transformView2World(MouseLocation.vector()),
    );
    target.historyManager.undo();
    expect(target.stage).toHaveLength(0);
    source.historyManager.undo();
    expect(serialize(source.stage)).toEqual(original);
  });

  it("keeps original nodes when writing the clipboard fails", async () => {
    const p = fixture();
    addTree(p);
    const before = serialize(p.stage);
    clipboard.write.mockRejectedValueOnce(new Error("clipboard unavailable"));
    await p.copyEngine.cut();
    expect(serialize(p.stage)).toEqual(before);
  });

  it("cuts an expanded container together with its children and restores it in one undo", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    const group = Section.fromEntities(p, [a, b]);
    p.stage.push(group);
    p.stageManager.updateReferences();
    p.stageManager.clearSelectAll();
    group.isSelected = true;
    p.historyManager = new HistoryManager(p);
    const before = serialize(p.stage);
    await p.copyEngine.cut();
    expect(p.stage).toHaveLength(0);
    p.historyManager.undo();
    expect(serialize(p.stage)).toEqual(before);
  });

  it("preserves edits made while the clipboard write is pending", async () => {
    const p = fixture();
    const { a } = addTree(p);
    let finish!: () => void;
    clipboard.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const cutting = p.copyEngine.cut();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    a.text = "等待期间的新内容";
    finish();
    await cutting;
    expect(p.stage).toContain(a);
    expect(a.text).toBe("等待期间的新内容");
  });

  it("does not delete a later selection while clipboard writing is pending", async () => {
    const p = fixture();
    const { a, b } = addTree(p);
    let finish!: () => void;
    clipboard.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const cutting = p.copyEngine.cut();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    a.isSelected = b.isSelected = false;
    const extra = new TextNode(p, { text: "保留" });
    p.stage.push(extra);
    extra.isSelected = true;
    finish();
    await cutting;
    expect(p.stage).toContain(extra);
    expect(p.stage).not.toContain(a);
    expect(p.stage).not.toContain(b);
  });

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

  it.each([false, true])(
    "loads attachments before centering and preserves free image dimensions (%s)",
    async (stretched) => {
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
        if (stretched) image.resizeHandle(new Vector(40, 40));
        source.stage.push(image);
        image.isSelected = true;
        target.historyManager = new HistoryManager(target);
        await source.copyEngine.copy("nodes");
        await target.copyEngine.paste();
        const copy = target.stage[0] as ImageNode;
        expect(copy.state).toBe("success");
        expect(copy.scale).toBe(stretched ? 2.5 : 2);
        expect(copy.attachmentId).not.toBe(id);
        expect(new Uint8Array(await target.attachments.get(copy.attachmentId)!.arrayBuffer())).toEqual(
          new Uint8Array(await blob.arrayBuffer()),
        );
        expectPoint(copy.rectangle.center, new Vector(-4600, 3300));
        expect(copy.rectangle.size).toEqual(stretched ? new Vector(200, 120) : new Vector(160, 80));
        await image.dispose();
        await copy.dispose();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
