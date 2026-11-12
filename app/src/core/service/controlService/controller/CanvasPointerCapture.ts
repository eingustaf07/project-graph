/** Keep mouse drags on their originating canvas when crossing an overlay or pane edge. */
export class CanvasPointerCapture {
  private pointer: number | undefined;
  private lastPosition = { clientX: 0, clientY: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cancel: (position: { clientX: number; clientY: number }) => void,
  ) {
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.interrupt);
    canvas.addEventListener("lostpointercapture", this.interrupt);
    window.addEventListener("blur", this.blur);
  }

  get active() {
    return this.pointer !== undefined;
  }

  private down = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || this.active) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.pointer = event.pointerId;
    this.lastPosition = { clientX: event.clientX, clientY: event.clientY };
  };

  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    this.lastPosition = { clientX: event.clientX, clientY: event.clientY };
    // Recover if the OS delivered movement after releasing the button outside the app.
    if (!(event.buttons & 1)) this.blur();
  };

  private up = (event: PointerEvent) => {
    if (event.pointerId === this.pointer && event.button === 0) this.pointer = undefined;
    // The browser releases capture after all pointerup listeners have finished.
  };

  private interrupt = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    this.blur();
  };

  private blur = () => {
    const pointer = this.pointer;
    if (pointer === undefined) return;
    this.pointer = undefined;
    if (this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.cancel(this.lastPosition);
  };

  dispose() {
    this.blur();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.interrupt);
    this.canvas.removeEventListener("lostpointercapture", this.interrupt);
    window.removeEventListener("blur", this.blur);
  }
}
