import { describe, expect, it, vi } from "vitest";
import { generateText } from "ai";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("./BuiltInToolRegistry", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./BuiltInToolRegistry")>();
  return { ...original, invokeBuiltInTool: invoke };
});
import { createBuiltInToolAgentTools } from "./BuiltInToolAgentAdapter";

describe("AI color changes require an explicit approval", () => {
  it("asks for approval without executing a model-requested color change", async () => {
    const tools = createBuiltInToolAgentTools({} as never, {} as never);
    const result = await generateText({
      model: {
        specificationVersion: "v3",
        provider: "fixture",
        modelId: "fixture",
        supportedUrls: {},
        doGenerate: async () => ({
          content: [
            {
              type: "tool-call",
              toolCallId: "color-1",
              toolName: "batch_change_color",
              input: JSON.stringify({ refs: ["n1"], color: [255, 0, 0, 1] }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        }),
      } as never,
      prompt: "整理节点树",
      tools,
    });
    expect(result.content.some((part) => part.type === "tool-approval-request")).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("allows normal edits and default transparent creation while guarding every explicit edit color", async () => {
    const tools = createBuiltInToolAgentTools({} as never, {} as never) as any;
    expect(await tools.edit_text_node.needsApproval({ ref: "n1", data: { text: "内容" } })).toBe(false);
    expect(await tools.edit_text_node.needsApproval({ ref: "n1", data: { color: [0, 0, 0, 0] } })).toBe(true);
    expect(await tools.create_text_node.needsApproval({ text: "默认节点" })).toBe(false);
    expect(await tools.create_text_node.needsApproval({ text: "默认节点", color: [0, 0, 0, 0] })).toBe(false);
    expect(await tools.create_text_node.needsApproval({ text: "有色节点", color: [0, 255, 0, 1] })).toBe(true);
  });
});
