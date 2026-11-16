// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const state = vi.hoisted(() => ({
  active: undefined as unknown,
  showYellowQuestionCount: false,
  questionMarkYellow: true,
}));
vi.mock("@/state", () => ({ activeResourceTabAtom: "active" }));
vi.mock("jotai", () => ({ useAtomValue: () => state.active }));
vi.mock("@/core/Project", async () => {
  const { EventEmitter } = await import("node:events");
  return { Project: class extends EventEmitter {} };
});
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({
  TextNode: class {
    text: string;
    constructor(_project: unknown, data: { text?: string }) {
      this.text = data.text ?? "";
    }
  },
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    get questionMarkYellow() {
      return state.questionMarkYellow;
    },
    use: (key: "showYellowQuestionCount" | "questionMarkYellow") => [state[key], vi.fn()],
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options: { count: number }) => `问题 ${options.count}` }),
}));

import { Project } from "@/core/Project";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import YellowQuestionCount from "./yellow-question-count";

const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(() => root?.unmount());
  host.remove();
  state.showYellowQuestionCount = false;
  state.questionMarkYellow = true;
});
function setup(stage: unknown[]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const reads = vi.fn(() => stage);
  const project = Object.assign(new Project(undefined as never), { closing: false });
  Object.defineProperty(project, "stage", {
    get: reads,
    set: (value) => {
      stage = value;
    },
  });
  state.active = project;
  document.body.append(host);
  root = createRoot(host);
  return { project, reads, render: () => act(() => root.render(<YellowQuestionCount />)) };
}

it("shows only a small current-file count, updates after edits/status/deletion/undo and releases inactive file listeners", async () => {
  const question = new TextNode(undefined as never, { text: "历史问题？" });
  const texts = ["Why?  ", "✅ 已解决？", "❌ 待处理？", "结论:为什么？", "猜想:为什么？", "普通节点"];
  const nodes = texts.map((text) => new TextNode(undefined as never, { text }));
  const stage = [question, ...nodes, { text: "框标题？" }];
  const { project, render } = setup(stage);
  state.showYellowQuestionCount = true;
  await render();
  const counter = () => host.querySelector<HTMLElement>("[data-yellow-question-count]")!;
  expect(counter().textContent).toBe("问题 2");
  expect(counter().tagName).toBe("SPAN");
  expect(counter().className).toContain("pointer-events-none");
  expect(counter().querySelector("button,dialog,aside")).toBeNull();
  await act(() => {
    question.text = "普通文字";
    project.emit("stage-content-change");
  });
  expect(counter().textContent).toBe("问题 1");
  await act(() => {
    nodes[0].text = "✅ Why?";
    project.emit("stage-commit");
  });
  expect(counter().textContent).toBe("问题 0");
  await act(() => {
    project.stage = [question];
    project.emit("stage-content-change");
  });
  expect(counter().textContent).toBe("问题 0");
  await act(() => {
    question.text = "恢复的问题？";
    project.stage = stage as never;
    project.emit("stage-content-change");
  });
  expect(counter().textContent).toBe("问题 1");
  state.questionMarkYellow = false;
  await render();
  expect(counter().textContent).toBe("问题 0");
  state.questionMarkYellow = true;
  state.active = Object.assign(new Project(undefined as never), { stage: [], closing: false });
  await render();
  expect(counter().textContent).toBe("问题 0");
  expect((project as unknown as EventEmitter).listenerCount("stage-content-change")).toBe(0);
  state.showYellowQuestionCount = false;
  await render();
  expect(counter()).toBeNull();
});

it("does no scans while disabled or navigating and batches content updates", async () => {
  const { project, reads, render } = setup([]);
  await render();
  expect(reads).not.toHaveBeenCalled();
  state.showYellowQuestionCount = true;
  await render();
  expect(reads).toHaveBeenCalledOnce();
  await act(() => {
    for (let i = 0; i < 1000; i++) project.emit("camera-change");
  });
  expect(reads).toHaveBeenCalledOnce();
  await act(() => {
    for (let i = 0; i < 100; i++) project.emit("stage-content-change");
  });
  expect(reads).toHaveBeenCalledTimes(2);
  state.showYellowQuestionCount = false;
  await render();
  await act(() => project.emit("stage-commit"));
  expect(reads).toHaveBeenCalledTimes(2);
});
