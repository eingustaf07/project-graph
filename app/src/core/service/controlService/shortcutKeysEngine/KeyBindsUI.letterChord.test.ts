// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  active: undefined as unknown,
  saved: new Map<string, unknown>(),
  open: vi.fn(),
  normal: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/core/Project", () => ({ Project: class Project {} }));
vi.mock("@/state", () => ({
  activeResourceTabAtom: "resource",
  activeTabAtom: "active",
  store: { get: () => fixture.active },
}));
vi.mock("@/utils/platform", () => ({ isMac: false }));
vi.mock("@/utils/store", () => ({
  createStore: async () => ({
    get: async (key: string) => fixture.saved.get(key),
    set: async (key: string, value: unknown) => fixture.saved.set(key, value),
    save: fixture.save,
  }),
}));
vi.mock("./shortcutKeysRegister", () => ({
  allKeyBinds: [
    { id: "openAIPanel", defaultKey: "a+i", when: (project: unknown) => !!project, onPress: () => fixture.open() },
    { id: "normalShortcut", defaultKey: "C-f", when: () => true, onPress: () => fixture.normal() },
  ],
}));
import { Project } from "@/core/Project";
import { KeyBindsUI } from "./KeyBindsUI";
import { URI } from "vscode-uri";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function down(key: string, extra: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  await flush();
}
async function up(key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  await flush();
}
beforeEach(async () => {
  KeyBindsUI.uiStopListen();
  for (const binding of [...KeyBindsUI.getAllUIKeyBinds()]) KeyBindsUI.unregisterOneUIKeyBind(binding.id);
  fixture.saved.clear();
  fixture.open.mockClear();
  fixture.normal.mockClear();
  fixture.save.mockClear();
  fixture.active = new Project(URI.parse("draft://shortcut-test"));
  document.body.innerHTML = "";
  await KeyBindsUI.registerAllUIKeyBinds();
  KeyBindsUI.uiStartListen();
});
afterEach(() => KeyBindsUI.uiStopListen());
describe("held letter shortcut", () => {
  it("releases continuous letter actions before opening the panel", async () => {
    const start = vi.fn(),
      stop = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("testContinuousA", "a", true, start, stop, true);
    try {
      await down("a");
      expect(start).toHaveBeenCalledOnce();
      await down("i");
      expect(stop).toHaveBeenCalledOnce();
      expect(fixture.open).toHaveBeenCalledOnce();
      await up("a");
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      KeyBindsUI.unregisterOneUIKeyBind("testContinuousA");
    }
  });
  it("does not open the panel when shortcut recording has consumed the keys", async () => {
    const recorder = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", recorder);
    const send = async (key: string) => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      await flush();
    };
    try {
      await send("a");
      await send("i");
      expect(fixture.open).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", recorder);
    }
  });
  it("requires overlapping keys and triggers only once while held", async () => {
    await down("a");
    await up("a");
    await down("i");
    await up("i");
    expect(fixture.open).not.toHaveBeenCalled();
    await down("a");
    await down("i");
    await down("i", { repeat: true });
    expect(fixture.open).toHaveBeenCalledTimes(1);
    await up("i");
    await down("i");
    expect(fixture.open).toHaveBeenCalledTimes(2);
  });
  it("does not activate in text fields or during composition", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await down("a");
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
    input.blur();
    await down("a", { isComposing: true });
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
  });
  it("clears held letters after focus changes and blur", async () => {
    await down("a");
    window.dispatchEvent(new Event("blur"));
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
    await up("i");
    await down("a");
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    input.blur();
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
  });
  it("preserves ordinary shortcuts and ignores modified letter combinations", async () => {
    await down("f", { ctrlKey: true });
    expect(fixture.normal).toHaveBeenCalledOnce();
    await down("a", { ctrlKey: true });
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
  });
  it("honors disabled commands, different bindings, and missing project", async () => {
    fixture.active = undefined;
    await down("a");
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
    await up("a");
    await up("i");
    fixture.active = new Project(URI.parse("draft://shortcut-test"));
    KeyBindsUI.registerOneUIKeyBind("openAIPanel", "a+i", false, fixture.open);
    await down("a");
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
    await up("a");
    await up("i");
    KeyBindsUI.registerOneUIKeyBind("openAIPanel", "C-j", true, fixture.open);
    await down("a");
    await down("i");
    expect(fixture.open).not.toHaveBeenCalled();
    await down("j", { ctrlKey: true });
    expect(fixture.open).toHaveBeenCalledOnce();
  });
  it("initializes only the previously empty enabled AI binding", async () => {
    fixture.saved.set("openAIPanel", { key: "", isEnabled: true });
    fixture.saved.set("unrelated", { key: "backspace", isEnabled: true });
    await KeyBindsUI.registerAllUIKeyBinds();
    expect(fixture.saved.get("openAIPanel")).toEqual({ key: "a+i", isEnabled: true });
    expect(fixture.saved.get("unrelated")).toEqual({ key: "backspace", isEnabled: true });
    fixture.saved.set("openAIPanel", { key: "C-j", isEnabled: true });
    await KeyBindsUI.registerAllUIKeyBinds();
    expect(fixture.saved.get("openAIPanel")).toEqual({ key: "C-j", isEnabled: true });
    fixture.saved.set("openAIPanel", { key: "", isEnabled: false });
    await KeyBindsUI.registerAllUIKeyBinds();
    expect(fixture.saved.get("openAIPanel")).toEqual({ key: "", isEnabled: false });
  });
});
