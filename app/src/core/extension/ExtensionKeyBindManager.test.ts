import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  register: vi.fn(),
  split: vi.fn(),
}));
vi.mock("@/utils/platform", () => ({ isMac: false }));
vi.mock("@/utils/store", () => ({ createStore: async () => state }));
vi.mock("../service/controlService/shortcutKeysEngine/KeyBindsUI", () => ({
  KeyBindsUI: { registerOneUIKeyBind: state.register },
}));
vi.mock("./edgeSplit", () => ({ splitSelectedExtensionEdge: state.split }));
import { ExtensionKeyBindManager } from "./ExtensionKeyBindManager";

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it("routes the installed Alt+Q command through the curved-edge fix while retaining the saved shortcut", async () => {
  state.get.mockResolvedValue({ key: "M-w", isEnabled: true });
  const oldCallback = vi.fn();
  await ExtensionKeyBindManager.register("com.mingliang.insert-node", {
    id: "edge-split-q",
    defaultKey: "M-q",
    onPress: oldCallback,
  });
  const [id, key, enabled, callback] = state.register.mock.calls[0];
  expect([id, key, enabled]).toEqual(["ext:com.mingliang.insert-node:edge-split-q", "M-w", true]);
  const project = { uri: "test-project" };
  await callback(project);
  expect(state.split).toHaveBeenCalledExactlyOnceWith(project);
  expect(oldCallback).not.toHaveBeenCalled();
  expect(state.set).not.toHaveBeenCalled();
});

it("retains disabled state and the extension's other callbacks", async () => {
  state.get.mockResolvedValue({ key: "backspace", isEnabled: false });
  const callback = vi.fn();
  await ExtensionKeyBindManager.register("com.mingliang.insert-node", {
    id: "bridge-delete",
    defaultKey: "backspace",
    onPress: callback,
  });
  expect(state.register.mock.calls[0][2]).toBe(false);
  expect(state.register.mock.calls[0][3]).toBe(callback);
});

it("does not replace matching command names owned by another extension", async () => {
  const callback = vi.fn();
  await ExtensionKeyBindManager.register("another.extension", {
    id: "edge-split-q",
    defaultKey: "M-q",
    onPress: callback,
  });
  expect(state.register.mock.calls[0][3]).toBe(callback);
});

it.each(["com.enterhalf.task-arrange", "text-node-todolist"])(
  "keeps multi-selection for both status commands from %s without changing saved keys",
  async (extensionId) => {
    state.get.mockResolvedValue({ key: "user key", isEnabled: true });
    const first = { isSelected: true, text: "问题？", color: "yellow" };
    const second = { isSelected: true, text: "任务", color: "none" };
    const next = { isSelected: false, text: "📌 下一项", color: "none" };
    const edge = { isSelected: true };
    const project = { stage: [first, second, next, edge], controller: { resetCountdownTimer: vi.fn() } };
    for (const id of ["smartOKK", "smartERR", "smartERR"]) {
      const callback = vi.fn(async () => {
        const color = id === "smartOKK" ? "green" : first.color === "red" ? "none" : "red";
        first.color = second.color = color;
        project.stage.forEach((object) => {
          object.isSelected = false;
        });
        next.isSelected = true;
      });
      await ExtensionKeyBindManager.register(extensionId, { id, defaultKey: "unused", onPress: callback });
      const registered = state.register.mock.lastCall!;
      expect(registered.slice(0, 3)).toEqual([`ext:${extensionId}:${id}`, "user key", true]);
      await registered[3](project);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(project.stage.map((object) => object.isSelected)).toEqual([true, true, false, true]);
    }
    expect(first.color).toBe("none");
    expect(state.set).not.toHaveBeenCalled();
  },
);

it("restores remaining selected objects after an extension failure without resurrecting removed objects", async () => {
  state.get.mockResolvedValue({ key: "o k", isEnabled: true });
  const first = { isSelected: true },
    removed = { isSelected: true },
    other = { isSelected: false };
  const project = { stage: [first, removed, other], controller: { resetCountdownTimer: vi.fn() } };
  await ExtensionKeyBindManager.register("com.enterhalf.task-arrange", {
    id: "smartOKK",
    defaultKey: "o k k",
    onPress: async () => {
      project.stage = [first, other];
      first.isSelected = false;
      throw new Error("extension failed");
    },
  });
  await expect(state.register.mock.lastCall![3](project)).rejects.toThrow("extension failed");
  expect(project.stage).toEqual([first, other]);
  expect(first.isSelected).toBe(true);
  expect(other.isSelected).toBe(false);
});

it.each(["pointerdown", "keydown", "blur"])("does not override subsequent user interaction: %s", async (eventType) => {
  vi.stubGlobal("window", new EventTarget());
  const old = { isSelected: true },
    clicked = { isSelected: false };
  const project = { stage: [old, clicked], controller: { resetCountdownTimer: vi.fn() } };
  await ExtensionKeyBindManager.register("com.enterhalf.task-arrange", {
    id: "smartERR",
    defaultKey: "e r r",
    onPress: async () => {
      window.dispatchEvent(new Event(eventType));
      old.isSelected = false;
      clicked.isSelected = true;
    },
  });
  await state.register.mock.lastCall![3](project);
  expect(project.stage.map((object) => object.isSelected)).toEqual([false, true]);
});

it("leaves other extensions' identically named commands unchanged", async () => {
  const callback = vi.fn();
  await ExtensionKeyBindManager.register("another.extension", { id: "smartOKK", defaultKey: "x", onPress: callback });
  expect(state.register.mock.lastCall![3]).toBe(callback);
});
