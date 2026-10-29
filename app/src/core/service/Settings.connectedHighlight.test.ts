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
});
