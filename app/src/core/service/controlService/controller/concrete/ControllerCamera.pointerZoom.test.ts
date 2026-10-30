// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: {} }));
vi.mock("@/utils/platform", () => ({ isMac: false, isIpad: false }));
vi.mock("@/utils/externalOpen", () => ({ openBrowserOrFileByEntity: vi.fn() }));
vi.mock("./ControllerCamera/mac", () => ({ ControllerCameraMac: class {} }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({
  SoundService: { play: { viewAdjustSoundFile: vi.fn() } },
}));
import type { Project } from "@/core/Project";
import { Camera } from "@/core/stage/Camera";
import { ControllerCameraClass } from "./ControllerCamera";
import { Settings } from "@/core/service/Settings";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";

const owned: ControllerCameraClass[] = [];
function fixture() {
  const element = document.createElement("canvas");
  const p: any = {
    canvas: { element, clientToView: (x: number, y: number) => new Vector((x - 200) / 0.8, (y - 100) / 0.8) },
    controller: { pressingKeySet: new Set(), isCameraLocked: false },
    effects: { addEffect: vi.fn() },
    stageManager: { findEntityByLocation: vi.fn(() => null), findAssociationByLocation: vi.fn(() => null) },
  };
  p.camera = new Camera(p);
  p.camera.location = new Vector(12000, -8000);
  p.camera.currentScale = p.camera.targetScale = 0.65;
  p.camera.hasResetOnOpen = true;
  p.renderer = {
    w: 1000,
    h: 700,
    transformView2World: (v: Vector) =>
      v.subtract(new Vector(500, 350)).divide(p.camera.currentScale).add(p.camera.location),
    transformWorld2View: (v: Vector) =>
      v.subtract(p.camera.location).multiply(p.camera.currentScale).add(new Vector(500, 350)),
    getCoverWorldRectangle: () =>
      new Rectangle(
        p.camera.location.subtract(new Vector(500, 350).divide(p.camera.currentScale)),
        new Vector(1000, 700).divide(p.camera.currentScale),
      ),
  };
  const control = new ControllerCameraClass(p);
  owned.push(control);
  return { p: p as Project, control };
}
function wheel(control: ControllerCameraClass, options: WheelEventInit = {}) {
  control.mousewheel(new WheelEvent("wheel", { clientX: 780, clientY: 180, deltaY: -120, ctrlKey: true, ...options }));
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(Settings, {
    viewerMode: false,
    mouseLeftMode: "select",
    isStealthModeEnabled: false,
    enableWindowsTouchPad: false,
    mouseWheelWithCtrlMode: "none",
    mouseWheelWithCtrlModeReverse: false,
    scaleCameraByMouseLocation: false,
    scaleExponent: 0.25,
    moveAmplitude: 0,
    moveFriction: 0.1,
    mouseWheelMode: "zoom",
    mouseWheelModeReverse: false,
    mouseWheelWithShiftMode: "none",
    mouseWheelWithAltMode: "none",
  });
});
afterEach(() => {
  owned.splice(0).forEach((c) => c.dispose());
  vi.useRealTimers();
});
describe("Ctrl-wheel pointer zoom on empty canvas", () => {
  it.each([-120, 120, -3])("keeps the cursor world point fixed through every animation tick for delta %s", (deltaY) => {
    const { p, control } = fixture();
    const view = new Vector(780, 180),
      anchor = p.renderer.transformView2World(view);
    const original = structuredClone(Settings);
    p.camera.addScaleFollowMouseLocationTime(5);
    wheel(control, { deltaY });
    expect(p.camera.targetScale).toBeCloseTo(0.65 * (deltaY < 0 ? 1.2 : 0.8));
    for (let i = 0; i < 30; i++) {
      p.camera.tick();
      expect(p.renderer.transformWorld2View(anchor).distance(view)).toBeLessThan(1e-7);
    }
    expect(Settings).toEqual(original);
  });
  it("uses native canvas-local event conversion for an offset and scaled pane", () => {
    const { p } = fixture();
    vi.advanceTimersByTime(10);
    const view = new Vector(650, 240),
      anchor = p.renderer.transformView2World(view);
    p.canvas.element.dispatchEvent(
      new WheelEvent("wheel", { ctrlKey: true, clientX: 720, clientY: 292, deltaY: -120 }),
    );
    p.camera.tick();
    expect(p.renderer.transformWorld2View(anchor).distance(view)).toBeLessThan(1e-7);
  });
  it("captures a new anchor when the mouse moves during consecutive zoom gestures", () => {
    const { p, control } = fixture();
    wheel(control);
    p.camera.tick();
    const view = new Vector(150, 600),
      anchor = p.renderer.transformView2World(view);
    wheel(control, { clientX: view.x, clientY: view.y, deltaY: 120 });
    for (let i = 0; i < 15; i++) {
      p.camera.tick();
      expect(p.renderer.transformWorld2View(anchor).distance(view)).toBeLessThan(1e-7);
    }
  });
  it.each(["entity", "edge"])("leaves %s content and configured Ctrl wheel action unchanged", (kind) => {
    const { p, control } = fixture();
    vi.spyOn(p.camera, "zoomAtPointer");
    vi.mocked(
      kind === "entity" ? p.stageManager.findEntityByLocation : p.stageManager.findAssociationByLocation,
    ).mockReturnValue({} as never);
    p.controller.pressingKeySet.add("control");
    wheel(control);
    expect(p.camera.zoomAtPointer).not.toHaveBeenCalled();
    expect(p.camera.targetScale).toBe(0.65);
  });
  it("respects the existing reverse direction value without changing it", () => {
    Settings.mouseWheelWithCtrlModeReverse = true;
    const { p, control } = fixture();
    wheel(control);
    expect(p.camera.targetScale).toBeCloseTo(0.65 * 0.8);
    expect(Settings.mouseWheelWithCtrlModeReverse).toBe(true);
  });
  it("preserves ordinary wheel's center-based setting after a Ctrl zoom", () => {
    const { p, control } = fixture();
    wheel(control);
    for (let i = 0; i < 20; i++) p.camera.tick();
    const at = p.camera.location.clone();
    wheel(control, { ctrlKey: false, deltaY: 120 });
    p.camera.tick();
    expect(p.camera.location).toEqual(at);
  });
  it("does not intercept locked camera, other modifiers or horizontal wheel", () => {
    const { p, control } = fixture();
    const zoom = vi.spyOn(p.camera, "zoomAtPointer");
    p.controller.isCameraLocked = true;
    wheel(control);
    p.controller.isCameraLocked = false;
    wheel(control, { shiftKey: true });
    wheel(control, { altKey: true });
    wheel(control, { metaKey: true });
    wheel(control, { deltaX: 120, deltaY: 0 });
    expect(zoom).not.toHaveBeenCalled();
  });
});
