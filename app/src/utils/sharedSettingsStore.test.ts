import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedSettingsStore } from "./sharedSettingsStore";
import type { invoke } from "@tauri-apps/api/core";

function server(initial: Record<string, unknown> = {}) {
  let values = structuredClone(initial),
    revision = 0;
  const call = vi.fn(async (command: string, args: any) => {
    await Promise.resolve();
    if (command === "write_shared_setting") {
      values[args.key] = structuredClone(args.value);
      revision++;
    }
    return { revision: String(revision), values: args.revision === String(revision) ? null : structuredClone(values) };
  });
  return { call: call as unknown as typeof invoke, read: () => values };
}

describe("shared settings across independent clients", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("merges independent edits, notifies both windows and restores saved opt-outs in a later window", async () => {
    const backend = server({ questionMarkYellow: false, unrelated: "keep" });
    const first = new SharedSettingsStore("settings.json", backend.call),
      second = new SharedSettingsStore("settings.json", backend.call);
    await Promise.all([first.init(), second.init()]);
    const received = vi.fn(),
      stop = second.start(received, (error) => {
        throw error;
      });
    await Promise.all([first.set("soundVolume", 25), second.set("textNodeMaxCharWidth", 18)]);
    await vi.advanceTimersByTimeAsync(750);
    expect(received).toHaveBeenLastCalledWith({
      questionMarkYellow: false,
      unrelated: "keep",
      soundVolume: 25,
      textNodeMaxCharWidth: 18,
    });
    expect(backend.read()).toEqual(received.mock.lastCall![0]);
    const later = new SharedSettingsStore("settings.json", backend.call);
    await later.init();
    expect(Object.fromEntries(await later.entries()).questionMarkYellow).toBe(false);
    expect((backend.call as any).mock.calls.filter(([name]: string[]) => name === "write_shared_setting")).toHaveLength(
      2,
    );
    stop();
  });

  it("does not replace a newer local edit with an in-flight read or an older write acknowledgement", async () => {
    const backend = server({ soundVolume: 100 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const call = vi.fn(async (command, args) => {
      const response = await backend.call(command, args);
      if (args.key === "soundVolume" && args.value === 20) await gate;
      return response;
    }) as unknown as typeof invoke;
    const client = new SharedSettingsStore("settings.json", call);
    await client.init();
    const snapshots: Record<string, unknown>[] = [];
    const stop = client.start(
      (values) => snapshots.push(structuredClone(values)),
      (error) => {
        throw error;
      },
    );
    const first = client.set("soundVolume", 20);
    await Promise.resolve();
    const last = client.set("soundVolume", 40);
    release();
    await Promise.all([first, last]);
    expect(snapshots.map((values) => values.soundVolume)).toEqual([100, 40, 40]);
    expect(backend.read().soundVolume).toBe(40);
    stop();
  });

  it("clones mutable values at submission and keeps polling unchanged snapshots quiet", async () => {
    const backend = server(),
      client = new SharedSettingsStore("settings.json", backend.call);
    await client.init();
    const value = { nodeCreated: false };
    const write = client.set("soundEffectEnabled", value);
    value.nodeCreated = true;
    await write;
    expect(backend.read().soundEffectEnabled).toEqual({ nodeCreated: false });
    const changed = vi.fn(),
      stop = client.start(changed, (error) => {
        throw error;
      });
    changed.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(changed).not.toHaveBeenCalled();
    stop();
    const count = (backend.call as any).mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect((backend.call as any).mock.calls).toHaveLength(count);
  });

  it("recovers the real saved state after a failed write and permits subsequent writes", async () => {
    const backend = server({ soundVolume: 100 });
    let fail = true;
    const call = vi.fn(async (command, args) => {
      if (command === "write_shared_setting" && fail) {
        fail = false;
        throw new Error("read-only");
      }
      return backend.call(command, args);
    }) as unknown as typeof invoke;
    const client = new SharedSettingsStore("settings.json", call);
    await client.init();
    await expect(client.set("soundVolume", 20)).rejects.toThrow("read-only");
    await client.refresh();
    expect(Object.fromEntries(await client.entries()).soundVolume).toBe(100);
    await client.set("soundVolume", 35);
    expect(backend.read().soundVolume).toBe(35);
  });

  it("refreshes on focus and reports an unavailable backend once until recovery", async () => {
    const backend = server();
    let fail = false;
    const call = vi.fn(async (command, args) => {
      if (fail) throw new Error("unavailable");
      return backend.call(command, args);
    }) as unknown as typeof invoke;
    const client = new SharedSettingsStore("settings.json", call);
    await client.init();
    const errors = vi.fn(),
      changed = vi.fn(),
      stop = client.start(changed, errors);
    fail = true;
    await vi.advanceTimersByTimeAsync(2250);
    expect(errors).toHaveBeenCalledTimes(1);
    fail = false;
    await backend.call("write_shared_setting", { key: "questionMarkYellow", value: true });
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledWith({ questionMarkYellow: true });
    fail = true;
    await vi.advanceTimersByTimeAsync(750);
    expect(errors).toHaveBeenCalledTimes(2);
    stop();
  });
});
