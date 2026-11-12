// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  active: undefined as unknown,
  saved: new Map<string, unknown>(),
  open: vi.fn(),
  normal: vi.fn(),
  shrink: vi.fn(),
  grow: vi.fn(),
  lengthGrow: vi.fn(),
  lengthShrink: vi.fn(),
  heightGrow: vi.fn(),
  heightShrink: vi.fn(),
  nodes: vi.fn(),
  text: vi.fn(),
  save: vi.fn(),
  highlightSelect: vi.fn(),
  highlightText: vi.fn(),
  highlightLocked: true,
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
    entries: async () => [...fixture.saved.entries()],
    get: async (key: string) => fixture.saved.get(key),
    set: async (key: string, value: unknown) => fixture.saved.set(key, value),
    save: fixture.save,
  }),
}));
vi.mock("./shortcutKeysRegister", () => ({
  allKeyBinds: [
    { id: "shrinkSelectedFrames", defaultKey: "-", when: () => true, onPress: () => fixture.shrink() },
    { id: "growSelectedFrames", defaultKey: "=", when: () => true, onPress: () => fixture.grow() },
    { id: "growFrameLength", defaultKey: "l+=", when: () => true, onPress: () => fixture.lengthGrow() },
    { id: "shrinkFrameLength", defaultKey: "l+-", when: () => true, onPress: () => fixture.lengthShrink() },
    { id: "growFrameHeight", defaultKey: "h+=", when: () => true, onPress: () => fixture.heightGrow() },
    { id: "shrinkFrameHeight", defaultKey: "h+-", when: () => true, onPress: () => fixture.heightShrink() },
    { id: "heldLetterDoublePress", defaultKey: "h h", when: () => true, onPress: () => fixture.normal() },
    { id: "openAIPanel", defaultKey: "a+i", when: (project: unknown) => !!project, onPress: () => fixture.open() },
    { id: "normalShortcut", defaultKey: "C-f", when: () => true, onPress: () => fixture.normal() },
    { id: "copy", defaultKey: "C-c", when: (project: unknown) => !!project, onPress: () => fixture.nodes() },
    { id: "copyText", defaultKey: "C-c C-c", when: (project: unknown) => !!project, onPress: () => fixture.text() },
    {
      id: "selectHighlighted",
      defaultKey: "S-c",
      when: (project: unknown) => !!project && fixture.highlightLocked,
      onPress: () => fixture.highlightSelect(),
    },
    {
      id: "copyHighlightedText",
      defaultKey: "S-c S-c",
      when: (project: unknown) => !!project && fixture.highlightLocked,
      onPress: () => fixture.highlightText(),
    },
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
  fixture.shrink.mockClear();
  fixture.grow.mockClear();
  fixture.lengthGrow.mockClear();
  fixture.lengthShrink.mockClear();
  fixture.heightGrow.mockClear();
  fixture.heightShrink.mockClear();
  fixture.nodes.mockClear();
  fixture.text.mockClear();
  fixture.save.mockClear();
  fixture.highlightSelect.mockClear();
  fixture.highlightText.mockClear();
  fixture.highlightLocked = true;
  fixture.active = new Project(URI.parse("draft://shortcut-test"));
  document.body.innerHTML = "";
  await KeyBindsUI.registerAllUIKeyBinds();
  KeyBindsUI.uiStartListen();
});

it.each([
  ["l", "lengthGrow", "lengthShrink"],
  ["h", "heightGrow", "heightShrink"],
] as const)(
  "resizes only one axis with held %s and main signs without also running whole-frame scaling",
  async (letter, grow, shrink) => {
    await down(letter);
    await down("=", { code: "Equal" });
    expect(fixture[grow]).toHaveBeenCalledOnce();
    expect(fixture.grow).not.toHaveBeenCalled();
    await up("=");
    await down("+", { code: "Equal" });
    expect(fixture[grow]).toHaveBeenCalledTimes(2);
    await up("+");
    await down("-", { code: "Minus" });
    expect(fixture[shrink]).toHaveBeenCalledOnce();
    expect(fixture.shrink).not.toHaveBeenCalled();
    await up("-");
    await up(letter);
    await down("=", { code: "Equal" });
    expect(fixture.grow).toHaveBeenCalledOnce();
  },
);
it("holding H for a size chord does not run the H H command on key repeat", async () => {
  await down("h");
  await down("h", { repeat: true });
  expect(fixture.normal).not.toHaveBeenCalled();
  await down("=", { code: "Equal" });
  expect(fixture.heightGrow).toHaveBeenCalledOnce();
});
it("resizes frames with main keyboard signs while excluding numpad signs and text inputs", async () => {
  await down("-", { code: "NumpadSubtract", location: 3 });
  expect(fixture.shrink).not.toHaveBeenCalled();
  await up("-");
  await down("-", { code: "Minus" });
  expect(fixture.shrink).toHaveBeenCalledTimes(1);
  await up("-");
  await down("+", { code: "NumpadAdd", location: 3 });
  await up("+");
  await down("+", { code: "NumpadAdd", location: 3, shiftKey: true });
  expect(fixture.grow).not.toHaveBeenCalled();
  await up("+");
  await down("=", { code: "Equal" });
  expect(fixture.grow).toHaveBeenCalledTimes(1);
  await up("=");
  await down("+", { code: "Equal" });
  expect(fixture.grow).toHaveBeenCalledTimes(2);
  await up("+");
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  await down("-", { code: "Minus" });
  expect(fixture.shrink).toHaveBeenCalledTimes(1);
  await down("=", { code: "Equal" });
  await down("+", { code: "Equal" });
  expect(fixture.grow).toHaveBeenCalledTimes(2);
});

it.each([true, false])("migrates only the former frame grow default and preserves enabled=%s", async (isEnabled) => {
  fixture.saved.set("growSelectedFrames", { key: "S-+", isEnabled });
  fixture.saved.set("unrelated", { key: "backspace", isEnabled: true });
  await KeyBindsUI.registerAllUIKeyBinds();
  expect(fixture.saved.get("growSelectedFrames")).toEqual({ key: "=", isEnabled });
  expect(KeyBindsUI.getUIKeyBind("growSelectedFrames")).toMatchObject({ key: "=", isEnabled });
  expect(fixture.saved.get("unrelated")).toEqual({ key: "backspace", isEnabled: true });
});

it("keeps custom frame grow bindings without an extra plus alias", async () => {
  fixture.saved.set("growSelectedFrames", { key: "C-j", isEnabled: true });
  await KeyBindsUI.registerAllUIKeyBinds();
  expect(fixture.saved.get("growSelectedFrames")).toEqual({ key: "C-j", isEnabled: true });
  await down("=", { code: "Equal" });
  await up("=");
  await down("+", { code: "Equal" });
  await up("+");
  expect(fixture.grow).not.toHaveBeenCalled();
  await down("j", { code: "KeyJ", ctrlKey: true });
  expect(fixture.grow).toHaveBeenCalledOnce();
});

describe("native and installed bridge deletion sharing a key", () => {
  function setupDeletion(
    options: { bridgeFirst?: boolean; enabled?: boolean; eligible?: boolean; bridgeKey?: string } = {},
  ) {
    const remaining = new Set(["parent", "target", "child"]);
    let selected = "target";
    const removeSelected = vi.fn(() => {
      remaining.delete(selected);
      selected = "parent";
    });
    const bridge = vi.fn(async () => {
      await Promise.resolve();
      removeSelected();
    });
    const registerCore = () =>
      KeyBindsUI.registerOneUIKeyBind(
        "deleteSelectedStageObjects",
        "backspace",
        true,
        removeSelected,
        undefined,
        false,
        () => true,
      );
    const registerBridge = () =>
      KeyBindsUI.registerOneUIKeyBind(
        "ext:com.mingliang.insert-node:bridge-delete",
        options.bridgeKey ?? "backspace",
        options.enabled ?? true,
        bridge,
        undefined,
        false,
        () => options.eligible ?? true,
      );
    if (options.bridgeFirst) {
      registerBridge();
      registerCore();
    } else {
      registerCore();
      registerBridge();
    }
    return { remaining, removeSelected, bridge };
  }

  it.each([false, true])(
    "deletes the target once and retains both neighbours, extension registered first = %s",
    async (bridgeFirst) => {
      const { remaining, removeSelected, bridge } = setupDeletion({ bridgeFirst });
      await down("Backspace");
      await up("Backspace");
      expect(bridge).toHaveBeenCalledOnce();
      expect(removeSelected).toHaveBeenCalledOnce();
      expect([...remaining]).toEqual(["parent", "child"]);
    },
  );

  it.each([{ enabled: false }, { eligible: false }])(
    "keeps native deletion available when the bridge cannot run: %j",
    async (options) => {
      const { remaining, removeSelected, bridge } = setupDeletion(options);
      await down("Backspace");
      expect(bridge).not.toHaveBeenCalled();
      expect(removeSelected).toHaveBeenCalledOnce();
      expect([...remaining]).toEqual(["parent", "child"]);
    },
  );

  it("keeps separately assigned deletion shortcuts independent", async () => {
    const { removeSelected, bridge } = setupDeletion({ bridgeKey: "delete" });
    await down("Backspace");
    await up("Backspace");
    expect(removeSelected).toHaveBeenCalledOnce();
    expect(bridge).not.toHaveBeenCalled();
    await down("Delete");
    expect(bridge).toHaveBeenCalledOnce();
    expect(removeSelected).toHaveBeenCalledTimes(2);
  });
});

describe("PG1.4 copy shortcuts", () => {
  it("selects highlighted nodes and copies their text on the second physical Shift+C", async () => {
    await down("C", { shiftKey: true });
    expect(fixture.highlightSelect).toHaveBeenCalledOnce();
    expect(fixture.highlightText).not.toHaveBeenCalled();
    await up("C");
    await down("C", { shiftKey: true });
    expect(fixture.highlightSelect).toHaveBeenCalledOnce();
    expect(fixture.highlightText).toHaveBeenCalledOnce();
    expect(fixture.nodes).not.toHaveBeenCalled();
    expect(fixture.text).not.toHaveBeenCalled();
  });
  it("does not treat a held Shift+C as a second physical press", async () => {
    await down("C", { shiftKey: true });
    await down("C", { shiftKey: true, repeat: true });
    expect(fixture.highlightSelect).toHaveBeenCalledOnce();
    expect(fixture.highlightText).not.toHaveBeenCalled();
  });
  it("requires highlight lock while retaining normal Ctrl+C", async () => {
    fixture.highlightLocked = false;
    await down("C", { shiftKey: true });
    await up("C");
    await down("C", { shiftKey: true });
    expect(fixture.highlightSelect).not.toHaveBeenCalled();
    expect(fixture.highlightText).not.toHaveBeenCalled();
    await down("c", { ctrlKey: true });
    expect(fixture.nodes).toHaveBeenCalledOnce();
  });
  it("keeps the Ctrl and Shift copy sequences independent", async () => {
    await down("C", { shiftKey: true });
    await up("C");
    await down("c", { ctrlKey: true });
    await up("c");
    await down("C", { shiftKey: true });
    expect(fixture.highlightSelect).toHaveBeenCalledTimes(2);
    expect(fixture.nodes).toHaveBeenCalledOnce();
    expect(fixture.highlightText).not.toHaveBeenCalled();
    expect(fixture.text).not.toHaveBeenCalled();
  });
  it("leaves text entry alone for Shift+C", async () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    await down("C", { shiftKey: true });
    await up("C");
    await down("C", { shiftKey: true });
    expect(fixture.highlightSelect).not.toHaveBeenCalled();
    expect(fixture.highlightText).not.toHaveBeenCalled();
  });
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
  it.each(["r", "g"])("recognizes a rapid Tab+%s chord without replaying Tab growth", async (key) => {
    const grow = vi.fn(),
      arm = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("testTab", "tab", true, grow);
    KeyBindsUI.registerOneUIKeyBind("testRapidChord", "tab+" + key, true, arm);
    for (const [type, letter] of [
      ["keydown", "Tab"],
      ["keydown", key],
      ["keyup", key],
      ["keyup", "Tab"],
    ]) {
      window.dispatchEvent(new KeyboardEvent(type, { key: letter, bubbles: true, cancelable: true }));
    }
    await flush();
    await flush();
    expect(arm).toHaveBeenCalledOnce();
    expect(grow).not.toHaveBeenCalled();
  });
  it("cancels native Tab navigation synchronously before asynchronous chord checks", async () => {
    const reverse = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("testReverse", "tab+r", true, reverse);
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await flush();
    await down("r");
    await up("r");
    await up("Tab");
    expect(reverse).toHaveBeenCalledOnce();
  });
  it("runs Tab+R and Tab+G without firing the plain Tab growth command", async () => {
    const grow = vi.fn(),
      reverse = vi.fn(),
      undirected = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("testTab", "tab", true, grow);
    KeyBindsUI.registerOneUIKeyBind("testReverse", "tab+r", true, reverse);
    KeyBindsUI.registerOneUIKeyBind("testUndirected", "tab+g", true, undirected);
    await down("Tab");
    expect(grow).not.toHaveBeenCalled();
    await down("r");
    await up("r");
    await up("Tab");
    expect(reverse).toHaveBeenCalledOnce();
    expect(grow).not.toHaveBeenCalled();
    await down("Tab");
    await down("g");
    await up("g");
    await up("Tab");
    expect(undirected).toHaveBeenCalledOnce();
    expect(grow).not.toHaveBeenCalled();
    await down("Tab");
    await up("Tab");
    expect(grow).toHaveBeenCalledOnce();
  });
  it("does not replay a pending Tab after focus loss or inside a text input", async () => {
    const grow = vi.fn(),
      reverse = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("testTab", "tab", true, grow);
    KeyBindsUI.registerOneUIKeyBind("testReverse", "tab+r", true, reverse);
    await down("Tab");
    window.dispatchEvent(new Event("blur"));
    await up("Tab");
    expect(grow).not.toHaveBeenCalled();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await down("Tab");
    await down("r");
    await up("Tab");
    expect(reverse).not.toHaveBeenCalled();
    expect(grow).not.toHaveBeenCalled();
  });
  it("preserves existing sequences ending in Tab", async () => {
    const existing = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("existingETab", "e tab", true, existing);
    KeyBindsUI.registerOneUIKeyBind("testReverse", "tab+r", true, vi.fn());
    await down("e");
    await up("e");
    await down("Tab");
    await up("Tab");
    expect(existing).toHaveBeenCalledOnce();
  });
  it("counts a held transfer key as one press and still recognizes a physical VV", async () => {
    const container = vi.fn();
    KeyBindsUI.registerOneUIKeyBind("heldVTest", "v v", true, container);
    await down("v");
    await down("v", { repeat: true });
    await down("v", { repeat: true });
    expect(container).not.toHaveBeenCalled();
    await up("v");
    await down("v");
    await up("v");
    expect(container).toHaveBeenCalledOnce();
    KeyBindsUI.unregisterOneUIKeyBind("heldVTest");
  });
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
