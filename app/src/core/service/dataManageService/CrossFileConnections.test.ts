import { beforeEach, expect, it, vi } from "vitest";
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() }) }));
vi.hoisted(() =>
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ font: "", measureText: (text: string) => ({ width: text.length * 32 }) }),
    }),
  }),
);
vi.mock("@/core/Project", () => ({
  Project: class {},
  ProjectState: { Saved: "saved", Unsaved: "unsaved" },
  service: () => (target: unknown) => target,
}));
const settings = vi.hoisted(() => ({
  enableCrossFileConnections: true,
  viewerMode: false,
  textNodeMaxCharWidth: 15,
  defaultFontFamily: "sans-serif",
  historyManagerMode: "memoryEfficient",
  historySize: 100,
  watch: () => () => {},
}));
vi.mock("@/core/service/Settings", () => ({ Settings: settings }));
vi.mock("@/core/render/canvas2d/renderer", () => ({ Renderer: { FONT_SIZE: 32, NODE_PADDING: 14 } }));
vi.mock("@/core/service/feedbackService/SoundService", () => ({ SoundService: { play: {} } }));
vi.mock("@/core/stage/stageObject/tools/entityDetailsManager", () => ({ DetailsManager: class {} }));
import type { Project } from "@/core/Project";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { ConnectPoint } from "@/core/stage/stageObject/entity/ConnectPoint";
import { StageManager } from "@/core/stage/stageManager/StageManager";
import { SectionMethods } from "@/core/stage/stageManager/basicMethods/SectionMethods";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { getMultiLineTextSize } from "@/utils/font";
import { serialize, deserialize } from "@graphif/serializer";
import { encode, decode } from "@msgpack/msgpack";
import { URI } from "vscode-uri";
import {
  addCrossFileConnection,
  removeCrossFileConnection,
  resolveCrossFileTarget,
  endpointNode,
} from "./CrossFileConnections";

function fixture(file = "file:///C:/graphs/a.prg") {
  const p = {
    uri: URI.parse(file),
    stage: [],
    emit: vi.fn(),
    textRenderer: {
      measureMultiLineTextSize: (text: string, size: number, width: number, height: number) =>
        getMultiLineTextSize(text, size, height, width),
    },
  } as unknown as Project;
  Object.assign(p, { stageManager: new StageManager(p), sectionMethods: new SectionMethods(p) });
  const node = new TextNode(p, { text: "相同名称" });
  p.stageManager.add(node);
  Object.assign(p, { historyManager: new HistoryManager(p) });
  return { p, node, endpoint: { project: p, nodeId: node.uuid } };
}
beforeEach(() => {
  settings.enableCrossFileConnections = true;
  settings.viewerMode = false;
});

it("records source-only connections, preserves geometry and survives binary restore, undo and redo", () => {
  const a = fixture(),
    b = fixture("file:///C:/graphs/b.prg");
  const targetBefore = serialize(b.p.stage);
  const geometry = a.node.rectangle.clone();
  const link = addCrossFileConnection(a.endpoint, b.endpoint);
  expect(a.node.rectangle).toEqual(geometry);
  expect(serialize(b.p.stage)).toEqual(targetBefore);
  expect(resolveCrossFileTarget(link, [b.p])?.nodeId).toBe(b.node.uuid);
  a.p.historyManager.undo();
  expect(endpointNode(a.endpoint)?.crossFileLinks).toBeUndefined();
  a.p.historyManager.redo();
  expect(endpointNode(a.endpoint)?.crossFileLinks).toEqual([link]);
  a.p.stage = deserialize(decode(encode(serialize(a.p.stage))), a.p);
  a.p.stageManager.updateReferences();
  expect(endpointNode(a.endpoint)?.crossFileLinks).toEqual([link]);
  removeCrossFileConnection(a.endpoint, link.id);
  expect(endpointNode(a.endpoint)?.crossFileLinks).toEqual([]);
  a.p.historyManager.undo();
  expect(endpointNode(a.endpoint)?.crossFileLinks).toEqual([link]);
});

it("rejects disabled, read-only, draft, same-file, duplicate and locked-source creation", () => {
  const a = fixture(),
    b = fixture("file:///D:/graphs/a.prg");
  settings.enableCrossFileConnections = false;
  expect(() => addCrossFileConnection(a.endpoint, b.endpoint)).toThrow();
  settings.enableCrossFileConnections = true;
  settings.viewerMode = true;
  expect(() => addCrossFileConnection(a.endpoint, b.endpoint)).toThrow();
  settings.viewerMode = false;
  expect(() => addCrossFileConnection(a.endpoint, a.endpoint)).toThrow();
  const draft = fixture("draft://test");
  expect(() => addCrossFileConnection(a.endpoint, draft.endpoint)).toThrow();
  vi.spyOn(a.p.sectionMethods, "isObjectBeLockedBySection").mockReturnValueOnce(true);
  expect(() => addCrossFileConnection(a.endpoint, b.endpoint)).toThrow();
  addCrossFileConnection(a.endpoint, b.endpoint);
  expect(() => addCrossFileConnection(a.endpoint, b.endpoint)).toThrow();
  expect(a.node.crossFileLinks).toHaveLength(1);
});

it("retains unresolved links without silently binding to a same-named file or node", () => {
  const a = fixture(),
    b = fixture("file:///D:/graphs/a.prg"),
    c = fixture("file:///E:/graphs/a.prg");
  const link = addCrossFileConnection(a.endpoint, b.endpoint);
  c.node.uuid = b.node.uuid;
  expect(resolveCrossFileTarget(link, [c.p])).toBeUndefined();
  b.p.closing = true;
  expect(resolveCrossFileTarget(link, [b.p])).toBeUndefined();
  b.p.closing = false;
  b.p.stage = [];
  expect(resolveCrossFileTarget(link, [b.p])).toBeUndefined();
  expect(a.node.crossFileLinks).toEqual([link]);
  b.p.stage.push(b.node);
  expect(resolveCrossFileTarget(link, [b.p])?.project).toBe(b.p);
  settings.enableCrossFileConnections = false;
  a.p.stage = deserialize(decode(encode(serialize(a.p.stage))), a.p);
  expect(endpointNode(a.endpoint)?.crossFileLinks).toEqual([link]);
});

it("hydrates optional links on a second real node class and accepts old nodes without link fields", () => {
  const a = fixture(),
    b = fixture("file:///C:/graphs/b.prg");
  const point = new ConnectPoint(a.p, {});
  a.p.stageManager.add(point);
  const link = addCrossFileConnection({ project: a.p, nodeId: point.uuid }, b.endpoint);
  const restored = deserialize(decode(encode(serialize(a.p.stage))), a.p);
  expect(restored.find((node: ConnectPoint) => node.uuid === point.uuid).crossFileLinks).toEqual([link]);
  expect(restored.find((node: TextNode) => node.uuid === a.node.uuid).crossFileLinks).toBeUndefined();
});
