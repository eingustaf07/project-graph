// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

const overlays = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock("@/components/overlay-host", () => ({ OverlayHost: overlays }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function open(options: Parameters<typeof Dialog.input>[2] = {}) {
  const pending = Dialog.input("重命名 Section", "框名称", { defaultValue: "新的框名称", ...options });
  await act(async () => root.render(React.cloneElement(overlays.open.mock.lastCall![0], { overlayId: "input-test" })));
  return { pending, input: document.querySelector("input,textarea")! };
}
async function key(input: Element, event: KeyboardEventInit) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...event }));
  });
}

it("confirms the frame rename with plain Enter and displays the matching hint", async () => {
  const { pending, input } = await open({ confirmKey: "enter" });
  expect(document.body.textContent).toContain("确定（Enter）");
  expect(document.body.textContent).not.toContain("Shift+Enter");
  await key(input, {});
  await expect(pending).resolves.toBe("新的框名称");
});

it.each([false, true])("keeps Shift+Enter for other dialogs, multiline=%s", async (multiline) => {
  const { pending, input } = await open({ multiline });
  const resolved = vi.fn();
  void pending.then(resolved);
  expect(document.body.textContent).toContain("确定（Shift+Enter）");
  await key(input, {});
  expect(resolved).not.toHaveBeenCalled();
  await key(input, { shiftKey: true });
  await expect(pending).resolves.toBe("新的框名称");
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "does not submit while the IME is selecting text: %j",
  async (composition) => {
    const { pending, input } = await open({ confirmKey: "enter" });
    const resolved = vi.fn();
    void pending.then(resolved);
    await key(input, composition);
    expect(resolved).not.toHaveBeenCalled();
    await key(input, {});
    await expect(pending).resolves.toBe("新的框名称");
  },
);

it("keeps Escape cancellation and does not submit modifier Enter combinations", async () => {
  const { pending, input } = await open({ confirmKey: "enter" });
  const resolved = vi.fn();
  void pending.then(resolved);
  for (const modifiers of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    await key(input, modifiers);
    expect(resolved).not.toHaveBeenCalled();
  }
  await key(input, { key: "Escape" });
  await expect(pending).resolves.toBeUndefined();
});
