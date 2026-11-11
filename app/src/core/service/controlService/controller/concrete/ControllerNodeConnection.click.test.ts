// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/core/Project", () => ({ Project: class {} }));
vi.mock("@/core/service/controlService/controller/ControllerClass", () => ({
  ControllerClass: class {
    dispose() {}
  },
}));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/LineEffect", () => ({ LineEffect: class {} }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleNoteEffect", () => ({
  RectangleNoteEffect: class {},
}));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/SparkBurstEffect", () => ({
  SparkBurstEffect: class {},
}));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({ ConnectableEntity: class {} }));
vi.mock("@/core/stage/stageObject/entity/ConnectPoint", () => ({ ConnectPoint: class {} }));
vi.mock("@/core/stage/stageObject/entity/ImageNode", () => ({ ImageNode: class {} }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/utils/platform", () => ({ isMac: false }));
vi.mock("@/core/service/controlService/MouseLocation", () => ({ MouseLocation: {} }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: { play: { connectLineStart: vi.fn(), connectFindTarget: vi.fn() } },
}));
const settings = vi.hoisted(() => ({
  enableRightClickConnect: true,
  lineStyle: "straight",
  rightClickConnectEdgeType: "arc",
  mouseLeftMode: "selectAndMove",
  autoAdjustLineEndpointsByMouseTrack: false,
}));
vi.mock("@/core/service/Settings", () => ({ Settings: settings }));
import { ControllerNodeConnectionClass } from "./ControllerNodeConnection";
import { Color, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

let controller: ControllerNodeConnectionClass;
beforeEach(() => {
  settings.enableRightClickConnect = true;
});
afterEach(() => controller?.dispose());
function fixture() {
  const nodes = ["a", "b", "c"].map((uuid, index) => ({
    uuid,
    isSelected: false,
    collisionBox: {
      getRectangle: () => new Rectangle(new Vector(index * 100, 0), new Vector(80, 80)),
      isContainsPoint: (p: Vector) => p.x >= index * 100 && p.x < index * 100 + 80,
    },
  }));
  const calls: string[] = [];
  const p: any = {
    renderer: { transformView2World: (v: Vector) => v },
    effects: { addEffect: vi.fn() },
    stageStyleManager: { currentStyle: { effects: { successShadow: Color.Black } } },
    controller: {
      setCursorName: vi.fn(),
      pressingKeySet: new Set(),
      isMouseDown: { 2: true },
      rectangleSelect: { isUsing: false },
      cutting: { isUsing: false },
    },
    stageManager: {
      getConnectableEntity: () => nodes,
      findConnectableEntityByLocation: (v: Vector) => nodes.find((n) => n.collisionBox.isContainsPoint(v)) ?? null,
      connectMultipleEntities: (sources: typeof nodes, target: (typeof nodes)[number]) => {
        for (const source of sources) calls.push(source.uuid + "→" + target.uuid);
      },
    },
  };
  controller = new ControllerNodeConnectionClass(p);
  (controller as any).addConnectEffect = vi.fn();
  const select = (...indexes: number[]) => nodes.forEach((n, i) => (n.isSelected = indexes.includes(i)));
  const click = (index: number, jitter = 0) => {
    const event = { button: 2, clientX: index * 100 + 20, clientY: 20 } as MouseEvent;
    controller.mousedown(event);
    if (jitter) controller.mousemove({ ...event, clientX: event.clientX + jitter });
    controller.mouseup({ ...event, clientX: event.clientX + jitter });
  };
  return { nodes, calls, select, click, project: p };
}
it.each([0, 2, 6, 12])("connects A→B then B→C on the first attempt, including %s units of jitter", (jitter) => {
  const f = fixture();
  f.select(0);
  f.click(1, jitter);
  f.select(1);
  f.click(2, jitter);
  expect(f.calls).toEqual(["a→b", "b→c"]);
  expect(controller.connectFromEntities).toEqual([]);
  expect(controller.isUsing).toBe(false);
});
it("skips selected target self-connections while preserving other selected sources", () => {
  const f = fixture();
  f.select(0, 1);
  f.click(1);
  expect(f.calls).toEqual(["a→b"]);
  f.select(1);
  f.click(1, 6);
  expect(f.calls).toEqual(["a→b"]);
});
it("only requests a click self-loop when no nodes are selected", () => {
  const f = fixture();
  f.click(2);
  expect(f.calls).toEqual(["c→c"]);
});
it("keeps right-click connection disabled when the existing setting is off", () => {
  settings.enableRightClickConnect = false;
  const f = fixture();
  f.select(0);
  f.click(1);
  expect(f.calls).toEqual([]);
});

it("gives vertical line style priority over the right-click arc default", () => {
  const f = fixture();
  const connect = vi.spyOn(f.project.stageManager, "connectMultipleEntities");
  settings.lineStyle = "vertical";
  try {
    f.select(0);
    f.click(1);
    expect(connect).toHaveBeenCalledWith([f.nodes[0]], f.nodes[1], false, undefined, undefined, false);
    expect(f.calls).toEqual(["a→b"]);
  } finally {
    settings.lineStyle = "straight";
  }
});
