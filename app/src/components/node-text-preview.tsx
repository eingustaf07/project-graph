import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Project } from "@/core/Project";

export function centerPreviewNode(project: Project, nodeId: string): boolean {
  const node = project.stageManager.getTextNodeByUUID(nodeId);
  if (!node || project.closing) return false;
  const center = node.collisionBox.getRectangle().center;
  project.camera.stopImmediately();
  project.camera.targetScale = project.camera.currentScale;
  project.camera.location = center.clone();
  project.camera.targetLocationByScale = center.clone();
  project.controller.resetCountdownTimer();
  return true;
}

export default function NodeTextPreview({
  items,
  onClose,
  onNavigate,
}: {
  items: { id: string; text: string }[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
}) {
  return createPortal(
    <aside
      aria-label="节点文字预览"
      className="pg-floating-surface pointer-events-auto fixed top-12 right-3 z-50 flex max-h-[54vh] w-72 max-w-[80vw] flex-col overflow-hidden border bg-(--stage-background) text-sm"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => {
        if ((event.target as Element).closest("button")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        const row = (event.target as Element).closest<HTMLElement>("[data-preview-node]");
        const nodeId = row?.dataset.previewNode ?? (items.length === 1 ? items[0].id : undefined);
        if (nodeId) onNavigate(nodeId);
      }}
    >
      <div className="border-primary/20 flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1">
        <div className="text-sm opacity-70">节点内容（{items.length}）</div>
        <button
          type="button"
          className="hover:bg-accent focus-visible:ring-ring flex size-8 shrink-0 cursor-pointer items-center justify-center rounded focus-visible:ring-2"
          aria-label="关闭节点文字预览"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
        <div className="divide-y">
          {items.map((item) => (
            <div
              key={item.id}
              data-preview-node={item.id}
              role="button"
              tabIndex={0}
              title="点击将此节点居中显示"
              className="hover:bg-accent cursor-pointer py-2 break-words whitespace-pre-wrap select-text"
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onNavigate(item.id);
              }}
            >
              {item.text}
            </div>
          ))}
        </div>
      </div>
    </aside>,
    document.body,
  );
}
