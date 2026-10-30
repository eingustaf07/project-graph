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
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { TextRenderer } from "@/core/render/canvas2d/basicRenderer/textRenderer";
import { ShapeRenderer } from "@/core/render/canvas2d/basicRenderer/shapeRenderer";
import { TextNodeRenderer } from "@/core/render/canvas2d/entityRenderer/textNode/TextNodeRenderer";
import { ImageRenderer } from "@/core/render/canvas2d/basicRenderer/ImageRenderer";
import { DeleteManager } from "@/core/stage/stageManager/concreteMethods/StageDeleteManager";
import { ControllerImageScaleClass } from "@/core/service/controlService/controller/concrete/ControllerImageScale";
import { Vector, Color } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { serialize, deserialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";

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
      syncAssociationManager: {
        getSyncAssociationsByObject: () => [],
        getSyncSiblings: () => [],
        onStageObjectDeleted() {},
      },
      stageStyleManager: {
        currentStyle: { Background: new Color(20, 20, 20), StageObjectBorder: new Color(185, 210, 210) },
      },
      controller: { pressingKeySet: new Set(), resetCountdownTimer() {} },
      loop() {},
      addAttachment(blob: Blob) {
        const id = crypto.randomUUID();
        this.attachments.set(id, blob);
        return id;
      },
    });
    p.textRenderer = new TextRenderer(p);
    p.shapeRenderer = new ShapeRenderer(p);
    p.stageManager = new StageManager(p);
    p.deleteManager = new DeleteManager(p);
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
  p.canvas = { ctx, width: canvas.width, height: canvas.height, element: canvas };
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
  const images = new ImageRenderer(p);
  for (const node of p.stage.filter((n: unknown) => n instanceof ImageNode)) {
    if (node.state === "success")
      images.renderImageElement(node.bitmap, p.renderer.transformWorld2View(node.rectangle.location), node.scale);
  }
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
    async imageSnapshot() {
      const p = second.project;
      const result = [];
      for (const node of p.stage.filter((n: unknown) => n instanceof ImageNode)) {
        await node.waitForClipboardBitmap();
        const canvas = document.createElement("canvas");
        canvas.width = node.bitmap.width;
        canvas.height = node.bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(node.bitmap, 0, 0);
        result.push({
          id: node.uuid,
          center: node.rectangle.center,
          width: node.bitmap.width,
          height: node.bitmap.height,
          firstPixel: [...ctx.getImageData(2, 2, 1, 1).data],
          transparentPixel: [...ctx.getImageData(canvas.width - 2, canvas.height - 2, 1, 1).data],
          attachmentBytes: p.attachments.get(node.attachmentId)?.size,
        });
      }
      return result;
    },
    async imageNodeOperations() {
      const p = second.project;
      const image = p.stage.find((node: unknown) => node instanceof ImageNode) as ImageNode;
      p.stageManager.clearSelectAll();
      image.isSelected = true;
      const original = image.rectangle.location.clone();
      image.move(new Vector(40, 25));
      const moved = image.rectangle.location.subtract(original);
      p.controller.pressingKeySet.add("control");
      const scaler = new ControllerImageScaleClass(p);
      const point = p.renderer.transformWorld2View(image.rectangle.center);
      const beforeScale = image.scale;
      scaler.mousewheel(new WheelEvent("wheel", { clientX: point.x, clientY: point.y, deltaY: -100 }));
      scaler.dispose();
      p.controller.pressingKeySet.clear();
      const scaled = image.scale > beforeScale;
      const target = new TextNode(p, { text: "图片也能连线" });
      p.stageManager.add(target);
      const edge = new LineEdge(p, { associationList: [image, target] });
      p.stageManager.add(edge);
      p.historyManager.recordStep();
      const linked = edge.source === image && edge.target === target;
      await p.copyEngine.copy("nodes");
      const beforePaste = p.stage.length;
      await p.copyEngine.paste();
      const copied = p.stage.slice(beforePaste).find((node: unknown) => node instanceof ImageNode) as ImageNode;
      const copiedCorrectly = !!copied && copied.uuid !== image.uuid && copied.attachmentId !== image.attachmentId;
      const count = p.stage.length;
      p.stageManager.deleteEntities([image]);
      const deleted = !p.stage.includes(image) && !p.stage.includes(edge);
      p.historyManager.undo();
      const undone = p.stage.length === count && !!p.stageManager.get(image.uuid);
      p.historyManager.redo();
      const redone = !p.stageManager.get(image.uuid);
      window.dispatchEvent(new Event("qa-redraw"));
      return { moved, scaled, linked, copiedCorrectly, deleted, undone, redone };
    },
    async reloadImagesFromMsgpack() {
      const p = second.project;
      const saved = new Encoder().encode(serialize(p.stage));
      await Promise.all(p.stage.filter((n: unknown) => n instanceof ImageNode).map((n: ImageNode) => n.dispose()));
      p.stage = deserialize(decode(saved), p);
      p.stageManager.updateReferences();
      await Promise.all(
        p.stage.filter((n: unknown) => n instanceof ImageNode).map((n: ImageNode) => n.waitForClipboardBitmap()),
      );
      window.dispatchEvent(new Event("qa-redraw"));
    },
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
