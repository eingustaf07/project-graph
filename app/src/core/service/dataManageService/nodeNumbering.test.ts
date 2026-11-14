import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/core/service/Settings", () => ({
  Settings: { dynamicNodeNumbering: true, questionMarkYellow: true, watch: () => () => {} },
}));
import { Settings } from "@/core/service/Settings";
import {
  markNewNumberingNode,
  numberedNodeText,
  numberingTextChanged,
  queueNodeNumbering,
  refreshNodeNumbering,
} from "./nodeNumbering";
const project = () => ({ stage: [] as any[], controller: { resetCountdownTimer: vi.fn() } }) as any;
function node(text: string): any {
  return {
    uuid: crypto.randomUUID(),
    text,
    sizeAdjust: "auto",
    refreshSizeByTextIfNeeded: vi.fn(),
    forceAdjustHeightByText: vi.fn(),
  };
}
function add(p: any, text: string) {
  const n = node(text);
  markNewNumberingNode(p, n);
  p.stage.push(n);
  return n;
}
beforeEach(() => {
  Settings.dynamicNodeNumbering = true;
  Settings.questionMarkYellow = true;
  vi.spyOn(Date, "now").mockReturnValue(1000);
});
afterEach(async () => {
  await Promise.resolve();
  vi.restoreAllMocks();
});

it("leaves legacy questions and conclusions unnumbered and orders new nodes independently of stage order", () => {
  const p = project(),
    oldQ = node("旧问题？"),
    oldC = node("结论:旧内容");
  p.stage.push(oldQ, oldC);
  const a = add(p, "甲？"),
    b = add(p, "乙？"),
    c = add(p, "丙？");
  p.stage.reverse();
  refreshNodeNumbering(p);
  expect([a, b, c].map((n) => numberedNodeText(p, n))).toEqual(["1. 甲？", "2. 乙？", "3. 丙？"]);
  expect(numberedNodeText(p, oldQ)).toBe(oldQ.text);
  expect(numberedNodeText(p, oldC)).toBe(oldC.text);
  expect(a.text).toBe("甲？");
  expect(b.numberingCreatedAt).toBeGreaterThan(a.numberingCreatedAt);
});

it("renumbers after completion, deletion, insertion and reopening a completed question", async () => {
  const p = project(),
    a = add(p, "甲？"),
    b = add(p, "乙？"),
    c = add(p, "丙？");
  refreshNodeNumbering(p);
  b.text = "✅ 乙？";
  numberingTextChanged(p, b);
  expect(numberedNodeText(p, b)).toBe("✅ 乙？");
  expect(numberedNodeText(p, c)).toBe("2. 丙？");
  p.stage = p.stage.filter((n: any) => n !== a);
  queueNodeNumbering(p);
  await Promise.resolve();
  expect(numberedNodeText(p, c)).toBe("1. 丙？");
  const d = add(p, "丁？");
  refreshNodeNumbering(p);
  expect(numberedNodeText(p, d)).toBe("2. 丁？");
  b.text = "乙？";
  numberingTextChanged(p, b);
  expect([b, c, d].map((n) => numberedNodeText(p, n))).toEqual(["1. 乙？", "2. 丙？", "3. 丁？"]);
});

it("uses independent per-file question and conclusion sequences and preserves records while switched off", () => {
  const p = project(),
    q = add(p, "问题？"),
    c1 = add(p, "结论:甲"),
    c2 = add(p, "结论：乙？");
  refreshNodeNumbering(p);
  expect([q, c1, c2].map((n) => numberedNodeText(p, n))).toEqual(["1. 问题？", "1. 结论:甲", "2. 结论：乙？"]);
  c1.text = "✅ 结论:甲";
  numberingTextChanged(p, c1);
  expect(numberedNodeText(p, c2)).toBe("1. 结论：乙？");
  const created = c2.numberingCreatedAt;
  Settings.dynamicNodeNumbering = false;
  refreshNodeNumbering(p);
  expect(numberedNodeText(p, c2)).toBe(c2.text);
  expect(c2.numberingCreatedAt).toBe(created);
  Settings.dynamicNodeNumbering = true;
  refreshNodeNumbering(p);
  expect(numberedNodeText(p, c2)).toBe("1. 结论：乙？");
  const other = project(),
    next = add(other, "另一个问题？");
  refreshNodeNumbering(other);
  expect(numberedNodeText(other, next)).toBe("1. 另一个问题？");
});

it("does not scan the stage on repeated text reads during camera rendering", () => {
  const p = project(),
    a = add(p, "为什么？");
  refreshNodeNumbering(p);
  const stage = p.stage;
  const read = vi.fn(() => stage);
  Object.defineProperty(p, "stage", { get: read, configurable: true });
  for (let i = 0; i < 10000; i++) expect(numberedNodeText(p, a)).toBe("1. 为什么？");
  expect(read).not.toHaveBeenCalled();
});
