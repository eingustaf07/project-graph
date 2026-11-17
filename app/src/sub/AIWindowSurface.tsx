import { Button } from "@/components/ui/button";
import { PortalContainerContext } from "@/components/ui/portal-container";
import { invoke } from "@tauri-apps/api/core";
import { isWeb } from "@/utils/platform";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

const SurfaceContext = createContext({ detached: false, open: () => {}, restore: () => {} });
export const useAIWindowSurface = () => useContext(SurfaceContext);

export function AIWindowSurface({ children, id }: { children: ReactNode; id: string }) {
  const home = useRef<HTMLDivElement>(null);
  const popup = useRef<Window | null>(null);
  const opening = useRef(false);
  const live = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.style.cssText = "width:100%;height:100%;min-height:0";
    return element;
  });
  const [portalTarget, setPortalTarget] = useState<HTMLElement>();

  function restore() {
    const child = popup.current;
    popup.current = null;
    cleanup.current();
    cleanup.current = () => {};
    home.current?.append(container);
    if (live.current) setPortalTarget(undefined);
    if (child && !child.closed) child.close();
  }

  async function open() {
    if (popup.current && !popup.current.closed) {
      popup.current.focus();
      return;
    }
    if (opening.current) return;
    opening.current = true;
    try {
      if (!isWeb && !(await invoke<boolean>("supports_ai_popup"))) {
        throw new Error("当前窗口程序不支持 AI 独立窗口，请部署完整的 3.1 开发版");
      }
      if (!live.current) return;
      const child = window.open("about:blank#pg-ai-popup", `pg-ai-${id}`, "popup,width=560,height=760");
      if (!child) throw new Error("未能创建 AI 独立窗口");
      popup.current = child;
      const target = child.document;
      const base = target.createElement("base");
      base.href = document.baseURI;
      target.head.append(base);
      target.title = "AI 助手 · Project Graph E";
      target.body.style.cssText = "margin:0;height:100vh;overflow:hidden";
      const styles: Node[] = [];
      const syncStyles = () => {
        styles.splice(0).forEach((node) => node.parentNode?.removeChild(node));
        document.head.querySelectorAll('style,link[rel="stylesheet"]').forEach((node) => {
          const clone = node.cloneNode(true);
          target.head.append(clone);
          styles.push(clone);
        });
        target.documentElement.className = document.documentElement.className;
        target.documentElement.style.cssText = document.documentElement.style.cssText;
        target.body.className = document.body.className;
        target.body.style.fontFamily = getComputedStyle(document.body).fontFamily;
      };
      syncStyles();
      const observer = new MutationObserver(syncStyles);
      observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
      observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
      const onClose = () => restore();
      child.addEventListener("pagehide", onClose);
      const timer = window.setInterval(() => {
        if (child.closed) restore();
      }, 500);
      cleanup.current = () => {
        observer.disconnect();
        clearInterval(timer);
        child.removeEventListener("pagehide", onClose);
      };
      // Move the existing portal container instead of remounting the chat or copying its project.
      target.body.append(container);
      setPortalTarget(target.body);
      child.focus();
    } catch (error) {
      restore();
      toast.error(`AI 独立窗口打开失败：${String(error)}`);
    } finally {
      opening.current = false;
    }
  }

  useEffect(() => {
    live.current = true;
    home.current?.append(container);
    return () => {
      live.current = false;
      restore();
      container.remove();
    };
  }, [container]);

  return (
    <SurfaceContext.Provider value={{ detached: !!portalTarget, open: () => void open(), restore }}>
      <div ref={home} className="h-full min-h-0">
        {portalTarget && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-sm">
            <span>AI 已在独立窗口中打开</span>
            <Button onClick={() => popup.current?.focus()}>显示 AI 窗口</Button>
            <Button variant="outline" onClick={restore}>
              移回主窗口
            </Button>
          </div>
        )}
      </div>
      {createPortal(
        <PortalContainerContext.Provider value={portalTarget}>{children}</PortalContainerContext.Provider>,
        container,
      )}
    </SurfaceContext.Provider>
  );
}
