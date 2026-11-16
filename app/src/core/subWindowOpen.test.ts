import { expect, it, vi } from "vitest";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
const fixture = vi.hoisted(() => ({ modes: { SettingsWindow: "floating" }, create: vi.fn() }));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    get subWindowOpenModes() {
      return fixture.modes;
    },
  },
}));
vi.mock("@/core/TabWorkspace", () => ({ TabWorkspace: { create: fixture.create } }));
import { createSubWindow } from "./subWindowOpen";

it("reduces new floating panels by ten percent around their center without mutating the requested rectangle", () => {
  fixture.modes.SettingsWindow = "floating";
  const rect = new Rectangle(new Vector(100, 80), new Vector(800, 600));
  createSubWindow("SettingsWindow", { rect });
  const options = fixture.create.mock.lastCall![0];
  expect(options.rect.size).toEqual(new Vector(720, 540));
  expect(options.rect.center).toEqual(rect.center);
  expect(rect.size).toEqual(new Vector(800, 600));
  fixture.modes.SettingsWindow = "dockedRight";
  createSubWindow("SettingsWindow", { rect });
  expect(fixture.create.mock.lastCall![0].rect).toBe(rect);
  expect(fixture.create.mock.lastCall![0].layout).toBe("docked");
});

it("preserves small panel dimensions instead of squeezing controls below their existing usable size", () => {
  fixture.modes.SettingsWindow = "floating";
  const rect = new Rectangle(new Vector(100, 80), new Vector(220, 150));
  createSubWindow("SettingsWindow", { rect });
  expect(fixture.create.mock.lastCall![0].rect.size).toEqual(rect.size);
});
