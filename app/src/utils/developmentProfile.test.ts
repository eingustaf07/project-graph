import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ exists: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "roaming",
  homeDir: async () => "home",
  join: async (...parts: string[]) => parts.join("/"),
}));

beforeEach(() => {
  vi.resetModules();
  fs.exists.mockReset();
  vi.stubEnv("LR_PG_DEVELOPMENT_SESSION", "1");
});
afterEach(() => vi.unstubAllEnvs());

it("resolves settings, shortcuts and extensions against the same provisioned root", async () => {
  fs.exists.mockResolvedValue(true);
  const { preferencePath, extensionsPath } = await import("./developmentProfile");
  const root = "home/.project-graph-e/preferences";
  expect(await Promise.all([preferencePath("settings.json"), preferencePath("keybinds2.json"), extensionsPath()]))
    .toEqual([root + "/settings.json", root + "/keybinds2.json", root + "/extensions"]);
  expect(fs.exists).toHaveBeenCalledTimes(1);
});

it("preserves prior paths when the development profile has not been provisioned", async () => {
  fs.exists.mockResolvedValue(false);
  const { preferencePath, extensionsPath } = await import("./developmentProfile");
  expect(await preferencePath("settings.json")).toBe("settings.json");
  expect(await extensionsPath()).toBe("roaming/extensions");
});
