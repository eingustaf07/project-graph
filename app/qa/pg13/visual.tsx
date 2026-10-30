import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "jotai";
import "@/css/index.css";
import RenderOverlays from "@/components/overlay-host";
import DockedArea from "@/components/docked-area";
import { store, tabsAtom, tabGroupRootAtom } from "@/state";
import { Tab } from "@/core/Tab";
import { TabWorkspace } from "@/core/TabWorkspace";
import { getTabGroups } from "@/core/TabGroup";
import { CopyEngine } from "@/core/service/dataManageService/copyEngine/copyEngine";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { TextRenderer } from "@/core/render/canvas2d/basicRenderer/textRenderer";
import { ShapeRenderer } from "@/core/render/canvas2d/basicRenderer/shapeRenderer";
import { TextNodeRenderer } from "@/core/render/canvas2d/entityRenderer/textNode/TextNodeRenderer";
import { Vector, Color } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { serialize } from "@graphif/serializer";

let current: DocumentTab;
class DocumentTab extends Tab {
  readonly uri: string;
  readonly project: any;
  component: React.ComponentType;
  constructor(
    readonly name: string,
    withTree: boolean,
  ) {
    super({});
    this.uri = `draft:${name}`;
    const p: any = (this.project = {
      stage: [],
      attachments: new Map(),
      emit() {},
      effects: { addEffect() {} },
      camera: { currentScale: 0.8 },
      renderer: {
        transformView2World: (v: Vector) => v.divide(0.8),
        transformWorld2View: (v: Vector) => v.multiply(0.8),
      },
      autoComputeUtils: { isNameIsLogicNode: () => false },
      keyboardOnlyEngine: { isOpenning: () => false },
      collisionBoxRenderer: { render() {} },
      syncAssociationManager: { getSyncAssociationsByObject: () => [], getSyncSiblings: () => [] },
      stageStyleManager: {
        currentStyle: { Background: new Color(20, 20, 20), StageObjectBorder: new Color(185, 210, 210) },
      },
      controller: { pressingKeySet: new Set() },
      addAttachment(blob: Blob) {
        const id = crypto.randomUUID();
        this.attachments.set(id, blob);
        return id;
      },
    });
    p.textRenderer = new TextRenderer(p);
    p.shapeRenderer = new ShapeRenderer(p);
    p.stageManager = new StageManager(p);
    p.sectionMethods = new SectionMethods(p);
    p.copyEngine = new CopyEngine(p);
    if (withTree) {
      const labels = ["原始节点树", "保留文字与样式", "多行节点仍受最大宽度约束".repeat(3)];
      labels.forEach((text, i) => {
        const n = new TextNode(p, { text });
        n.collisionBox.updateShapeList([
          new Rectangle(new Vector(i ? 390 : 50, i === 2 ? 300 : 60), n.rectangle.size.clone()),
        ]);
        n.isSelected = true;
        p.stage.push(n);
      });
      p.stage.push(
        ...p.stage.slice(1).map((target: TextNode) => new LineEdge(p, { associationList: [p.stage[0], target] })),
      );
    }
    p.historyManager = new HistoryManager(p);
    this.component = () => <Graph tab={this} />;
  }
  get title() {
    return this.name;
  }
  getComponent() {
    return this.component;
  }
}
function draw(tab: DocumentTab, canvas: HTMLCanvasElement) {
  const p = tab.project;
  const ctx = canvas.getContext("2d")!;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  p.canvas = { ctx, width: canvas.width, height: canvas.height };
  p.renderer.w = canvas.width;
  p.renderer.h = canvas.height;
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const edge of p.stage.filter((n: unknown) => n instanceof LineEdge)) {
    const a = p.renderer.transformWorld2View(edge.bodyLine.start),
      b = p.renderer.transformWorld2View(edge.bodyLine.end);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "#89979c";
    ctx.stroke();
  }
  const renderer = new TextNodeRenderer(p);
  for (const n of p.stage.filter((n: unknown) => n instanceof TextNode)) renderer.renderTextNode(n);
}
function Graph({ tab }: { tab: DocumentTab }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const redraw = () => draw(tab, canvas);
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    window.addEventListener("qa-redraw", redraw);
    redraw();
    return () => {
      observer.disconnect();
      window.removeEventListener("qa-redraw", redraw);
    };
  }, [tab]);
  return (
    <canvas
      ref={ref}
      data-document={tab.name}
      style={{ width: "100%", height: "100%" }}
      onPointerDown={() => {
        current = tab;
        TabWorkspace.focus(tab.id);
      }}
    />
  );
}
const first = TabWorkspace.open(new DocumentTab("源文件.prg", true));
const second = TabWorkspace.open(new DocumentTab("目标文件.prg", false));
current = first;
TabWorkspace.focus(first.id);
MouseLocation.init();
document.addEventListener("keydown", async (event) => {
  if (
    document.querySelector('[role="dialog"]') ||
    ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "")
  )
    return;
  if (event.ctrlKey && ["c", "v", "z", "y"].includes(event.key.toLowerCase())) {
    event.preventDefault();
    if (event.key.toLowerCase() === "c") await current.project.copyEngine.copy();
    if (event.key.toLowerCase() === "v") await current.project.copyEngine.paste();
    if (event.key.toLowerCase() === "z") current.project.historyManager.undo();
    if (event.key.toLowerCase() === "y") current.project.historyManager.redo();
    window.dispatchEvent(new Event("qa-redraw"));
  }
});
Object.assign(window, {
  pg13QA: {
    first,
    second,
    focus(id: string) {
      current = [first, second].find((tab) => tab.id === id)!;
      TabWorkspace.focus(id);
    },
    groups: () => getTabGroups(store.get(tabGroupRootAtom)),
    snapshot: (id: string) => serialize([first, second].find((tab) => tab.id === id)!.project.stage),
    center: (id: string) => {
      const nodes = [first, second]
        .find((tab) => tab.id === id)!
        .project.stage.filter((n: unknown) => n instanceof Entity);
      return Rectangle.getBoundingRectangle(nodes.map((n: Entity) => n.collisionBox.getRectangle())).center;
    },
    instancesIntact: () => store.get(tabsAtom).includes(first) && store.get(tabsAtom).includes(second),
  },
});
createRoot(document.getElementById("root")!).render(
  <Provider store={store}>
    <DockedArea
      onTabClick={(tab) => {
        current = tab as DocumentTab;
        TabWorkspace.focus(tab.id);
      }}
      onTabClose={() => {}}
      isClassroomMode={false}
    />
    <RenderOverlays />
  </Provider>,
);
