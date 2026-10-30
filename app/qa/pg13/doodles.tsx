import { createRoot } from "react-dom/client";
import { EventEmitter } from "events";
import "@/css/index.css";
import DoodleToolbar from "@/components/doodle-toolbar";
import { Doodle } from "@/core/stage/stageObject/entity/Doodle";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { SectionInOutManager } from "@/core/stage/stageManager/concreteMethods/StageSectionInOutManager";
import { DeleteManager } from "@/core/stage/stageManager/concreteMethods/StageDeleteManager";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { CopyEngine } from "@/core/service/dataManageService/copyEngine/copyEngine";
import { Settings } from "@/core/service/Settings";
import { createImageNodeFromBlob } from "@/core/service/dataManageService/imageNodeFactory";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { TextRenderer } from "@/core/render/canvas2d/basicRenderer/textRenderer";
import { ShapeRenderer } from "@/core/render/canvas2d/basicRenderer/shapeRenderer";
import { SectionRenderer } from "@/core/render/canvas2d/entityRenderer/section/SectionRenderer";
import { TextNodeRenderer } from "@/core/render/canvas2d/entityRenderer/textNode/TextNodeRenderer";
import { ImageRenderer } from "@/core/render/canvas2d/basicRenderer/ImageRenderer";
import { Vector, Color } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { serialize, deserialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const ctx = canvas.getContext("2d")!;
const events = new EventEmitter();
const project: any = {
  stage: [],
  attachments: new Map(),
  references: { sections: {} },
  emit: events.emit.bind(events),
  on: events.on.bind(events),
  off: events.off.bind(events),
  canvas: {
    element: canvas,
    ctx,
    width: canvas.width,
    height: canvas.height,
    clientToView: (x: number, y: number) => {
      const r = canvas.getBoundingClientRect();
      return new Vector(((x - r.left) * canvas.clientWidth) / r.width, ((y - r.top) * canvas.clientHeight) / r.height);
    },
  },
  camera: { currentScale: 1, location: new Vector(0, 0) },
  renderer: {
    w: canvas.width,
    h: canvas.height,
    transformView2World: (v: Vector) => v.divide(project.camera.currentScale).add(project.camera.location),
    transformWorld2View: (v: Vector) => v.subtract(project.camera.location).multiply(project.camera.currentScale),
  },
  effects: { addEffect() {}, addEffects() {} },
  sectionCollisionSolver: { solveOverlaps() {} },
  syncAssociationManager: {
    syncFrom() {},
    onStageObjectDeleted() {},
    getSyncAssociationsByObject: () => [],
    getSyncSiblings: () => [],
  },
  autoComputeUtils: { isNameIsLogicNode: () => false },
  keyboardOnlyEngine: { isOpenning: () => false },
  collisionBoxRenderer: { render() {} },
  controller: { pressingKeySet: new Set(), resetCountdownTimer() {} },
  stageStyleManager: {
    currentStyle: { Background: new Color(20, 20, 20), StageObjectBorder: new Color(185, 210, 210) },
  },
  addAttachment(blob: Blob) {
    const id = crypto.randomUUID();
    this.attachments.set(id, blob);
    return id;
  },
  loop: () => draw(),
};
project.stageManager = new StageManager(project);
project.sectionMethods = new SectionMethods(project);
project.sectionInOutManager = new SectionInOutManager(project);
project.deleteManager = new DeleteManager(project);
project.textRenderer = new TextRenderer(project);
project.shapeRenderer = new ShapeRenderer(project);
project.sectionRenderer = new SectionRenderer(project);
project.copyEngine = new CopyEngine(project);
let state = "saved";
Object.defineProperty(project, "projectState", {
  get: () => state,
  set: (value) => {
    state = value;
    events.emit("state-change", value);
    draw();
  },
});
project.historyManager = new HistoryManager(project);
function draw() {
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  project.stageManager.getSections().forEach((section: Doodle) => project.sectionRenderer.render(section));
  const text = new TextNodeRenderer(project),
    image = new ImageRenderer(project);
  for (const entity of project.stageManager.getEntities()) {
    if (entity instanceof TextNode) text.renderTextNode(entity);
    if (entity instanceof ImageNode && entity.bitmap)
      image.renderImageElement(
        entity.bitmap,
        project.renderer.transformWorld2View(entity.rectangle.location),
        entity.scale,
      );
  }
}
let dragging: { entity: TextNode | Doodle; last: Vector } | undefined;
canvas.addEventListener("pointerdown", (event) => {
  const at = project.renderer.transformView2World(project.canvas.clientToView(event.clientX, event.clientY));
  const entity = project.stageManager.findEntityByLocation(at);
  project.stageManager.clearSelectAll();
  if (entity) {
    entity.isSelected = true;
    dragging = { entity, last: at };
  }
  canvas.setPointerCapture(event.pointerId);
  draw();
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const at = project.renderer.transformView2World(project.canvas.clientToView(event.clientX, event.clientY));
  dragging.entity.move(at.subtract(dragging.last));
  dragging.last = at;
  draw();
});
canvas.addEventListener("pointerup", () => {
  if (dragging) {
    dragging = undefined;
    project.historyManager.recordStep();
  }
});
canvas.addEventListener("dblclick", (event) => {
  const at = project.renderer.transformView2World(project.canvas.clientToView(event.clientX, event.clientY));
  if (project.stageManager.findEntityByLocation(at)) return;
  const node = new TextNode(project, {
    text: "新建节点",
    collisionBox: new CollisionBox([new Rectangle(at.subtract(new Vector(60, 35)), new Vector(120, 70))]),
  });
  project.stageManager.add(node);
  project.historyManager.recordStep();
  draw();
});
window.addEventListener("keydown", async (event) => {
  if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "")) return;
  if (event.ctrlKey && ["z", "y", "c", "v"].includes(event.key.toLowerCase())) {
    event.preventDefault();
    if (event.key.toLowerCase() === "z") project.historyManager.undo();
    if (event.key.toLowerCase() === "y") project.historyManager.redo();
    if (event.key.toLowerCase() === "c") await project.copyEngine.copy("nodes");
    if (event.key.toLowerCase() === "v") await project.copyEngine.paste();
    events.emit("state-change", "changed");
    draw();
  }
});
MouseLocation.init();
Object.assign(window, {
  doodleQA: {
    project,
    settings: Settings,
    addImage: createImageNodeFromBlob,
    snapshot: () => serialize(project.stage),
    reload: () => {
      project.stage = deserialize(decode(new Encoder().encode(serialize(project.stage))), project);
      project.stageManager.updateReferences();
      events.emit("state-change", "loaded");
      draw();
    },
    shapes: () =>
      project.stage
        .filter((e: unknown) => e instanceof Doodle)
        .map((d: Doodle) => ({
          id: d.uuid,
          name: d.text,
          bounded: d.bounded,
          shape: d.shape,
          rect: { x: d.frame.left, y: d.frame.top, width: d.frame.width, height: d.frame.height },
          children: d.children.map((e) => e.uuid),
        })),
    nodes: () =>
      project.stageManager.getTextNodes().map((n: TextNode) => ({
        id: n.uuid,
        text: n.text,
        x: n.rectangle.left,
        y: n.rectangle.top,
        width: n.rectangle.width,
        height: n.rectangle.height,
        parent: n.parentSection?.uuid,
      })),
    images: () =>
      project.stageManager.getImageNodes().map((n: ImageNode) => ({
        id: n.uuid,
        x: n.rectangle.left,
        y: n.rectangle.top,
        width: n.rectangle.width,
        height: n.rectangle.height,
        parent: n.parentSection?.uuid,
      })),
  },
});
draw();
createRoot(document.getElementById("root")!).render(<DoodleToolbar project={project} />);
