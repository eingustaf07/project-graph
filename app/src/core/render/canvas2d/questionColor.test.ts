import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/core/service/Settings", () => ({ Settings: { questionMarkYellow: false } }));
import { Settings } from "@/core/service/Settings";
import { Color } from "@graphif/data-structures";
import {
  isQuestionMarked,
  isYellowQuestionNode,
  questionDisplayColor,
  questionTextColor,
  taskFrameDisplayColor,
} from "./questionColor";
import { conclusionBlue, expandConclusionShortcut } from "@/core/service/dataManageService/nodeConclusions";
import { conjecturePurple, expandConjectureShortcut } from "@/core/service/dataManageService/nodeConclusions";

it("expands the conjecture prefix and renders conjectures purple with task status taking priority", () => {
  expect(expandConjectureShortcut("/cx可能成立")).toBe("猜想:可能成立");
  expect(expandConjectureShortcut("/CX 内容")).toBe("猜想: 内容");
  expect(expandConjectureShortcut("正文 /cx")).toBe("正文 /cx");
  Settings.questionMarkYellow = true;
  for (const text of ["猜想:历史内容", "猜想：会成立吗？"]) {
    expect(questionDisplayColor(text, Color.Transparent, true)).toBe(conjecturePurple);
  }
  expect(questionDisplayColor("❌ 猜想:待验证", Color.Red, true)).toBe(Color.Red);
  expect(questionDisplayColor("✅ 猜想:已完成", Color.Green, true)).toBe(Color.Green);
});

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

it.each([Color.Black, new Color(23, 23, 23), Color.White, new Color(110, 110, 110)])(
  "keeps task strokes and text readable against background %s without changing stored status colors",
  (background) => {
    const brightness = (color: Color) => {
      const channels = [color.r, color.g, color.b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const [text, original] of [
      ["✅ 问题？", new Color(52, 103, 53)],
      ["❌ 问题？", new Color(52, 12, 14)],
    ] as const) {
      const before = original.toArray();
      const display = taskFrameDisplayColor(text, original, background);
      const ratio =
        (Math.max(brightness(display), brightness(background)) + 0.05) /
        (Math.min(brightness(display), brightness(background)) + 0.05);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(original.toArray()).toEqual(before);
      expect(taskFrameDisplayColor(text, original, background)).toBe(display);
      expect(taskFrameDisplayColor("普通框", original, background)).toBe(original);
    }
  },
);

it("refreshes cached frame colors after a status color or theme changes", () => {
  const color = new Color(52, 103, 53);
  const background = new Color(23, 23, 23);
  const green = taskFrameDisplayColor("✅ 问题？", color, background);
  color.g = 12;
  color.b = 14;
  const red = taskFrameDisplayColor("❌ 问题？", color, background);
  expect(red.toString()).not.toBe(green.toString());
  background.r = background.g = background.b = 255;
  expect(taskFrameDisplayColor("❌ 问题？", color, background)).toBe(color);
});
it("counts only question nodes that the renderer actually marks yellow, including legacy nodes", () => {
  Settings.questionMarkYellow = true;
  expect(isYellowQuestionNode("旧问题？")).toBe(true);
  expect(isYellowQuestionNode("Why? \n")).toBe(true);
  for (const text of ["✅ 已解决？", "❌ 失败？", "结论:旧结论？", "猜想:会成立吗？", "普通节点", undefined]) {
    expect(isYellowQuestionNode(text)).toBe(false);
  }
  Settings.questionMarkYellow = false;
  expect(isYellowQuestionNode("旧问题？")).toBe(false);
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
