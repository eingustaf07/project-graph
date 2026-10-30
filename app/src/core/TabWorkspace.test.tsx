// @vitest-environment jsdom

import {
  activeDockedTabAtom,
  activeGroupIdAtom,
  activeResourceTabAtom,
  activeTabAtom,
  store,
  tabGroupRootAtom,
  tabsAtom,
} from "@/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./service/Settings", () => ({ Settings: { maxFps: 60, maxFpsUnfocused: 60 } }));
vi.mock("./service/Telemetry", () => ({ Telemetry: { event: vi.fn() } }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: { buttons: vi.fn() } }));

import { Tab } from "./Tab";
import { createTabGroup, getTabGroups } from "./TabGroup";
import { TabWorkspace } from "./TabWorkspace";

class TestTab extends Tab {
  getComponent() {
    return () => null;
  }
}

class DocumentTestTab extends TestTab {
  readonly uri = "draft:test";
  camera = { x: 73, y: -128, scale: 0.7 };
  unsavedText = "尚未保存的修改";
  history = ["创建节点", "编辑文字"];
}

function openTestTab() {
  const tab = new TestTab({});
  const group = createTabGroup([tab.id], "test-group");
  store.set(tabsAtom, [tab]);
  store.set(activeTabAtom, tab);
  store.set(activeDockedTabAtom, tab);
  store.set(tabGroupRootAtom, group);
  store.set(activeGroupIdAtom, group.id);
  return tab;
}

describe("TabWorkspace close lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.set(tabsAtom, []);
    store.set(activeTabAtom, undefined);
    store.set(activeDockedTabAtom, undefined);
    store.set(activeResourceTabAtom, undefined);
    store.set(tabGroupRootAtom, null);
    store.set(activeGroupIdAtom, undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("waits for disposal after removing the closing tab", async () => {
    const tab = openTestTab();
    let finishDisposal!: () => void;
    const dispose = vi.spyOn(tab, "dispose").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisposal = resolve;
        }),
    );
    let closed = false;

    const closePromise = TabWorkspace.close(tab.id).then(() => {
      closed = true;
    });
    await Promise.resolve();

    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(449);
    expect(dispose).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(dispose).toHaveBeenCalledOnce();
    expect(store.get(tabsAtom)).toContain(tab);

    await vi.advanceTimersByTimeAsync(50);
    expect(store.get(tabsAtom)).not.toContain(tab);
    expect(closed).toBe(false);

    finishDisposal();
    await closePromise;
    expect(closed).toBe(true);
  });

  it("waits for tab removal when disposal finishes first", async () => {
    const tab = openTestTab();
    const dispose = vi.spyOn(tab, "dispose").mockResolvedValue();
    let closed = false;

    const closePromise = TabWorkspace.close(tab.id).then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(450);

    expect(dispose).toHaveBeenCalledOnce();
    expect(closed).toBe(false);
    expect(store.get(tabsAtom)).toContain(tab);

    await vi.advanceTimersByTimeAsync(50);
    await closePromise;
    expect(closed).toBe(true);
    expect(store.get(tabsAtom)).not.toContain(tab);
  });

  it("returns the in-flight close task when the tab is already closing", async () => {
    const tab = openTestTab();
    let finishDisposal!: () => void;
    vi.spyOn(tab, "dispose").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisposal = resolve;
        }),
    );
    let duplicateClosed = false;

    const firstClose = TabWorkspace.close(tab.id);
    const duplicateClose = TabWorkspace.close(tab.id).then(() => {
      duplicateClosed = true;
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(duplicateClosed).toBe(false);
    finishDisposal();
    await Promise.all([firstClose, duplicateClose]);
    expect(duplicateClosed).toBe(true);
  });

  it("removes the tab before reporting a disposal failure", async () => {
    const tab = openTestTab();
    const cleanupError = new Error("cleanup failed");
    vi.spyOn(tab, "dispose").mockRejectedValue(cleanupError);

    const closeResult = TabWorkspace.close(tab.id).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(500);

    await expect(closeResult).resolves.toBe(cleanupError);
    expect(store.get(tabsAtom)).not.toContain(tab);
  });

  it.each(["right", "bottom"] as const)(
    "merges %s document splits without replacing tabs, edits, views or history",
    (edge) => {
      const first = TabWorkspace.open(new DocumentTestTab({}));
      const second = TabWorkspace.open(new DocumentTestTab({}));
      const firstState = { camera: first.camera, history: first.history, text: first.unsavedText };
      const dispose = vi.spyOn(first, "dispose");
      expect(TabWorkspace.split(second.id, edge)).toBe(true);
      expect(getTabGroups(store.get(tabGroupRootAtom))).toHaveLength(2);
      expect(TabWorkspace.canMergeDocumentGroups(second.id)).toBe(true);
      expect(TabWorkspace.mergeDocumentGroups(second.id)).toBe(true);
      const groups = getTabGroups(store.get(tabGroupRootAtom));
      expect(groups).toHaveLength(1);
      expect(groups[0].tabIds).toEqual([first.id, second.id]);
      expect(groups[0].activeTabId).toBe(second.id);
      expect(store.get(tabsAtom)).toEqual([first, second]);
      expect(first.camera).toBe(firstState.camera);
      expect(first.history).toBe(firstState.history);
      expect(first.unsavedText).toBe(firstState.text);
      expect(dispose).not.toHaveBeenCalled();
      expect(TabWorkspace.mergeDocumentGroups(second.id)).toBe(false);
      expect(TabWorkspace.split(first.id, edge)).toBe(true);
      expect(TabWorkspace.mergeDocumentGroups(first.id)).toBe(true);
    },
  );

  it("merges nested file splits while keeping AI/settings panels and floating documents intact", () => {
    const first = TabWorkspace.open(new DocumentTestTab({}));
    const second = TabWorkspace.open(new DocumentTestTab({}));
    const third = TabWorkspace.open(new DocumentTestTab({}));
    const floating = TabWorkspace.open(new DocumentTestTab({}));
    TabWorkspace.float(floating.id);
    TabWorkspace.split(second.id, "right");
    TabWorkspace.focus(first.id);
    TabWorkspace.split(third.id, "bottom");
    const ai = TabWorkspace.create({ title: "AI", layout: "docked", splitEdge: "right" });
    const aiGroup = getTabGroups(store.get(tabGroupRootAtom)).find((g) => g.tabIds.includes(ai.id))!;
    expect(TabWorkspace.mergeDocumentGroups(second.id)).toBe(true);
    const groups = getTabGroups(store.get(tabGroupRootAtom));
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.id === aiGroup.id)?.tabIds).toEqual([ai.id]);
    expect(groups.flatMap((g) => g.tabIds).sort()).toEqual([first.id, second.id, third.id, ai.id].sort());
    expect(floating.layout).toBe("floating");
    expect(store.get(activeResourceTabAtom)).toBe(second);
    expect(TabWorkspace.canMergeDocumentGroups(ai.id)).toBe(false);
  });
});
