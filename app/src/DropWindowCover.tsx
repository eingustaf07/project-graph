import { cn } from "./utils/cn";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { DragFileIntoStageEngine } from "./core/service/dataManageService/dragFileIntoStageEngine/dragFileIntoStageEngine";
import { Project } from "./core/Project";
import { store, tabsAtom } from "./state";
import { TextNode } from "./core/stage/stageObject/entity/TextNode";
import { CollisionBox } from "./core/stage/stageObject/collisionBox/collisionBox";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

interface PgDragDropPayload {
  kind: "enter" | "over" | "leave" | "drop";
  paths: string[];
  text: string | null;
  x: number;
  y: number;
}

/**
 * 拖拽鼠标进入舞台时，覆盖一个提示区域
 * 用于提示用户在不同位置释放有不同的效果
 */
export const DropWindowCover = ({ project }: { project: Project }) => {
  const fadeOutMs = 700;
  const [dropMouseLocation, setDropMouseLocation] = useState<"top" | "middle" | "bottom" | "notInWindowZone">(
    "notInWindowZone",
  );
  const [isFadingOut, setIsFadingOut] = useState(false);
  const isDraft = project.isDraft;
  const currentProject = useRef(project);
  useLayoutEffect(() => {
    currentProject.current = project;
  }, [project]);

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const cancelAnimation = () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      hideTimerRef.current = null;
      rafRef.current = null;
    };

    const onDropEvent = (payload: PgDragDropPayload) => {
      const scaleFactor = window.devicePixelRatio;
      const logicalHeight = window.innerHeight * scaleFactor;
      const getDropLocation = (y: number) =>
        y <= logicalHeight / 3 ? "top" : y <= (logicalHeight / 3) * 2 ? "middle" : "bottom";

      if (payload.kind === "enter") {
        cancelAnimation();
        setIsFadingOut(false);
        setDropMouseLocation(getDropLocation(payload.y));
      } else if (payload.kind === "over") {
        cancelAnimation();
        setIsFadingOut(false);
        setDropMouseLocation(getDropLocation(payload.y));
      } else if (payload.kind === "leave") {
        cancelAnimation();
        setIsFadingOut(false);
        setDropMouseLocation("notInWindowZone");
      } else if (payload.kind === "drop") {
        cancelAnimation();
        const dropLocation = getDropLocation(payload.y);
        setIsFadingOut(false);
        setDropMouseLocation(dropLocation);
        rafRef.current = requestAnimationFrame(() => {
          setIsFadingOut(true);
        });
        hideTimerRef.current = setTimeout(() => {
          setDropMouseLocation("notInWindowZone");
          setIsFadingOut(false);
        }, fadeOutMs);

        const x = payload.x / scaleFactor;
        const y = payload.y / scaleFactor;
        const hit = document.elementFromPoint(x, y);
        const canvasProject = store
          .get(tabsAtom)
          .find((tab): tab is Project => tab instanceof Project && !!hit && tab.canvas?.element === hit);
        const target = canvasProject ?? currentProject.current;
        const point = canvasProject?.renderer.transformView2World(canvasProject.canvas.clientToView(x, y));
        if (payload.text?.trim() && canvasProject && point) {
          const textNode = new TextNode(canvasProject, {
            text: payload.text,
            collisionBox: new CollisionBox([new Rectangle(point, Vector.getZero())]),
          });
          canvasProject.stageManager.add(textNode);
          canvasProject.historyManager.recordStep();
        } else if (payload.paths.length > 0) {
          if (dropLocation === "top") {
            void DragFileIntoStageEngine.handleDrop(target, payload.paths, point);
          } else if (dropLocation === "middle") {
            void DragFileIntoStageEngine.handleDropFileRelativePath(target, payload.paths);
          } else {
            void DragFileIntoStageEngine.handleDropFileAbsolutePath(target, payload.paths);
          }
        }
      }
    };
    const nativeListener = listen<PgDragDropPayload>("pg-drag-drop", ({ payload }) => onDropEvent(payload));
    // Keep the original file handler for windows using Tauri's default drop target.
    const fileListener = getCurrentWindow().onDragDropEvent(({ payload }) => {
      onDropEvent({
        kind: payload.type,
        paths: "paths" in payload ? payload.paths : [],
        text: null,
        x: "position" in payload ? payload.position.x : 0,
        y: "position" in payload ? payload.position.y : 0,
      });
    });

    return () => {
      cancelAnimation();
      for (const listener of [nativeListener, fileListener]) listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 left-0 z-5 flex h-screen w-full flex-col transition-opacity duration-700 ease-out",
        dropMouseLocation === "notInWindowZone" ? "opacity-0" : isFadingOut ? "opacity-0" : "opacity-100",
      )}
    >
      <div
        className={cn(
          "bg-card/80 flex flex-1 flex-col items-center justify-center text-xl",
          dropMouseLocation === "top" && "text-destructive bg-transparent",
        )}
      >
        <p>拖拽到这里：追加到舞台</p>
        <span className="text-sm">
          如果是图片文件（png/jpg/jpeg/webp）或音视频文件，则追加到舞台，如果是prg工程文件，则打开标签页
        </span>
      </div>
      <div
        className={cn(
          "bg-card/80 flex flex-1 flex-col items-center justify-center text-xl",
          dropMouseLocation === "middle" && !isDraft && "text-destructive bg-transparent",
          isDraft && "cursor-not-allowed opacity-40",
        )}
      >
        <p>
          拖拽到这里：以 <span className="text-3xl">相对路径</span> 生成文本节点到舞台
        </p>
        {isDraft && <span className="text-sm">（草稿文件无路径，无法使用相对路径）</span>}
      </div>
      <div
        className={cn(
          "bg-card/80 flex flex-1 flex-col items-center justify-center text-xl",
          dropMouseLocation === "bottom" && "text-destructive bg-transparent",
        )}
      >
        <p>
          拖拽到这里：以 <span className="text-3xl">绝对路径</span> 生成文本节点到舞台
        </p>

        <span className="text-sm">
          这样就可以构建外部文件链接，选中路径为内容的文本节点，直接调用系统默认方式打开此文件了
        </span>
      </div>
    </div>
  );
};
