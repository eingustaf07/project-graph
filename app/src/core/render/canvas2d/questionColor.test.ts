import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/core/service/Settings", () => ({ Settings: { questionMarkYellow: false } }));
import { Settings } from "@/core/service/Settings";
import { Color } from "@graphif/data-structures";
import { isQuestionMarked, questionDisplayColor } from "./questionColor";
afterEach(() => {
  Settings.questionMarkYellow = false;
});
it.each(["为什么？", "Why?", "中文英文?？", "结尾？\n  "])(
  "recognizes Chinese and English trailing question marks: %s",
  (text) => {
    Settings.questionMarkYellow = true;
    expect(isQuestionMarked(text)).toBe(true);
  },
);
it.each(["", undefined, "问题？答案", "？。", "普通节点"])("leaves non-question content unchanged: %s", (text) => {
  Settings.questionMarkYellow = true;
  expect(questionDisplayColor(text, Color.Red)).toBe(Color.Red);
});
it("is opt-in and never changes stored color objects", () => {
  const before = Color.Red.toString();
  expect(questionDisplayColor("旧节点？", Color.Red)).toBe(Color.Red);
  Settings.questionMarkYellow = true;
  expect(questionDisplayColor("旧节点？", Color.Red).toString()).toBe(new Color(255, 235, 59, 1).toString());
  expect(Color.Red.toString()).toBe(before);
});
