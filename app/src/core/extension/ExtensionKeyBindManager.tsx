import { parseSingleEmacsKey, transEmacsKeyWinToMac } from "@/utils/emacs";
import { isMac } from "@/utils/platform";
import { createStore } from "@/utils/store";
import type { Project } from "@/core/Project";
import { KeyBindsUI, type KeyBindIcon } from "../service/controlService/shortcutKeysEngine/KeyBindsUI";

export interface ExtensionKeyBindRegisterOptions {
  id: string;
  defaultKey: string;
  onPress: () => void;
  onRelease?: () => void;
  isContinuous?: boolean;
  icon?: KeyBindIcon;
}

/**
 * 专门管理扩展注入的快捷键
 */
export namespace ExtensionKeyBindManager {
  function keepTaskStatusSelection(onPress: () => void, key: string) {
    return async (project?: Project) => {
      const selected = new Set(project?.stage.filter((object) => object.isSelected));
      if (!project || !selected.size) return onPress();
      const selectedIds = new Set([...selected].map((object) => object.uuid).filter((id) => typeof id === "string"));
      const lastKey = parseSingleEmacsKey(key.trim().split(/\s+/).at(-1) ?? "").key;
      let interrupted = false;
      const interruptPointer = (event: PointerEvent) => {
        if (event.button !== undefined && event.button !== 0) return;
        interrupted = true;
      };
      const interruptKey = (event: KeyboardEvent) => {
        const pressed = event.key?.toLowerCase();
        if (["shift", "control", "alt", "meta"].includes(pressed)) return;
        if (pressed === "tab" && (event.altKey || event.ctrlKey || event.metaKey)) return;
        if (event.repeat && pressed === lastKey) return;
        interrupted = true;
      };
      if (typeof window !== "undefined") {
        window.addEventListener("pointerdown", interruptPointer, true);
        window.addEventListener("keydown", interruptKey, true);
      }
      try {
        await onPress();
      } finally {
        if (typeof window !== "undefined") {
          window.removeEventListener("pointerdown", interruptPointer, true);
          window.removeEventListener("keydown", interruptKey, true);
        }
        // The task extension selects its next pinned task after updating status.
        // Restore only this command's selection, never a subsequent user action.
        if (!interrupted && !project.closing) {
          for (const object of project.stage) object.isSelected = selected.has(object) || selectedIds.has(object.uuid);
          project.searchContentHighlightRenderer?.invalidateSelection();
          project.controller.resetCountdownTimer();
        }
      }
    };
  }

  /**
   * 注册扩展快捷键
   * @param extensionId 扩展ID
   * @param options 快捷键注册选项
   */
  export async function register(extensionId: string, options: ExtensionKeyBindRegisterOptions) {
    const fullId = `ext:${extensionId}:${options.id}`;
    const store = await createStore("keybinds2.json");

    // 尝试从存储中获取用户配置
    const savedData = await store.get<any>(fullId);
    let key: string;
    let isEnabled: boolean;

    if (!savedData) {
      key = isMac ? transEmacsKeyWinToMac(options.defaultKey) : options.defaultKey;
      isEnabled = true;
      // 首次注册保存到配置中，这样设置页面就能看到了
      await store.set(fullId, { key, isEnabled });
      await store.save();
    } else {
      key = savedData.key;
      isEnabled = savedData.isEnabled !== false;
    }

    KeyBindsUI.registerOneUIKeyBind(
      fullId,
      key,
      isEnabled,
      extensionId === "com.mingliang.insert-node" && options.id === "edge-split-q"
        ? async (project) => {
            if (!project) return;
            const { splitSelectedExtensionEdge } = await import("./edgeSplit");
            await splitSelectedExtensionEdge(project);
          }
        : ["com.enterhalf.task-arrange", "text-node-todolist"].includes(extensionId) &&
            ["smartOKK", "smartERR"].includes(options.id)
          ? keepTaskStatusSelection(options.onPress, key)
          : options.onPress,
      options.onRelease,
      options.isContinuous,
      undefined,
      options.icon,
    );
  }

  /**
   * 注销某个扩展的所有快捷键
   * 通常在扩展禁用或卸载时调用
   */
  export function unregisterAll(extensionId: string) {
    const prefix = `ext:${extensionId}:`;
    const allBinds = KeyBindsUI.getAllUIKeyBinds();
    for (const kb of allBinds) {
      if (kb.id.startsWith(prefix)) {
        KeyBindsUI.unregisterOneUIKeyBind(kb.id);
      }
    }
  }
}
