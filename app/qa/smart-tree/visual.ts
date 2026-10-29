import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { LineEdge } from "@/core/stage/stageObject/association/LineEdge";
import { ShapeRenderer } from "@/core/render/canvas2d/basicRenderer/shapeRenderer";
import { TextRenderer } from "@/core/render/canvas2d/basicRenderer/textRenderer";
import { TextNodeRenderer } from "@/core/render/canvas2d/entityRenderer/textNode/TextNodeRenderer";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { arrangeSmartTree } from "@/core/service/controlService/autoLayoutEngine/SmartTreeArrange";
import {
  boundsOf,
  findOverlaps,
  type TreeDirection,
} from "@/core/service/controlService/autoLayoutEngine/SmartTreeLayout";
import { objectRect } from "@/core/service/dataManageService/aiEngine/AITreeLayout";
import { Vector, Color } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { serialize, deserialize } from "@graphif/serializer";
import { Encoder, decode } from "@msgpack/msgpack";

const canvas = document.querySelector("canvas")!;
const ctx = canvas.getContext("2d")!;
const status = document.querySelector("#status")!;
const directionInput = document.querySelector<HTMLSelectElement>("#direction")!;
const countInput = document.querySelector<HTMLSelectElement>("#count")!;
let project: any;
const nodes = () => project.stage.filter((n: unknown) => n instanceof TextNode) as TextNode[];
const edges = () => project.stage.filter((n: unknown) => n instanceof LineEdge) as LineEdge[];
function draw() {
  const rectangles = nodes().map(objectRect),
    bounds = boundsOf(rectangles);
  const scale = Math.min(1, 1440 / bounds.width, 830 / bounds.height);
  project.camera.currentScale = scale;
  project.renderer.transformWorld2View = (p: Vector) =>
    new Vector((p.x - bounds.x) * scale + 30, (p.y - bounds.y) * scale + 30);
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const edge of edges()) {
    const a = project.renderer.transformWorld2View(edge.bodyLine.start),
      b = project.renderer.transformWorld2View(edge.bodyLine.end);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "#89979c";
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.stroke();
  }
  const renderer = new TextNodeRenderer(project);
  for (const n of nodes()) renderer.renderTextNode(n);
  status.textContent = `${nodes().length} 节点；重叠 ${findOverlaps(rectangles).length} 处；真实测量包围盒 ${Math.round(bounds.width)} × ${Math.round(bounds.height)}`;
}
function reset() {
  project?.historyManager.dispose();
  project = {
    stage: [],
    emit() {},
    canvas: { ctx, width: canvas.width, height: canvas.height },
    camera: { currentScale: 1 },
    renderer: { w: canvas.width, h: canvas.height },
    autoComputeUtils: { isNameIsLogicNode: () => false },
    keyboardOnlyEngine: { isOpenning: () => false },
    collisionBoxRenderer: { render() {} },
    syncAssociationManager: { getSyncAssociationsByObject: () => [] },
    stageStyleManager: {
      currentStyle: { Background: new Color(20, 20, 20), StageObjectBorder: new Color(185, 210, 210) },
    },
  };
  project.textRenderer = new TextRenderer(project);
  project.shapeRenderer = new ShapeRenderer(project);
  project.stageManager = {
    get: (id: string) => project.stage.find((n: any) => n.uuid === id),
    getEntities: nodes,
    getEdges: edges,
    getSelectedEntities: () => [nodes()[0]],
    updateReferences() {},
  };
  const labels = [
    "学习计划",
    "基础概念",
    "实际练习",
    "复习与总结",
    "长文本：准确理解知识之间的逻辑关系，再按父子层级整理",
    "示例一",
    "示例二",
    "记录问题",
    "比较方案",
    "定期复盘",
  ];
  for (let i = 0; i < Number(countInput.value); i++) {
    const node = new TextNode(project, {
      uuid: `v${i}`,
      text: labels[i % labels.length] + (i >= labels.length ? ` ${i}` : ""),
    });
    node.collisionBox.updateShapeList([
      new Rectangle(new Vector((i * 137) % 800, (i * 193) % 600), node.rectangle.size.clone()),
    ]);
    project.stage.push(node);
  }
  const list = nodes();
  for (let i = 1; i < list.length; i++)
    project.stage.push(
      new LineEdge(project, {
        associationList: [list[Math.floor((i - 1) / 3)], list[i]],
        sourceRectangleRate: new Vector(0.99, 0.5),
        targetRectangleRate: new Vector(0.01, 0.5),
      }),
    );
  project.historyManager = new HistoryManager(project);
  draw();
}
function arrange() {
  const result = arrangeSmartTree(project, {
    mode: "standard",
    direction: directionInput.value as TreeDirection,
    levelGap: 64,
    nodeGap: 24,
    subtreeGap: 40,
  });
  draw();
  return result;
}
document.querySelector("#reset")!.addEventListener("click", reset);
document.querySelector("#arrange")!.addEventListener("click", arrange);
document.querySelector("#undo")!.addEventListener("click", () => {
  project.historyManager.undo();
  draw();
});
document.querySelector("#redo")!.addEventListener("click", () => {
  project.historyManager.redo();
  draw();
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    arrange();
  }
});
Object.assign(window, {
  smartTreeQA: {
    reset,
    arrange,
    snapshot: () => serialize(project.stage),
    overlaps: () => findOverlaps(nodes().map(objectRect)),
    roundTrip: () => {
      const file = new Encoder().encode(serialize(project.stage));
      project.stage = deserialize(decode(file), project);
      draw();
    },
  },
});
reset();
