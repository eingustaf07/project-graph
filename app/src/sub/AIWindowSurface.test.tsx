// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AIWindowSurface, useAIWindowSurface } from "./AIWindowSurface";
import { PortalContainerContext } from "@/components/ui/portal-container";
import { useContext } from "react";

const errors = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: errors }));
vi.mock("@/utils/platform", () => ({ isWeb: true }));
let root: Root, host: HTMLDivElement;
let mounts: number;
const targets = new EventTarget();
let child: Window;
function Chat() {
  const surface = useAIWindowSurface();
  const portal = useContext(PortalContainerContext);
  const [messages, setMessages] = useState(0);
  useEffect(() => {
    mounts++;
  }, []);
  return (
    <div data-chat="" data-detached={!!portal}>
      <textarea defaultValue="未发送草稿" />
      <button data-open="" onClick={surface.open}>
        打开
      </button>
      <button data-message="" onClick={() => setMessages((n) => n + 1)}>
        {messages}
      </button>
      <button data-restore="" onClick={surface.restore}>
        返回
      </button>
    </div>
  );
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mounts = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  child = {
    document: document.implementation.createHTMLDocument(""),
    closed: false,
    focus: vi.fn(),
    close: vi.fn(function () {
      Object.assign(child, { closed: true });
    }),
    addEventListener: targets.addEventListener.bind(targets),
    removeEventListener: targets.removeEventListener.bind(targets),
  } as unknown as Window;
  vi.spyOn(window, "open").mockReturnValue(child);
  await act(async () =>
    root.render(
      <AIWindowSurface id="test">
        <Chat />
      </AIWindowSurface>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
async function click(document: Document, selector: string) {
  await act(async () => (document.querySelector(selector) as HTMLElement).click());
}
it("moves the same chat and draft to another document and back without remounting", async () => {
  const editor = host.querySelector("textarea")!;
  editor.value = "进行中的草稿";
  await click(document, "[data-message]");
  await click(document, "[data-open]");
  expect(child.document.querySelector("textarea")).toBe(editor);
  expect(child.document.querySelector("textarea")!.value).toBe("进行中的草稿");
  expect(child.document.querySelector("[data-chat]")!.getAttribute("data-detached")).toBe("true");
  expect(mounts).toBe(1);
  await click(child.document, "[data-message]");
  await click(child.document, "[data-restore]");
  expect(host.querySelector("textarea")).toBe(editor);
  expect(host.querySelector("[data-message]")!.textContent).toBe("2");
  expect(mounts).toBe(1);
});
it("returns the live chat when the native window closes", async () => {
  await click(document, "[data-open]");
  await act(async () => {
    targets.dispatchEvent(new Event("pagehide"));
  });
  expect(host.querySelector("[data-chat]")).not.toBeNull();
  expect(mounts).toBe(1);
});
it("keeps the original panel if popup creation is rejected", async () => {
  vi.mocked(window.open).mockReturnValue(null);
  await click(document, "[data-open]");
  expect(host.querySelector("textarea")).not.toBeNull();
  expect(errors.error).toHaveBeenCalled();
  expect(mounts).toBe(1);
});
it("copies current stylesheet and theme into the popup", async () => {
  const style = document.createElement("style");
  style.textContent = ":root { --test-color: red; }";
  document.head.append(style);
  try {
    await click(document, "[data-open]");
    expect(child.document.head.textContent).toContain("--test-color");
    style.textContent = ":root { --test-color: blue; }";
    await act(async () => {
      await Promise.resolve();
    });
    expect(child.document.head.textContent).toContain("blue");
  } finally {
    style.remove();
  }
});
