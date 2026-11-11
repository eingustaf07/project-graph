import { invoke } from "@tauri-apps/api/core";
import { Vector } from "@graphif/data-structures";
import { toast } from "sonner";
import { Project } from "./Project";
import { TabWorkspace } from "./TabWorkspace";
import { onOpenFile } from "./service/GlobalMenu";

type DetachedProjectSession = {
  windowId?: string;
  path: string;
  history: ReturnType<Project["historyManager"]["developmentSnapshot"]>;
  camera: { x: number; y: number; scale: number };
  selection: string[];
};

const moving = new Set<string>();

function restoreView(project: Project, session: DetachedProjectSession) {
  project.historyManager.restoreDevelopmentSnapshot(session.history);
  project.camera.location = new Vector(session.camera.x, session.camera.y);
  project.camera.currentScale = project.camera.targetScale = session.camera.scale;
  const selected = new Set(session.selection);
  project.stage.forEach((object) => { object.isSelected = selected.has(object.uuid); });
}

export async function showProjectInNewWindow(project: Project) {
  if (moving.has(project.id) || project.closing) return;
  if (project.isCollab) {
    toast.error("请先退出协作，再在新窗口中显示");
    return;
  }
  moving.add(project.id);
  let session: DetachedProjectSession | undefined;
  let closed = false;
  const overlay = document.createElement("div");
  overlay.textContent = "正在将文件移至新窗口…";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#161616ee;color:white;display:grid;place-items:center";
  const blockInput = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  try {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    document.body.append(overlay);
    window.addEventListener("keydown", blockInput, true);
    await project.save({ includeThumbnail: false });
    session = {
      path: project.uri.fsPath,
      history: project.historyManager.developmentSnapshot(),
      camera: { x: project.camera.location.x, y: project.camera.location.y, scale: project.camera.currentScale },
      selection: project.stage.filter((object) => object.isSelected).map((object) => object.uuid),
    };
    await TabWorkspace.close(project.id);
    closed = true;
    await invoke("open_project_in_new_window", { session });
  } catch (error) {
    if (closed && session) {
      const restored = await onOpenFile(project.uri, "新窗口打开失败恢复");
      if (!restored) throw new Error("新窗口打开失败，文件已保存但未能恢复原标签", { cause: error });
      restoreView(restored, session);
    }
    toast.error("未能在新窗口中显示：" + String(error));
  } finally {
    window.removeEventListener("keydown", blockInput, true);
    overlay.remove();
    moving.delete(project.id);
  }
}

export async function getDetachedProjectSession() {
  const session = await invoke<DetachedProjectSession | null>("get_detached_project_session");
  if (session?.windowId) sessionStorage.setItem("pg-development-window-session", session.windowId);
  return session;
}

export async function restoreDetachedProject(session: DetachedProjectSession) {
  try {
    const project = await onOpenFile((await import("vscode-uri")).URI.file(session.path), "在新窗口中显示");
    if (!project) throw new Error("新窗口未能打开工程");
    restoreView(project, session);
    await invoke("finish_detached_project_window", { error: null });
  } catch (error) {
    await invoke("finish_detached_project_window", { error: String(error) });
    throw error;
  }
}
