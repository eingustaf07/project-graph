import { Project } from "@/core/Project";
import { onNewDraft, onOpenFile } from "@/core/service/GlobalMenu";
import {
  activeResourceTabAtom,
  activeTabAtom,
  activeGroupIdAtom,
  tabGroupRootAtom,
  nextProjectIdAtom,
  store,
  tabsAtom,
} from "@/state";
import { deserialize, serialize } from "@graphif/serializer";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";
import { URI } from "vscode-uri";
import { toast } from "sonner";
import type { TabGroupNode } from "@/core/TabGroup";

function captureSession() {
  const projects = store.get(tabsAtom).filter((tab): tab is Project => tab instanceof Project && !tab.closing);
  if (projects.some((p) => p.isCollab)) throw new Error("协作中的工程需要先退出协作，才能应用开发更新");
  return {
    active: store.get(activeResourceTabAtom)?.id,
    activeGroup: store.get(activeGroupIdAtom),
    nextProjectId: store.get(nextProjectIdAtom),
    groups: structuredClone(store.get(tabGroupRootAtom)),
    projects: projects.map((p) => ({
      id: p.id,
      uri: p.uri.toString(),
      state: p.projectState,
      stage: serialize(p.stage),
      attachments: [...p.attachments],
      tags: structuredClone(p.tags),
      references: structuredClone(p.references),
      metadata: structuredClone(p.metadata),
      readme: p.readme,
      history: p.historyManager.developmentSnapshot(),
      selection: p.stage.filter((n) => n.isSelected).map((n) => n.uuid),
      camera: { x: p.camera.location.x, y: p.camera.location.y, scale: p.camera.currentScale },
      layout: p.layout,
      floatingRect: serialize(p.floatingRect),
      zIndex: p.zIndex,
    })),
  };
}
type Snapshot = ReturnType<typeof captureSession>;

async function sessionStore(mode: "readwrite" | "readonly", value?: Snapshot | null): Promise<Snapshot | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("pg-development-session", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("session");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("session", mode),
        storage = tx.objectStore("session");
      const request =
        mode === "readonly"
          ? storage.get("pending")
          : value
            ? storage.put(value, "pending")
            : storage.delete("pending");
      tx.oncomplete = () => resolve(mode === "readonly" ? (request.result as Snapshot | undefined) : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("开发会话保存被中断"));
    });
  } finally {
    db.close();
  }
}

let applying = false;
export async function applyDevelopmentUpdate(restartShell = false) {
  if (applying) return;
  applying = true;
  const projects = store.get(tabsAtom).filter((tab): tab is Project => tab instanceof Project);
  while (projects.some((p) => p.controller.isMouseDown.some(Boolean))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const overlay = document.createElement("div");
  overlay.textContent = "正在保留当前工程并应用开发更新…";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:#161616ee;color:white;display:grid;place-items:center";
  const blockKeys = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", blockKeys, true);
  document.body.append(overlay);
  try {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    projects.forEach((p) => p.pause());
    await sessionStore("readwrite", captureSession());
    await Promise.all(projects.map((p) => p.dispose()));
    if (restartShell) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("exit", { code: 0 });
    } else location.reload();
  } catch (error) {
    projects.forEach((p) => p.loop());
    toast.error(`开发更新未应用：${String(error)}`);
    applying = false;
    overlay.remove();
    window.removeEventListener("keydown", blockKeys, true);
  }
}

export async function restoreDevelopmentSession(): Promise<boolean> {
  const snapshot = await sessionStore("readonly");
  if (!snapshot) return false;
  const ids = new Map<string, string>();
  for (const saved of snapshot.projects) {
    const uri = URI.parse(saved.uri);
    const p = uri.scheme === "draft" ? await onNewDraft() : await onOpenFile(uri, "开发更新恢复");
    if (!p) throw new Error(`未能恢复开发会话中的工程 ${saved.uri}`);
    if (uri.scheme === "draft") p.uri = uri;
    await Promise.all(p.stage.map((n) => n.dispose?.()));
    p.attachments.clear();
    saved.attachments.forEach(([id, blob]) => p.attachments.set(id, blob));
    p.stage = deserialize(saved.stage, p);
    p.tags = saved.tags;
    p.references = saved.references;
    p.metadata = saved.metadata;
    p.readme = saved.readme;
    p.stageManager.updateReferences();
    p.historyManager.restoreDevelopmentSnapshot(saved.history);
    p.projectState = saved.state;
    const selected = new Set(saved.selection);
    p.stage.forEach((n) => {
      n.isSelected = selected.has(n.uuid);
    });
    p.camera.location = new Vector(saved.camera.x, saved.camera.y);
    p.camera.currentScale = p.camera.targetScale = saved.camera.scale;
    p.layout = saved.layout;
    p.floatingRect = deserialize(saved.floatingRect) as Rectangle;
    p.zIndex = saved.zIndex;
    ids.set(saved.id, p.id);
  }
  const remapGroups = (group: TabGroupNode | null): TabGroupNode | null => {
    if (!group) return null;
    if (group.type === "split")
      return { ...group, children: group.children.map((g) => remapGroups(g)!) as [TabGroupNode, TabGroupNode] };
    return {
      ...group,
      tabIds: group.tabIds.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : [])),
      activeTabId: group.activeTabId ? ids.get(group.activeTabId) : undefined,
    };
  };
  store.set(tabGroupRootAtom, remapGroups(snapshot.groups));
  store.set(activeGroupIdAtom, snapshot.activeGroup);
  store.set(nextProjectIdAtom, snapshot.nextProjectId);
  const active = store.get(tabsAtom).find((p) => p.id === ids.get(snapshot.active ?? ""));
  if (active instanceof Project) {
    store.set(activeTabAtom, active);
    store.set(activeResourceTabAtom, active);
  }
  await sessionStore("readwrite", null);
  return true;
}

export async function markDevelopmentReady() {
  const response = await fetch("/__pg_development/ready", { method: "POST" });
  if (!response.ok) throw new Error("无法确认开发更新状态");
}

if (import.meta.hot) {
  import.meta.hot.on("pg:apply-development", applyDevelopmentUpdate);
  import.meta.hot.dispose(() => import.meta.hot?.off("pg:apply-development", applyDevelopmentUpdate));
}
