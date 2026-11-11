import { developmentRevision } from "./development-revision";

export type WindowRuntime = {
  revision: string;
  commands: { id: string; key: string; enabled: boolean }[];
  extensions: { id: string; hash: string }[];
};

export function compareWindowRuntimes(expected: WindowRuntime, actual: WindowRuntime): string | undefined {
  if (expected.revision !== actual.revision) return "新窗口与原窗口加载的代码批次不同";
  if (expected.extensions.length !== actual.extensions.length || expected.extensions.some((extension, i) => {
    const other = actual.extensions[i];
    return extension.id !== other.id || extension.hash !== other.hash;
  })) return "新窗口的扩展与原窗口不一致";
  if (expected.commands.length !== actual.commands.length || expected.commands.some((command, i) => {
    const other = actual.commands[i];
    return command.id !== other.id || command.key !== other.key || command.enabled !== other.enabled;
  }))
    return "新窗口的功能命令或快捷键配置与原窗口不一致";
}

export async function ensureCurrentDevelopmentRevision(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.LR_PG_DEVELOPMENT_SESSION !== "1") return;
  const response = await fetch("/__pg_development/status", { cache: "no-store" });
  if (!response.ok) throw new Error("无法核对开发版代码批次，已保留原窗口");
  const status = await response.json();
  if (status.revision !== developmentRevision)
    throw new Error("当前窗口尚未加载最新开发更新，请先同步开发版；已阻止创建功能不一致的新窗口");
}

export async function captureWindowRuntime(): Promise<WindowRuntime> {
  await ensureCurrentDevelopmentRevision();
  const [{ ExtensionManager }, { KeyBindsUI }] = await Promise.all([
    import("./core/extension/ExtensionManager"),
    import("./core/service/controlService/shortcutKeysEngine/KeyBindsUI"),
  ]);
  await KeyBindsUI.registerAllUIKeyBinds();
  const extensions = await ExtensionManager.runtimeSignatures();
  const commands = KeyBindsUI.getAllUIKeyBinds()
    .map((command) => ({
      id: command.id,
      key: command.key,
      enabled: command.isEnabled,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { revision: developmentRevision, commands, extensions };
}
