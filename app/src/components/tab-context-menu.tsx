import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tab } from "@/core/Tab";
import { TabWorkspace } from "@/core/TabWorkspace";
import { Project } from "@/core/Project";
import { showProjectInNewWindow } from "@/core/ProjectNewWindow";
import { isDesktop, isWeb } from "@/utils/platform";
import { AppWindowMac, Columns2, Dock, Rows2, X, PanelsTopLeft } from "lucide-react";
import React from "react";

export default function TabContextMenu({
  tab,
  children,
  onClose,
}: {
  tab: Tab;
  children: React.ReactElement;
  onClose?: (tab: Tab) => void | Promise<void>;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {isDesktop && !isWeb && tab instanceof Project && (
          <ContextMenuItem onSelect={() => void showProjectInNewWindow(tab)}>
            <AppWindowMac />
            在新窗口中显示
          </ContextMenuItem>
        )}
        {tab.layout === "docked" ? (
          <>
            <ContextMenuItem onSelect={() => TabWorkspace.split(tab.id, "right")}>
              <Columns2 />
              向右拆分
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => TabWorkspace.split(tab.id, "bottom")}>
              <Rows2 />
              向下拆分
            </ContextMenuItem>
            {TabWorkspace.canMergeDocumentGroups(tab.id) && (
              <ContextMenuItem onSelect={() => TabWorkspace.mergeDocumentGroups(tab.id)}>
                <PanelsTopLeft />
                合并文件分栏
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => TabWorkspace.float(tab.id)}>
              <AppWindowMac />
              浮动
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem disabled={!tab.canDock} onSelect={() => TabWorkspace.dock(tab.id)}>
            <Dock />
            停靠
          </ContextMenuItem>
        )}
        {tab.closable && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => void (onClose?.(tab) ?? TabWorkspace.close(tab.id))}>
              <X />
              关闭
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
