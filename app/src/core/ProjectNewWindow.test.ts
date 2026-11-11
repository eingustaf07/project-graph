// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Vector } from "@graphif/data-structures";
import { URI } from "vscode-uri";

const calls = vi.hoisted(() => ({
  invoke: vi.fn(), close: vi.fn(), open: vi.fn(), error: vi.fn(),
  runtime: vi.fn(), compare: vi.fn(),
}));
vi.mock("@/development-runtime", () => ({ captureWindowRuntime: calls.runtime, compareWindowRuntimes: calls.compare }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: calls.invoke }));
vi.mock("./TabWorkspace", () => ({ TabWorkspace: { close: calls.close } }));
vi.mock("./service/GlobalMenu", () => ({ onOpenFile: calls.open }));
vi.mock("sonner", () => ({ toast: { error: calls.error } }));
vi.mock("./Project", () => ({ Project: class {} }));
import { showProjectInNewWindow, restoreDetachedProject } from "./ProjectNewWindow";
import type { Project } from "./Project";

function project() {
  return {
    id: "file-1", closing: false, isCollab: false, uri: URI.file("D:/交易/思考草稿.prg"),
    save: vi.fn().mockResolvedValue(undefined),
    historyManager: {
      developmentSnapshot: vi.fn(() => ({ memory: { currentIndex: 2 }, time: { currentIndex: 3 } })),
      restoreDevelopmentSnapshot: vi.fn(),
    },
    camera: { location: new Vector(10, 20), currentScale: 0.3, targetScale: 0.3 },
    stage: [{ uuid: "selected", isSelected: true }, { uuid: "other", isSelected: false }],
  } as unknown as Project;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  calls.invoke.mockResolvedValue(undefined);
  calls.close.mockResolvedValue(undefined);
  calls.runtime.mockResolvedValue({ revision: "source-revision-1", commands: [], extensions: [] });
});
afterEach(() => { vi.unstubAllGlobals(); });
it("saves before releasing the source tab and transfers view, selection and history", async () => {
  const p = project();
  await showProjectInNewWindow(p);
  expect(p.save).toHaveBeenCalledWith({ includeThumbnail: false });
  expect(calls.close).toHaveBeenCalledWith(p.id);
  expect(vi.mocked(p.save).mock.invocationCallOrder[0]).toBeLessThan(calls.close.mock.invocationCallOrder[0]);
  expect(calls.close.mock.invocationCallOrder[0]).toBeLessThan(calls.invoke.mock.invocationCallOrder[0]);
  expect(calls.invoke).toHaveBeenCalledWith("open_project_in_new_window", {
    session: expect.objectContaining({ path: p.uri.fsPath, selection: ["selected"], camera: { x: 10, y: 20, scale: 0.3 } }),
  });
  expect(document.body.textContent).not.toContain("正在将文件移至新窗口");
});
it("leaves the source tab open when saving is cancelled or fails", async () => {
  const p = project();
  vi.mocked(p.save).mockRejectedValue(new Error("未选择路径"));
  await showProjectInNewWindow(p);
  expect(calls.close).not.toHaveBeenCalled();
  expect(calls.invoke).not.toHaveBeenCalled();
  expect(calls.error).toHaveBeenCalled();
});
it("reopens the saved original with history and view when the new window fails", async () => {
  const p = project(), restored = project();
  calls.invoke.mockRejectedValue(new Error("加载失败"));
  calls.open.mockResolvedValue(restored);
  await showProjectInNewWindow(p);
  expect(calls.open).toHaveBeenCalledWith(p.uri, "新窗口打开失败恢复");
  expect(restored.historyManager.restoreDevelopmentSnapshot).toHaveBeenCalledWith(p.historyManager.developmentSnapshot());
  expect(restored.camera.location).toEqual(new Vector(10, 20));
  expect(calls.error).toHaveBeenCalled();
});
it("restores only the transferred file and acknowledges after restoring history", async () => {
  const p = project();
  calls.open.mockResolvedValue(p);
  const session = {
    path: p.uri.fsPath, history: p.historyManager.developmentSnapshot(),
    camera: { x: 100, y: 200, scale: 0.7 }, selection: ["other"],
  };
  await restoreDetachedProject(session);
  expect(p.camera.location).toEqual(new Vector(100, 200));
  expect(p.stage.map((n) => n.isSelected)).toEqual([false, true]);
  expect(calls.invoke).toHaveBeenCalledWith("finish_detached_project_window", { error: null });
});
it("reports child-load failure to the parent instead of acknowledging success", async () => {
  const p = project();
  calls.open.mockResolvedValue(undefined);
  await expect(restoreDetachedProject({
    path: p.uri.fsPath, history: p.historyManager.developmentSnapshot(),
    camera: { x: 0, y: 0, scale: 1 }, selection: [],
  })).rejects.toThrow("新窗口未能打开工程");
  expect(calls.invoke).toHaveBeenCalledWith("finish_detached_project_window", { error: expect.any(String) });
});
it("rejects a child with different code or extensions before opening the transferred project", async () => {
  const p = project();
  calls.compare.mockReturnValue("新窗口与原窗口加载的代码批次不同");
  await expect(restoreDetachedProject({ path: p.uri.fsPath,
    history: p.historyManager.developmentSnapshot(), camera: { x: 0, y: 0, scale: 1 }, selection: [],
    runtime: { revision: "old-source", commands: [], extensions: [] },
  })).rejects.toThrow("代码批次不同");
  expect(calls.open).not.toHaveBeenCalled();
  expect(calls.invoke).toHaveBeenCalledWith("finish_detached_project_window", { error: expect.stringContaining("代码批次不同") });
});
it("does not close or save the source tab while its runtime revision is stale", async () => {
  const p = project();
  calls.runtime.mockRejectedValue(new Error("当前窗口尚未加载最新开发更新"));
  await showProjectInNewWindow(p);
  expect(p.save).not.toHaveBeenCalled();
  expect(calls.close).not.toHaveBeenCalled();
  expect(calls.invoke).not.toHaveBeenCalled();
});
