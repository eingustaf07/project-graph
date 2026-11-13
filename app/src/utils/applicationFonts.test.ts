// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_FONT_FAMILY } from "@/core/service/ProjectToolSettingsSchema";
import { applyApplicationFont } from "./applicationFonts";

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
  document.documentElement.style.removeProperty("--pg-ui-font-family");
  document.documentElement.style.removeProperty("--font-sans");
});

function fontLoader(load: () => Promise<unknown>) {
  const add = vi.fn(),
    construct = vi.fn();
  Object.defineProperty(document, "fonts", { configurable: true, value: { add } });
  vi.stubGlobal(
    "FontFace",
    class {
      constructor(family: string, source: string) {
        construct(family, source);
      }
      load = load;
    },
  );
  return { add, construct };
}

it("loads the same bundled font before use and reuses the load within one window", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { add, construct } = fontLoader(() => pending);
  const { loadApplicationFont } = await import("./applicationFonts");
  const first = loadApplicationFont();
  expect(add).not.toHaveBeenCalled();
  expect(loadApplicationFont()).toBe(first);
  finish();
  expect(await first).toBe(true);
  expect(add).toHaveBeenCalledTimes(1);
  expect(construct).toHaveBeenCalledWith("Retro Pixel UI", expect.stringContaining("RetroPixelUI-Regular.ttf"));
});

it("returns a failure for a missing asset so startup can show its font warning without resetting preferences", async () => {
  const { add } = fontLoader(async () => {
    throw new Error("missing asset");
  });
  expect(await (await import("./applicationFonts")).loadApplicationFont()).toBe(false);
  expect(add).not.toHaveBeenCalled();
});

it("times out safely and does not switch fonts later after text measurement has begun", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { add } = fontLoader(() => pending);
  const { loadApplicationFont } = await import("./applicationFonts");
  const result = loadApplicationFont();
  await vi.advanceTimersByTimeAsync(2500);
  expect(await result).toBe(false);
  finish();
  await Promise.resolve();
  expect(add).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("uses the same persistent custom UI font in fresh main and detached window documents", () => {
  const main = document.implementation.createHTMLDocument("main");
  const child = document.implementation.createHTMLDocument("child");
  applyApplicationFont(main.documentElement);
  applyApplicationFont(child.documentElement);
  for (const doc of [main, child]) {
    const family = doc.documentElement.style.getPropertyValue("--pg-ui-font-family");
    expect(family).toBe(DEFAULT_FONT_FAMILY);
    expect(doc.documentElement.style.getPropertyValue("--font-sans")).toBe(DEFAULT_FONT_FAMILY);
    expect(family.indexOf('"Retro Pixel UI"')).toBeLessThan(family.indexOf("system-ui"));
  }
});

it("reapplies on a fresh application startup without changing other root styling", () => {
  const root = document.documentElement;
  root.style.setProperty("--background", "#123456");
  applyApplicationFont();
  root.style.removeProperty("--pg-ui-font-family");
  applyApplicationFont();
  expect(root.style.getPropertyValue("--pg-ui-font-family")).toBe(DEFAULT_FONT_FAMILY);
  expect(root.style.getPropertyValue("--background")).toBe("#123456");
  root.style.removeProperty("--background");
});
