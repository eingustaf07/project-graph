import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ values: {} as Record<string, unknown>, revision: 0 }));
vi.mock("@/utils/platform", () => ({ isMac: false, isWeb: false }));
vi.mock("@/utils/developmentProfile", () => ({ preferencePath: async () => "settings.json" }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: { confirm: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: any) => {
    if (command === "write_shared_setting") {
      backend.values[args.key] = structuredClone(args.value);
      backend.revision++;
    }
    return {
      revision: String(backend.revision),
      values: args.revision === String(backend.revision) ? null : structuredClone(backend.values),
    };
  },
}));

describe("settings proxy receiving other windows", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    backend.values = { mouseRightDragBackground: "moveCamera", textNodeMaxCharWidth: 22 };
    backend.revision = 0;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("updates readers and subscriptions in both directions without echo writes or changing unrelated preferences", async () => {
    const first = (await import("./Settings")).Settings;
    vi.resetModules();
    const second = (await import("./Settings")).Settings;
    const observed = vi.fn();
    second.watch("soundVolume", observed);
    const revision = backend.revision;
    first.soundVolume = 23;
    expect(first.soundVolume).toBe(23);
    await vi.advanceTimersByTimeAsync(1500);
    expect(second.soundVolume).toBe(23);
    expect(observed).toHaveBeenLastCalledWith(23);
    expect(backend.revision).toBe(revision + 1);
    second.questionMarkYellow = false;
    await vi.advanceTimersByTimeAsync(1500);
    expect(first.questionMarkYellow).toBe(false);
    expect(first.mouseRightDragBackground).toBe("moveCamera");
    expect(first.textNodeMaxCharWidth).toBe(22);
    expect(backend.revision).toBe(revision + 2);
  });

  it("keeps watcher-triggered subsequent edits newer than the triggering setting change", async () => {
    const { Settings } = await import("./Settings");
    const unwatch = Settings.watch("soundVolume", (value) => {
      if (value === 10) Settings.soundVolume = 20;
    });
    Settings.soundVolume = 10;
    await vi.advanceTimersByTimeAsync(1500);
    expect(Settings.soundVolume).toBe(20);
    expect(backend.values.soundVolume).toBe(20);
    unwatch();
  });
});
