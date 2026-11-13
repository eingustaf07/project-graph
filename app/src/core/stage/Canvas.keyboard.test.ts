// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ active: undefined as unknown }));
vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/service/Settings", () => ({ Settings: { antialiasing: "disabled" } }));
vi.mock("@/state", () => ({ activeTabAtom: "active", store: { get: () => state.active } }));
import { Canvas } from "./Canvas";

const canvases: Canvas[] = [];
beforeEach(() => vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D));
afterEach(() => {
  canvases.splice(0).forEach((c) => c.dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture() {
  const selected = { isSelected: true };
  const project = {
    isRunning: false,
    stage: [selected],
    loop: vi.fn(),
    controller: { pressingKeySet: new Set<string>() },
  };
  project.loop.mockImplementation(() => {
    project.isRunning = true;
  });
  const canvas = new Canvas(project as never);
  canvases.push(canvas);
  document.body.append(canvas.element);
  return { project, canvas, selected };
}

it("delivers the first selected-node key after switching windows without a canvas click", () => {
  const a = fixture(),
    b = fixture();
  state.active = a.project;
  const key = vi.fn();
  a.canvas.element.addEventListener("keydown", key);
  window.dispatchEvent(new Event("blur"));
  state.active = b.project;
  window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
  state.active = a.project;
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
  expect(a.project.loop).toHaveBeenCalled();
  expect(key).toHaveBeenCalledTimes(1);
  expect(a.selected.isSelected).toBe(true);
  expect(b.selected.isSelected).toBe(true);
  expect(b.project.loop).not.toHaveBeenCalled();
});

it("recovers a paused canvas on the first key even without receiving a focus event", () => {
  const { project, canvas } = fixture();
  state.active = project;
  const down = vi.fn(),
    up = vi.fn();
  canvas.element.addEventListener("keydown", down);
  canvas.element.addEventListener("keyup", up);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  project.isRunning = false;
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
  expect(down).toHaveBeenCalledTimes(1);
  expect(up).toHaveBeenCalledTimes(1);
});

it("preserves text editing and settings focus instead of redirecting their keys to a selection", () => {
  const { project, canvas } = fixture();
  state.active = project;
  const down = vi.fn();
  canvas.element.addEventListener("keydown", down);
  const input = document.createElement("textarea");
  document.body.append(input);
  input.focus();
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
  expect(project.loop).not.toHaveBeenCalled();
  expect(down).not.toHaveBeenCalled();
  input.blur();
  state.active = {};
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
  expect(down).not.toHaveBeenCalled();
});

it("removes window keyboard listeners when the canvas is disposed", () => {
  const { project, canvas } = fixture();
  state.active = project;
  canvas.dispose();
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
  expect(project.loop).not.toHaveBeenCalled();
});
