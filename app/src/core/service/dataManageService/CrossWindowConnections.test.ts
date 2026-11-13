import { afterEach, expect, it, vi } from "vitest";
import { BroadcastChannel as NativeBroadcastChannel } from "node:worker_threads";
import {
  adjacentWindows,
  adjacentWindowGeometries,
  screenToClient,
  CrossWindowConnectionBus,
  type WindowGraphSnapshot,
} from "./CrossWindowConnections";

it.each([
  [{ x: 0, y: 0, width: 1280, height: 1440 }, { x: 1280, y: 0, width: 1280, height: 1440 }, true],
  [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 2560, height: 1440 }, true],
  [{ x: 0, y: 0, width: 2560, height: 1440 }, { x: 2560, y: 0, width: 1920, height: 1080 }, true],
  [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 0, y: 800, width: 1000, height: 800 }, true],
  [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 1020, y: 0, width: 1000, height: 800 }, false],
  [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 0, y: 0, width: 1000, height: 800 }, false],
  [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 1000, y: 800, width: 1000, height: 800 }, false],
  [{ x: 0, y: 0, width: 1000, height: 800 }, { x: 994, y: 0, width: 1000, height: 800 }, true],
])("checks adjacency in desktop physical coordinates", (a, b, expected) => {
  expect(adjacentWindows(a, b)).toBe(expected);
  expect(adjacentWindows(b, a)).toBe(expected);
});

it("uses content bounds when Windows invisible resize borders overlap at high DPI", () => {
  const a = {
    outer: { x: 769, y: 0, width: 1800, height: 1609 },
    origin: { x: 780, y: 2 },
    scale: 1.5,
    content: { x: 780, y: 2, width: 1778, height: 1585 },
  };
  const b = {
    outer: { x: 2549, y: 299, width: 1942, height: 1102 },
    origin: { x: 2560, y: 310 },
    scale: 1.5,
    content: { x: 2560, y: 310, width: 1920, height: 1080 },
  };
  expect(adjacentWindows(a.outer, b.outer)).toBe(false);
  expect(adjacentWindowGeometries(a, b)).toBe(true);
  expect(adjacentWindowGeometries(b, a)).toBe(true);
  expect(adjacentWindowGeometries(a, { ...b, content: { ...b.content, x: 2600 } })).toBe(false);
  expect(adjacentWindowGeometries(a, { ...b, content: { ...b.content, x: 2400 } })).toBe(false);
});
it("maps endpoints correctly with negative monitor coordinates and 150 percent scaling", () => {
  expect(
    screenToClient(
      { x: -150, y: 600 },
      { origin: { x: -1200, y: 150 }, outer: { x: -1200, y: 150, width: 1200, height: 900 }, scale: 1.5 },
    ),
  ).toEqual({ x: 700, y: 300 });
});

function network() {
  const channels: { onmessage: BroadcastChannel["onmessage"]; postMessage: (data: any) => void; close: () => void }[] =
    [];
  return () => {
    const channel = {
      onmessage: null as BroadcastChannel["onmessage"],
      postMessage: (data: any) => {
        for (const other of channels)
          if (other !== channel)
            queueMicrotask(() =>
              other.onmessage?.call(other as BroadcastChannel, { data: structuredClone(data) } as MessageEvent),
            );
      },
      close: () => {
        channels.splice(channels.indexOf(channel), 1);
      },
    };
    channels.push(channel);
    return channel;
  };
}
function snapshot(id: string, x: number): WindowGraphSnapshot {
  const file = "file:///c:/" + id + ".prg";
  return {
    id,
    geometry: { outer: { x, y: 0, width: 1000, height: 800 }, origin: { x, y: 0 }, scale: 1 },
    files: [{ file, nodes: [id], members: [], directed: [], links: [], roots: [] }],
    points: [],
    selection: { file, nodeId: id, at: Date.now() },
  };
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
async function pair() {
  const channel = network(),
    execute = vi.fn();
  const a = new CrossWindowConnectionBus("a", channel(), vi.fn(), execute),
    b = new CrossWindowConnectionBus("b", channel(), vi.fn(), vi.fn());
  cleanups.push(
    () => a.dispose(),
    () => b.dispose(),
  );
  const first = snapshot("a", 0),
    second = snapshot("b", 1000);
  a.publish(first);
  b.publish(second);
  await Promise.resolve();
  return { a, b, execute, first, second };
}
it("sends a create request only to the source owner and awaits its acknowledgement", async () => {
  const { b, execute } = await pair();
  await b.request(
    "a",
    "connect",
    { file: "file:///c:/a.prg", nodeId: "a" },
    { target: { file: "file:///c:/b.prg", nodeId: "b" } },
  );
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0].action).toBe("connect");
});
it("accepts source-owner commands across adjoining content areas despite overlapping native window borders", async () => {
  const { a, b, first, second, execute } = await pair();
  first.geometry!.outer = { x: -10, y: -10, width: 1020, height: 820 };
  first.geometry!.content = { x: 0, y: 0, width: 1000, height: 800 };
  second.geometry!.outer = { x: 990, y: -10, width: 1020, height: 820 };
  second.geometry!.content = { x: 1000, y: 0, width: 1000, height: 800 };
  a.publish(first);
  b.publish(second);
  await Promise.resolve();
  await b.request(
    "a",
    "connect",
    { file: "file:///c:/a.prg", nodeId: "a" },
    { target: { file: "file:///c:/b.prg", nodeId: "b" } },
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it("rechecks adjacency after a window is moved away", async () => {
  const { b, execute, second } = await pair();
  second.geometry!.outer.x = 1400;
  b.publish(second);
  await Promise.resolve();
  await expect(
    b.request(
      "a",
      "connect",
      { file: "file:///c:/a.prg", nodeId: "a" },
      { target: { file: "file:///c:/b.prg", nodeId: "b" } },
    ),
  ).rejects.toThrow("紧密相邻");
  expect(execute).not.toHaveBeenCalled();
});
it("rejects stale source selections and missing destination nodes", async () => {
  const { a, b, first, execute } = await pair();
  first.selection = undefined;
  a.publish(first);
  await Promise.resolve();
  await expect(
    b.request(
      "a",
      "connect",
      { file: "file:///c:/a.prg", nodeId: "a" },
      { target: { file: "file:///c:/b.prg", nodeId: "b" } },
    ),
  ).rejects.toThrow("选中节点");
  await expect(
    b.request(
      "a",
      "connect",
      { file: "file:///c:/a.prg", nodeId: "a" },
      { target: { file: "file:///c:/b.prg", nodeId: "deleted" } },
    ),
  ).rejects.toThrow("目标文件或节点");
  expect(execute).not.toHaveBeenCalled();
});
it("forwards edits, deletion and history to the source owner", async () => {
  const { b, execute } = await pair();
  for (const action of ["edit", "remove", "undo", "redo"] as const)
    await b.request(
      "a",
      action,
      { file: "file:///c:/a.prg", nodeId: "a" },
      { linkId: "link", patch: { direction: "undirected", text: "label" } },
    );
  expect(execute.mock.calls.map(([request]) => request.action)).toEqual(["edit", "remove", "undo", "redo"]);
});
it("expires an unresponsive window instead of keeping a ghost endpoint", async () => {
  vi.useFakeTimers();
  const { b } = await pair();
  await vi.advanceTimersByTimeAsync(1600);
  expect(b.snapshots()).toHaveLength(0);
  const request = b.request("closed", "remove", { file: "file:///c:/a.prg", nodeId: "a" }, { linkId: "link" });
  const rejection = expect(request).rejects.toThrow("未响应");
  await vi.advanceTimersByTimeAsync(2001);
  await rejection;
});

it("coalesces retried requests while the source is still checking the window position", async () => {
  const channel = network(),
    ca = channel(),
    cb = channel();
  let release!: () => void;
  const checking = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.fn(),
    execute = vi.fn(async () => {
      await checking;
      write();
    });
  const a = new CrossWindowConnectionBus("a", ca, vi.fn(), execute),
    b = new CrossWindowConnectionBus("b", cb, vi.fn(), vi.fn());
  cleanups.push(
    () => a.dispose(),
    () => b.dispose(),
  );
  a.publish(snapshot("a", 0));
  b.publish(snapshot("b", 1000));
  await Promise.resolve();
  const outgoing = vi.spyOn(cb, "postMessage");
  const request = b.request(
    "a",
    "connect",
    { file: "file:///c:/a.prg", nodeId: "a" },
    { target: { file: "file:///c:/b.prg", nodeId: "b" } },
  );
  const packet = outgoing.mock.calls.find(([message]) => message.type === "request")![0];
  cb.postMessage(packet);
  await Promise.resolve();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
  release();
  await request;
  expect(write).toHaveBeenCalledTimes(1);
});

it("exchanges snapshots and commands using real BroadcastChannel ports", async () => {
  const name = "pg-window-test-" + crypto.randomUUID();
  const a = new CrossWindowConnectionBus(
    "a",
    new NativeBroadcastChannel(name) as unknown as BroadcastChannel,
    vi.fn(),
    vi.fn(),
  );
  const write = vi.fn();
  const b = new CrossWindowConnectionBus(
    "b",
    new NativeBroadcastChannel(name) as unknown as BroadcastChannel,
    vi.fn(),
    write,
  );
  try {
    a.publish(snapshot("a", 0));
    b.publish(snapshot("b", 1000));
    for (let i = 0; i < 40 && (!a.snapshots().length || !b.snapshots().length); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(a.snapshots()).toHaveLength(1);
    expect(b.snapshots()).toHaveLength(1);
    await a.request(
      "b",
      "connect",
      { file: "file:///c:/b.prg", nodeId: "b" },
      { target: { file: "file:///c:/a.prg", nodeId: "a" } },
    );
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    a.dispose();
    b.dispose();
  }
});

it("isolates malformed peer data and unknown commands from project code", async () => {
  const channel = network(),
    sender = channel(),
    receiver = channel(),
    execute = vi.fn(),
    changed = vi.fn();
  const bus = new CrossWindowConnectionBus("a", receiver, changed, execute);
  try {
    bus.publish(snapshot("a", 0));
    sender.postMessage({ type: "snapshot", value: snapshot("b", 1000) });
    await Promise.resolve();
    expect(bus.snapshots()).toHaveLength(1);
    changed.mockClear();
    sender.postMessage({ type: "snapshot", value: { id: "bad", files: [null], points: [] } });
    sender.postMessage({
      type: "request",
      id: "unknown",
      from: "b",
      to: "a",
      source: { file: "file:///c:/a.prg", nodeId: "a" },
      action: "unknown-action",
    });
    await Promise.resolve();
    expect(bus.snapshots()).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  } finally {
    bus.dispose();
    sender.close();
  }
});
