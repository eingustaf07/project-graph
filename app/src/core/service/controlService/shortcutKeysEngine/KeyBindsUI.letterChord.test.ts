// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  active: undefined as unknown,
  saved: new Map<string, unknown>(),
  open: vi.fn(),
  normal: vi.fn(),
  nodes: vi.fn(),
  text: vi.fn(),
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
    { id: "copy", defaultKey: "C-c", when: (project: unknown) => !!project, onPress: () => fixture.nodes() },
    { id: "copyText", defaultKey: "C-c C-c", when: (project: unknown) => !!project, onPress: () => fixture.text() },
  ],
}));
import { Project } from "@/core/Project";
import { KeyBindsUI } from "./KeyBindsUI";
import { URI } from "vscode-uri";
import { doodleCommands } from "./doodleCommands";

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
  fixture.nodes.mockClear();
  fixture.text.mockClear();
  fixture.save.mockClear();
  fixture.active = new Project(URI.parse("draft://shortcut-test"));
  document.body.innerHTML = "";
  await KeyBindsUI.registerAllUIKeyBinds();
  KeyBindsUI.uiStartListen();
});

describe("PG1.4 copy shortcuts", () => {
  it("copies nodes immediately, then text on a second physical C press", async () => {
    await down("Control", { ctrlKey: true });
    await down("c", { ctrlKey: true });
    expect(fixture.nodes).toHaveBeenCalledOnce();
    expect(fixture.text).not.toHaveBeenCalled();
    await up("c");
    await down("c", { ctrlKey: true });
    expect(fixture.text).toHaveBeenCalledOnce();
    expect(fixture.nodes).toHaveBeenCalledOnce();
    expect(KeyBindsUI.getCurrentKeySequence()).toBe("");
  });

  it("does not turn keyboard auto-repeat into double-copy", async () => {
    await down("c", { ctrlKey: true });
    await down("c", { ctrlKey: true, repeat: true });
    await down("c", { ctrlKey: true, repeat: true });
    expect(fixture.nodes).toHaveBeenCalledOnce();
    expect(fixture.text).not.toHaveBeenCalled();
  });

  it("expires the double-copy window without delaying ordinary copy", async () => {
    await down("c", { ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await down("c", { ctrlKey: true });
    expect(fixture.nodes).toHaveBeenCalledTimes(2);
    expect(fixture.text).not.toHaveBeenCalled();
  });

  it("ends the sequence on another shortcut and preserves that shortcut", async () => {
    await down("c", { ctrlKey: true });
    await down("f", { ctrlKey: true });
    expect(fixture.normal).toHaveBeenCalledOnce();
    await down("c", { ctrlKey: true });
    expect(fixture.nodes).toHaveBeenCalledTimes(2);
    expect(fixture.text).not.toHaveBeenCalled();
  });

  it.each(["blur", "project", "mouse"])("ends the sequence after %s changes", async (change) => {
    await down("c", { ctrlKey: true });
    if (change === "blur") window.dispatchEvent(new Event("blur"));
    if (change === "project") fixture.active = new Project(URI.parse("draft://another-project"));
    if (change === "mouse") {
      window.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
      await flush();
    }
    await down("c", { ctrlKey: true });
    expect(fixture.nodes).toHaveBeenCalledTimes(2);
    expect(fixture.text).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "true", "", "plaintext-only"])(
    "leaves native copying in editable context %s",
    async (kind) => {
      const input = document.createElement(kind === "input" || kind === "textarea" ? kind : "div");
      if (input.tagName === "DIV") {
        input.setAttribute("contenteditable", kind);
        input.tabIndex = 0;
      }
      document.body.append(input);
      input.focus();
      for (let i = 0; i < 2; i++) {
        const event = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
        window.dispatchEvent(event);
        await flush();
        expect(event.defaultPrevented).toBe(false);
      }
      expect(fixture.nodes).not.toHaveBeenCalled();
      expect(fixture.text).not.toHaveBeenCalled();
    },
  );

  it("supports customized copy bindings and longer copy-text sequences", async () => {
    await KeyBindsUI.changeOneUIKeyBind("copy", "C-j");
    await KeyBindsUI.changeOneUIKeyBind("copyText", "C-j C-k C-l");
    await down("j", { ctrlKey: true });
    await down("k", { ctrlKey: true });
    await down("l", { ctrlKey: true });
    expect(fixture.nodes).toHaveBeenCalledOnce();
    expect(fixture.text).toHaveBeenCalledOnce();
  });

  it("respects disabled text copying without changing the ordinary binding", async () => {
    await KeyBindsUI.toggleEnabled("copyText");
    await down("c", { ctrlKey: true });
    await down("c", { ctrlKey: true });
    expect(fixture.nodes).toHaveBeenCalledTimes(2);
    expect(fixture.text).not.toHaveBeenCalled();
    expect(KeyBindsUI.getUIKeyBind("copy")?.key).toBe("C-c");
  });

  it("does not copy while a shortcut recorder consumes the event", async () => {
    const recorder = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", recorder);
    try {
      for (let i = 0; i < 2; i++) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true }),
        );
        await flush();
      }
      expect(fixture.nodes).not.toHaveBeenCalled();
      expect(fixture.text).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", recorder);
    }
  });
});
afterEach(() => KeyBindsUI.uiStopListen());
describe("held letter shortcut", () => {
  it("routes configured SQ, CY, ST and KK sequences", async () => {
    const tool = vi.fn();
    for (const command of doodleCommands.filter((item) => item.key && item.id !== "doodleEraser")) {
      KeyBindsUI.registerOneUIKeyBind(command.id, command.key, true, () => tool(command.action));
      for (const key of command.key.split(" ")) {
        await down(key);
        await up(key);
      }
      expect(tool).toHaveBeenLastCalledWith(command.action);
      KeyBindsUI.unregisterOneUIKeyBind(command.id);
    }
    expect(tool).toHaveBeenCalledTimes(4);
  });
  it("delays ER to preserve the existing ERR shortcut", async () => {
    const eraser = vi.fn(),
      oldCommand = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("doodleEraser", "e r", true, eraser);
    KeyBindsUI.registerOneUIKeyBind("oldERR", "e r r", true, oldCommand);
    try {
      for (const key of ["e", "r", "r"]) {
        await down(key);
        await up(key);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(oldCommand).toHaveBeenCalledOnce();
      expect(eraser).not.toHaveBeenCalled();
      for (const key of ["e", "r"]) {
        await down(key);
        await up(key);
      }
      expect(eraser).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(eraser).toHaveBeenCalledOnce();
    } finally {
      KeyBindsUI.unregisterOneUIKeyBind("doodleEraser");
      KeyBindsUI.unregisterOneUIKeyBind("oldERR");
    }
  });
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
