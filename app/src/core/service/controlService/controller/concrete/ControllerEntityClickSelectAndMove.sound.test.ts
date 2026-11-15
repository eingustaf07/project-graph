import { expect, it, vi } from "vitest";
vi.mock("@/core/service/controlService/controller/ControllerClass", () => ({
  ControllerClass: class {
    constructor(protected project: unknown) {}
  },
}));
vi.mock("@/core/service/controlService/controller/utils/ShakeDetector", () => ({
  ShakeDetector: class {
    reset() {}
  },
}));
vi.mock("@/core/service/dataManageService/connectNodeSmartTools", () => ({ ConnectNodeSmartTools: {} }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleNoteEffect", () => ({
  RectangleNoteEffect: {},
}));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleRenderEffect", () => ({
  RectangleRenderEffect: {},
}));
vi.mock("@/core/stage/stageObject/abstract/StageEntity", () => ({ Entity: class {} }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", async () => {
  const { Entity } = await import("@/core/stage/stageObject/abstract/StageEntity");
  const Base = Entity as unknown as { new (): { isSelected: boolean } };
  return {
    ConnectableEntity: class extends Base {
      isSelected = false;
    },
  };
});
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/service/Settings", () => ({ Settings: { mouseLeftMode: "selectAndMove" } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: { playNodeSelected: vi.fn() } }));
vi.mock("@/utils/platform", () => ({ isMac: false }));
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { SoundService } from "@/core/service/feedbackService/SoundService";
import { ControllerEntityClickSelectAndMoveClass } from "./ControllerEntityClickSelectAndMove";
import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";

it.each(["selectAndMove", "accumulateSelection"])("sounds only on newly selecting a node in %s mode", (mode) => {
  vi.clearAllMocks();
  Settings.mouseLeftMode = mode as typeof Settings.mouseLeftMode;
  const node = new (ConnectableEntity as unknown as { new (): ConnectableEntity })();
  const keys = new Set<string>();
  const project = {
    controller: { camera: {}, pressingKeySet: keys },
    sectionMethods: { isObjectBeLockedBySection: () => false },
    renderer: { transformView2World: (value: unknown) => value },
    controllerUtils: { isClickedResizeRect: () => false, getClickedStageObject: () => node },
    entityMoveManager: { endPointerDrag: vi.fn(), beginPointerDrag: vi.fn() },
    stageManager: { getStageObjects: () => [node] },
  } as unknown as Project;
  const controller = new ControllerEntityClickSelectAndMoveClass(project);
  const event = { button: 0, clientX: 10, clientY: 10 } as MouseEvent;
  controller.mousedown(event);
  expect(node.isSelected).toBe(true);
  expect(SoundService.playNodeSelected).toHaveBeenCalledTimes(1);
  controller.mousedown(event);
  expect(SoundService.playNodeSelected).toHaveBeenCalledTimes(1);
  keys.add("control");
  keys.add("shift");
  controller.mousedown(event);
  expect(node.isSelected).toBe(false);
  expect(SoundService.playNodeSelected).toHaveBeenCalledTimes(1);
});
