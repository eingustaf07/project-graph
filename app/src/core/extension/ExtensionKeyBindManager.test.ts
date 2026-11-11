import { beforeEach, expect, it, vi } from "vitest";

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
