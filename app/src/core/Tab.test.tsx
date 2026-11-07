// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./service/Settings", () => ({ Settings: { maxFps: 60, maxFpsUnfocused: 60 } }));
vi.mock("./service/Telemetry", () => ({ Telemetry: { event: vi.fn() } }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: { buttons: vi.fn() } }));

import { Tab } from "./Tab";

class TestTab extends Tab {
  getComponent(): React.ComponentType {
    return () => null;
  }
}

describe("Tab cleanup", () => {
  it("discards missed display frames and resumes rendering after focus changes", () => {
    let frame: FrameRequestCallback;
    vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => {
      frame = next;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const tab = new TestTab({});
    const tick = vi.fn();
    tab.loadService(
      class {
        static id = "frameProbe";
        tick = tick;
      },
    );
    try {
      tab.loop();
      frame!(100);
      expect(tick).toHaveBeenCalledTimes(1);
      focus.mockReturnValue(false);
      frame!(2100);
      expect(tick).toHaveBeenCalledTimes(2);
      focus.mockReturnValue(true);
      frame!(2120);
      expect(tick).toHaveBeenCalledTimes(3);
    } finally {
      tab.pause();
      now.mockRestore();
      focus.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("releases every acquired service and listener before surfacing cleanup failures", async () => {
    const disposed = vi.fn();
    const tab = new TestTab({});
    const listener = vi.fn();
    tab.on("test-event", listener);
    tab.loadService(
      class SyncFailure {
        static id = "syncFailure";
        dispose() {
          throw new Error("sync cleanup failed");
        }
      },
    );
    tab.loadService(
      class AsyncFailure {
        static id = "asyncFailure";
        async dispose() {
          throw new Error("async cleanup failed");
        }
      },
    );
    tab.loadService(
      class SuccessfulCleanup {
        static id = "successfulCleanup";
        dispose() {
          disposed();
        }
      },
    );

    await expect(tab.dispose()).rejects.toMatchObject({
      name: "AggregateError",
      errors: [
        expect.objectContaining({ message: "sync cleanup failed" }),
        expect.objectContaining({ message: "async cleanup failed" }),
      ],
    });

    expect(disposed).toHaveBeenCalledOnce();
    expect(tab.getService("syncFailure" as never)).toBeUndefined();
    expect(tab.emit("test-event")).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
