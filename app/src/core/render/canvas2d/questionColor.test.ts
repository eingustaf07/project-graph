import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/core/service/Settings", () => ({ Settings: { questionMarkYellow: false } }));
import { Settings } from "@/core/service/Settings";
import { Color } from "@graphif/data-structures";
import { isQuestionMarked, questionDisplayColor, questionTextColor } from "./questionColor";
import { conclusionBlue, expandConclusionShortcut } from "@/core/service/dataManageService/nodeConclusions";

it("expands /jl only at the start and gives old conclusion nodes blue without creation metadata", () => {
  expect(expandConclusionShortcut("/jl这里是结论")).toBe("结论:这里是结论");
  expect(expandConclusionShortcut("/JL 内容")).toBe("结论: 内容");
  expect(expandConclusionShortcut("正文 /jl")).toBe("正文 /jl");
  Settings.questionMarkYellow = true;
  for (const text of ["结论:历史内容", "结论：旧问题？"]) {
    expect(questionDisplayColor(text, Color.Transparent, true)).toBe(conclusionBlue);
    expect(isQuestionMarked(text)).toBe(false);
  }
  expect(questionDisplayColor("✅ 结论:已完成", Color.Green, true)).toBe(Color.Green);
  expect(questionDisplayColor("❌ 结论:待修订", Color.Red, true)).toBe(Color.Red);
});
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
it.each([
  ["✅ ", new Color(52, 103, 53, 1)],
  ["❌ ", new Color(52, 12, 14, 1)],
] as const)("gives task status %s priority and restores yellow after clearing it", (prefix, statusColor) => {
  Settings.questionMarkYellow = true;
  const text = prefix + "需要继续处理吗？";
  const stored = statusColor.toString();
  expect(questionDisplayColor(text, statusColor)).toBe(statusColor);
  expect(questionTextColor(text, statusColor, Color.Black).toString()).not.toBe(Color.Black.toString());
  expect(statusColor.toString()).toBe(stored);
  expect(questionDisplayColor("需要继续处理吗？", Color.Transparent).toString()).toBe(
    new Color(255, 235, 59, 1).toString(),
  );
  expect(questionTextColor("需要继续处理吗？", Color.Transparent, Color.Black)).toBe(Color.Black);
  Settings.questionMarkYellow = false;
  expect(questionDisplayColor(text, statusColor)).toBe(statusColor);
});
