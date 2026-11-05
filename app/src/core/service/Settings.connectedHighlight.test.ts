import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ values: new Map<string, unknown>(), writtenKeys: [] as string[] }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: { confirm: vi.fn() } }));
vi.mock("@/utils/platform", () => ({ isMac: false }));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async init() {}
    async entries() {
      return [...storage.values.entries()];
    }
    async set(key: string, value: unknown) {
      storage.values.set(key, value);
      storage.writtenKeys.push(key);
    }
    async save() {}
  },
}));

describe("connected highlight setting compatibility and persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    storage.values.clear();
    storage.writtenKeys = [];
    storage.values.set("mouseRightDragBackground", "moveCamera");
    storage.values.set("textNodeMaxCharWidth", 22);
    storage.values.set("aiConnectionMode", "chatgpt");
  });
  it("defaults old profiles to original sound volume and saves only volume across reloads", async () => {
    const { Settings, settingsSchema } = await import("./Settings");
    expect(Settings.soundVolume).toBe(100);
    for (const value of [-1, 101, 12.5, NaN]) {
      expect(settingsSchema.shape.soundVolume.safeParse(value).success).toBe(false);
    }
    storage.writtenKeys = [];
    Settings.soundVolume = 35;
    expect(storage.writtenKeys).toEqual(["soundVolume"]);
    vi.resetModules();
    const restored = await import("./Settings");
    expect(restored.Settings.soundVolume).toBe(35);
    expect(restored.Settings.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.Settings.textNodeMaxCharWidth).toBe(22);
    expect(restored.Settings.aiConnectionMode).toBe("chatgpt");
    restored.Settings.soundVolume = 0;
    vi.resetModules();
    expect((await import("./Settings")).Settings.soundVolume).toBe(0);
  });
  it("persists individual sound switches without rewriting other preferences", async () => {
    const { Settings } = await import("./Settings");
    expect(Settings.soundEffectEnabled).toEqual({});
    storage.writtenKeys = [];
    Settings.soundEffectEnabled = { nodeCreated: false, uiButtonClickSoundFile: false };
    expect(storage.writtenKeys).toEqual(["soundEffectEnabled"]);
    vi.resetModules();
    const restored = (await import("./Settings")).Settings;
    expect(restored.soundEffectEnabled).toEqual({ nodeCreated: false, uiButtonClickSoundFile: false });
    expect(restored.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.textNodeMaxCharWidth).toBe(22);
  });
  it("persists N-key container mode without changing other settings", async () => {
    const { Settings } = await import("./Settings");
    expect(Settings.containerNBoundary).toBe(false);
    storage.writtenKeys = [];
    Settings.containerNBoundary = true;
    expect(storage.writtenKeys).toEqual(["containerNBoundary"]);
    vi.resetModules();
    const restored = (await import("./Settings")).Settings;
    expect(restored.containerNBoundary).toBe(true);
    expect(restored.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.textNodeMaxCharWidth).toBe(22);
  });
  it("persists toolbar docking without changing existing preferences", async () => {
    const { Settings } = await import("./Settings");
    expect(Settings.drawingToolbarPosition).toBe("bottom");
    expect(Settings.enableCrossFileConnections).toBe(false);
    storage.writtenKeys = [];
    Settings.drawingToolbarPosition = "left";
    expect(storage.writtenKeys).toEqual(["drawingToolbarPosition"]);
    vi.resetModules();
    const restored = await import("./Settings");
    expect(restored.Settings.drawingToolbarPosition).toBe("left");
    expect(restored.Settings.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.Settings.aiConnectionMode).toBe("chatgpt");
  });
  it("keeps zoomed-out labels visible by default without overwriting the old text threshold", async () => {
    storage.values.set("ignoreTextNodeTextRenderLessThanFontSize", 8);
    const { Settings } = await import("./Settings");
    expect(Settings.alwaysRenderNodeText).toBe(true);
    expect(Settings.ignoreTextNodeTextRenderLessThanFontSize).toBe(8);
    storage.writtenKeys = [];
    Settings.alwaysRenderNodeText = false;
    expect(storage.writtenKeys).toEqual(["alwaysRenderNodeText"]);
    vi.resetModules();
    const restored = await import("./Settings");
    expect(restored.Settings.alwaysRenderNodeText).toBe(false);
    expect(restored.Settings.ignoreTextNodeTextRenderLessThanFontSize).toBe(8);
    expect(restored.Settings.mouseRightDragBackground).toBe("moveCamera");
  });
  it("keeps old values and defaults missing range settings to the existing all-connected behavior", async () => {
    const { Settings } = await import("./Settings");
    expect(Settings.connectedNodeHighlightScope).toBe("all");
    expect(Settings.mouseRightDragBackground).toBe("moveCamera");
    expect(Settings.textNodeMaxCharWidth).toBe(22);
    expect(Settings.aiConnectionMode).toBe("chatgpt");
    expect(Settings.enableSmartTreeArrange).toBe(false);
    expect(Settings.smartTreeArrangeMode).toBe("preserve");
    expect(Settings.smartTreeArrangeDirection).toBe("right");
    expect([Settings.smartTreeLevelGap, Settings.smartTreeNodeGap, Settings.smartTreeSubtreeGap]).toEqual([64, 24, 40]);
  });
  it("saves experimental layout options without rewriting existing settings", async () => {
    const { Settings } = await import("./Settings");
    storage.writtenKeys = [];
    Settings.enableSmartTreeArrange = true;
    Settings.smartTreeArrangeMode = "standard";
    Settings.smartTreeArrangeDirection = "left";
    Settings.smartTreeLevelGap = 80;
    expect(storage.writtenKeys).toEqual([
      "enableSmartTreeArrange",
      "smartTreeArrangeMode",
      "smartTreeArrangeDirection",
      "smartTreeLevelGap",
    ]);
    vi.resetModules();
    const restored = await import("./Settings");
    expect(restored.Settings.smartTreeArrangeDirection).toBe("left");
    expect(restored.Settings.smartTreeLevelGap).toBe(80);
    expect(restored.Settings.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.Settings.textNodeMaxCharWidth).toBe(22);
    expect(restored.Settings.aiConnectionMode).toBe("chatgpt");
  });
  it("persists container expansion without changing existing preferences", async () => {
    const { Settings } = await import("./Settings");
    expect(Settings.containerAutoExpand).toBe(false);
    storage.writtenKeys = [];
    Settings.containerAutoExpand = true;
    expect(storage.writtenKeys).toEqual(["containerAutoExpand"]);
    vi.resetModules();
    const restored = await import("./Settings");
    expect(restored.Settings.containerAutoExpand).toBe(true);
    expect(restored.Settings.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.Settings.textNodeMaxCharWidth).toBe(22);
  });
  it("persists only the changed setting through the normal settings proxy and restores it after reload", async () => {
    const { Settings } = await import("./Settings");
    storage.writtenKeys = [];
    Settings.connectedNodeHighlightScope = "direct";
    expect(storage.writtenKeys).toEqual(["connectedNodeHighlightScope"]);
    vi.resetModules();
    const restored = await import("./Settings");
    expect(restored.Settings.connectedNodeHighlightScope).toBe("direct");
    expect(restored.Settings.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.Settings.textNodeMaxCharWidth).toBe(22);
  });
  it("defaults to freehand and saves only requested pen options without rewriting existing settings", async () => {
    const { Settings } = await import("./Settings");
    expect(Settings.penStrokeStraightLine).toBe(false);
    expect(Settings.penStrokeLineWidth).toBe(5);
    expect(Settings.penStrokeEraser).toBe(false);
    expect(Settings.penStrokeEraserSize).toBe(32);
    storage.writtenKeys = [];
    Settings.penStrokeStraightLine = true;
    Settings.penStrokeLineWidth = 9;
    Settings.autoFillPenStrokeColor = [220, 30, 80, 0.6];
    Settings.penStrokeEraser = true;
    Settings.penStrokeEraserSize = 80;
    expect(storage.writtenKeys).toEqual([
      "penStrokeStraightLine",
      "penStrokeLineWidth",
      "autoFillPenStrokeColor",
      "penStrokeEraser",
      "penStrokeEraserSize",
    ]);
    vi.resetModules();
    const restored = await import("./Settings");
    expect(restored.Settings.penStrokeStraightLine).toBe(true);
    expect(restored.Settings.penStrokeLineWidth).toBe(9);
    expect(restored.Settings.penStrokeEraser).toBe(true);
    expect(restored.Settings.penStrokeEraserSize).toBe(80);
    expect(restored.Settings.autoFillPenStrokeColor).toEqual([220, 30, 80, 0.6]);
    expect(restored.Settings.mouseRightDragBackground).toBe("moveCamera");
    expect(restored.Settings.textNodeMaxCharWidth).toBe(22);
    expect(restored.Settings.aiConnectionMode).toBe("chatgpt");
  });
});
