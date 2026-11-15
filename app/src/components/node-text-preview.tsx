import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function NodeTextPreview({
  items,
  onClose,
}: {
  items: { id: string; text: string }[];
  onClose: () => void;
}) {
  return createPortal(
    <aside
      aria-label="节点文字预览"
      className="pointer-events-auto fixed top-12 right-4 z-50 flex max-h-[60vh] w-80 max-w-[80vw] flex-col overflow-hidden rounded-lg border bg-(--stage-background) shadow-lg"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
        <div className="text-sm opacity-70">节点内容（{items.length}）</div>
        <button
          type="button"
          className="hover:bg-accent focus-visible:ring-ring flex size-8 shrink-0 cursor-pointer items-center justify-center rounded focus-visible:ring-2"
          aria-label="关闭节点文字预览"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="divide-y">
          {items.map((item) => (
            <div key={item.id} className="py-2 break-words whitespace-pre-wrap select-text">
              {item.text}
            </div>
          ))}
        </div>
      </div>
    </aside>,
    document.body,
  );
}
