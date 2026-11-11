// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { expect, it, vi } from "vitest";
import { ContextMenu, ContextMenuTrigger } from "./ui/context-menu";
import MyContextMenuContent from "./context-menu-content";
import { Project } from "@/core/Project";
import { activeResourceTabAtom } from "@/state";

const { eligible, execute } = vi.hoisted(() => ({ eligible: vi.fn(() => true), execute: vi.fn() }));
vi.mock("@/state", async () => ({ activeResourceTabAtom: (await import("jotai")).atom(null) }));
vi.mock("@/core/Project", () => ({ Project: class {} }));
vi.mock("@/core/service/controlService/shortcutKeysEngine/KeyBindsUI", () => ({
  KeyBindsUI: { getUIKeyBind: () => undefined },
}));
vi.mock("@/core/service/controlService/shortcutKeysEngine/shortcutKeysRegister", () => ({
  allKeyBinds: [{ id: "test-action", when: eligible, onPress: execute }],
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: { use: (key: string) => [key === "contextMenuConfig" ? [{ type: "item", id: "test-action" }] : false] },
}));
vi.mock("@/core/service/feedbackService/ColorManager", () => ({
  ColorManager: {
    getUserEntityFillColors: async () => [],
    subscribe: () => () => {},
  },
}));
vi.mock("@/sub/ColorPaletteWindow", () => ({ default: {} }));
vi.mock("@/sub/ColorWindow", () => ({ default: {} }));
vi.mock("./key-tooltip", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (s: string) => s }) }));

it("defers selection checks across tab switches and executes the opened menu on the current project", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = createStore();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const tabs = [Object.create(Project.prototype), Object.create(Project.prototype)];
  try {
    await act(() =>
      root.render(
        <Provider store={store}>
          <ContextMenu>
            <ContextMenuTrigger>画布</ContextMenuTrigger>
            <MyContextMenuContent />
          </ContextMenu>
        </Provider>,
      ),
    );
    for (let i = 0; i < 100; i++) await act(() => store.set(activeResourceTabAtom, tabs[i % 2]));
    expect(eligible).not.toHaveBeenCalled();
    await act(async () => {
      host
        .querySelector("[data-slot=context-menu-trigger]")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(eligible).toHaveBeenCalledWith(tabs[1]);
    const item = document.querySelector<HTMLElement>("[role=menuitem]")!;
    await act(() => item.click());
    expect(execute).toHaveBeenCalledWith(tabs[1]);
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
