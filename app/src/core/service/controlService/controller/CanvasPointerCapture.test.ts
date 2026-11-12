// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { CanvasPointerCapture } from "./CanvasPointerCapture";

const captures: CanvasPointerCapture[] = [];
afterEach(() => {
  captures.splice(0).forEach((c) => c.dispose());
  vi.restoreAllMocks();
});
function fixture() {
  const canvas = document.createElement("canvas");
  const held = new Set<number>();
  canvas.setPointerCapture = vi.fn((id) => {
    held.add(id);
  });
  canvas.hasPointerCapture = vi.fn((id) => held.has(id));
  canvas.releasePointerCapture = vi.fn((id) => {
    held.delete(id);
  });
  const cancel = vi.fn();
  const capture = new CanvasPointerCapture(canvas, cancel);
  captures.push(capture);
  const send = (type: string, options: Partial<PointerEvent> = {}) => {
    const event = new Event(type);
    Object.assign(
      event,
      { pointerType: "mouse", pointerId: 7, button: 0, buttons: 1, clientX: 10, clientY: 10 },
      options,
    );
    canvas.dispatchEvent(event);
  };
  return { canvas, capture, cancel, send };
}
it("retains capture through rapid interior movement and canvas leaves until release", () => {
  const { canvas, capture, cancel, send } = fixture();
  send("pointerdown");
  for (const x of [900, 20, 1400, -200, 180]) {
    send("pointermove", { clientX: x });
    send("pointerleave", { clientX: x });
    expect(capture.active).toBe(true);
  }
  expect(canvas.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
  send("pointerup", { buttons: 0 });
  send("lostpointercapture");
  expect(capture.active).toBe(false);
  expect(cancel).not.toHaveBeenCalled();
});
it.each(["pointercancel", "lostpointercapture", "blur", "released-button"])(
  "clears a drag on %s and accepts another drag",
  (reason) => {
    const { capture, cancel, send } = fixture();
    send("pointerdown");
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    else if (reason === "released-button") send("pointermove", { buttons: 0 });
    else send(reason);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(capture.active).toBe(false);
    send("pointerdown");
    expect(capture.active).toBe(true);
    send("pointerup");
  },
);
it("leaves right-button cross-file connections and touch gestures with their existing handlers", () => {
  const { canvas, send } = fixture();
  send("pointerdown", { button: 2, buttons: 2 });
  send("pointerdown", { pointerType: "touch" });
  expect(canvas.setPointerCapture).not.toHaveBeenCalled();
});
