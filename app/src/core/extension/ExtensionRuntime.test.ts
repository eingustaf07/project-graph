import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ errors: vi.fn(), workers: [] as any[], blobs: [] as Blob[] }));
vi.mock("comlink", () => ({ expose: vi.fn(), wrap: vi.fn(() => ({})) }));
vi.mock("./api/host", () => ({ extensionHostApiFactory: () => ({}) }));
vi.mock("./setupComlink/host", () => ({ setupComlink: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: state.errors } }));
import { ExtensionRuntime } from "./ExtensionRuntime";
import type { Extension } from "./Extension";
class TestWorker extends EventTarget {
  terminate = vi.fn();
  constructor() {
    super();
    state.workers.push(this);
  }
}
beforeEach(() => {
  state.workers.length = state.blobs.length = 0;
  state.errors.mockClear();
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (blob instanceof Blob) state.blobs.push(blob);
    return "blob:test";
  });
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function fixture() {
  const runtime = new ExtensionRuntime({
    code: "await prg.keybinds_register('test');",
    metadata: { extension: { name: "test" } },
  } as unknown as Extension);
  const text = await state.blobs.at(-1)!.text();
  const nonce = text.match(/__pgExtensionReady: "([^"]+)"/)?.[1];
  expect(nonce).toBeTruthy();
  return { runtime, worker: state.workers[0] as TestWorker, nonce };
}
it("does not report a runtime ready until its own script has completed registration", async () => {
  const { runtime, worker, nonce } = await fixture();
  const ready = vi.fn();
  void runtime.ready.then(ready);
  worker.dispatchEvent(new MessageEvent("message", { data: { __pgExtensionReady: "another-worker" } }));
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  worker.dispatchEvent(new MessageEvent("message", { data: { __pgExtensionReady: nonce } }));
  await runtime.ready;
  expect(ready).toHaveBeenCalledOnce();
});
it("reports extension initialization failure instead of silently declaring the window ready", async () => {
  const { runtime, worker, nonce } = await fixture();
  worker.dispatchEvent(
    new MessageEvent("message", { data: { __pgExtensionReady: nonce, error: "registration failed" } }),
  );
  await expect(runtime.ready).rejects.toThrow("registration failed");
  expect(state.errors).toHaveBeenCalledWith(expect.stringContaining("registration failed"));
});
it("bounds initialization time and keeps an explicit failure state", async () => {
  vi.useFakeTimers();
  const { runtime } = await fixture();
  const rejection = expect(runtime.ready).rejects.toThrow("初始化超时");
  await vi.advanceTimersByTimeAsync(30000);
  await rejection;
});
