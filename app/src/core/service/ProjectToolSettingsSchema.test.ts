import { describe, expect, it } from "vitest";
import { parseProjectToolSettings } from "./ProjectToolSettingsSchema";

describe("Project tool Settings schema", () => {
  it("defaults invalid maximum widths and keeps user-selected widths", () => {
    for (const value of [undefined, 0, -1, 201, 1.5, "15", NaN]) {
      expect(parseProjectToolSettings({ textNodeMaxCharWidth: value }, "test-font").textNodeMaxCharWidth).toBe(15);
    }
    expect(parseProjectToolSettings({ textNodeMaxCharWidth: 25 }, "test-font").textNodeMaxCharWidth).toBe(25);
  });
  it("keeps valid saved values and falls back per key for stale values", () => {
    expect(
      parseProjectToolSettings(
        {
          historySize: "invalid",
          isEnableEntityCollision: true,
          moveFriction: 2,
          unknownSetting: "ignored",
        },
        "test-font",
      ),
    ).toMatchObject({
      defaultFontFamily: "test-font",
      historySize: 150,
      isEnableEntityCollision: true,
      moveFriction: 0.1,
    });
  });
});
