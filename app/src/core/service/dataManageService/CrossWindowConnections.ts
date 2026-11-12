import type { CrossFileEdgeStyle, CrossFileNodeLink } from "@/core/stage/stageObject/abstract/ConnectableEntity";

export type ScreenPoint = { x: number; y: number };
export type ScreenRect = ScreenPoint & { width: number; height: number };
export type WindowGeometry = {
  outer: ScreenRect;
  origin: ScreenPoint;
  scale: number;
};
export type FileNodeRef = { file: string; nodeId: string };
export type WindowFileGraph = {
  file: string;
  nodes: string[];
  members: string[][];
  directed: { source: string; target: string }[];
  links: { source: string; link: CrossFileNodeLink }[];
  roots: string[];
};
export type WindowGraphSnapshot = {
  id: string;
  geometry?: WindowGeometry;
  lineStyle?: string;
  files: WindowFileGraph[];
  points: (FileNodeRef & ScreenPoint & { halfWidth?: number; halfHeight?: number })[];
  selection?: FileNodeRef & { at: number };
};
type Request = {
  type: "request";
  id: string;
  from: string;
  to: string;
  source: FileNodeRef;
  action: "connect" | "edit" | "remove" | "undo" | "redo";
  target?: FileNodeRef;
  linkId?: string;
  patch?: CrossFileEdgeStyle;
};
type Message =
  | { type: "snapshot"; value: Omit<WindowGraphSnapshot, "files"> & { files?: WindowFileGraph[] } }
  | { type: "hello" }
  | { type: "leave"; id: string }
  | Request
  | { type: "result"; id: string; to: string; error?: string };

/** Snap borders may overlap by a few physical pixels. Corner contact and overlapping windows do not count. */
export function adjacentWindows(a: ScreenRect, b: ScreenRect): boolean {
  const finite = (r: ScreenRect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
  if (!finite(a) || !finite(b)) return false;
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const gapX = Math.min(Math.abs(a.x + a.width - b.x), Math.abs(b.x + b.width - a.x));
  const gapY = Math.min(Math.abs(a.y + a.height - b.y), Math.abs(b.y + b.height - a.y));
  return (gapX <= 12 && overlapY >= 32) || (gapY <= 12 && overlapX >= 32);
}

export function screenToClient(point: ScreenPoint, geometry: WindowGeometry): ScreenPoint {
  return { x: (point.x - geometry.origin.x) / geometry.scale, y: (point.y - geometry.origin.y) / geometry.scale };
}

/** Only the window owning the source file writes a link and records its undo transaction. */
export class CrossWindowConnectionBus {
  private readonly peers = new Map<
    string,
    { value: WindowGraphSnapshot; seen: number; filesSignature: string; positionSignature: string }
  >();
  private readonly requests = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly handled = new Map<string, Promise<string | undefined>>();
  private closed = false;
  private local?: WindowGraphSnapshot;
  private publishedFiles?: WindowFileGraph[];
  constructor(
    readonly id: string,
    private readonly channel: Pick<BroadcastChannel, "postMessage" | "close" | "onmessage">,
    private readonly onChange: () => void,
    private readonly execute: (request: Request) => void | Promise<void>,
  ) {
    channel.onmessage = ({ data }: MessageEvent<Message>) => this.receive(data);
    channel.postMessage({ type: "hello" } satisfies Message);
  }

  publish(value: WindowGraphSnapshot) {
    this.local = value;
    this.prune();
    const files = value.files === this.publishedFiles ? undefined : value.files;
    this.publishedFiles = value.files;
    this.channel.postMessage({ type: "snapshot", value: { ...value, files } } satisfies Message);
  }
  snapshots(): WindowGraphSnapshot[] {
    this.prune();
    return [...this.peers.values()].map(({ value }) => value);
  }
  private prune() {
    for (const [id, peer] of this.peers) if (Date.now() - peer.seen > 1500) this.peers.delete(id);
  }
  private receive(message: Message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "hello") {
      if (this.local) this.channel.postMessage({ type: "snapshot", value: this.local } satisfies Message);
    } else if (message.type === "snapshot" && message.value?.id !== this.id) {
      const value = message.value;
      if (!value || typeof value.id !== "string" || !Array.isArray(value.points)) return;
      const previous = this.peers.get(value.id),
        files = value.files ?? previous?.value.files;
      if (!Array.isArray(files)) {
        this.channel.postMessage({ type: "hello" } satisfies Message);
        return;
      }
      if (
        !files.every(
          (file) =>
            file &&
            typeof file.file === "string" &&
            [file.nodes, file.members, file.directed, file.links, file.roots].every(Array.isArray) &&
            file.nodes.every((id) => typeof id === "string") &&
            file.roots.every((id) => typeof id === "string") &&
            file.members.every((group) => Array.isArray(group) && group.every((id) => typeof id === "string")) &&
            file.directed.every((edge) => edge && typeof edge.source === "string" && typeof edge.target === "string") &&
            file.links.every(
              (edge) =>
                edge &&
                typeof edge.source === "string" &&
                edge.link &&
                typeof edge.link.id === "string" &&
                typeof edge.link.targetFile === "string" &&
                typeof edge.link.targetNode === "string",
            ),
        )
      )
        return;
      if (
        !value.points.every(
          (point) =>
            point &&
            typeof point.file === "string" &&
            typeof point.nodeId === "string" &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y),
        )
      )
        return;
      const geometry = value.geometry;
      if (
        geometry &&
        (!geometry.outer ||
          !geometry.origin ||
          ![
            geometry.outer.x,
            geometry.outer.y,
            geometry.outer.width,
            geometry.outer.height,
            geometry.origin.x,
            geometry.origin.y,
            geometry.scale,
          ].every(Number.isFinite) ||
          geometry.scale <= 0)
      )
        return;
      const filesSignature = value.files ? JSON.stringify(files) : previous!.filesSignature;
      const positionSignature = JSON.stringify({ ...value, files: undefined });
      const changed = filesSignature !== previous?.filesSignature || positionSignature !== previous?.positionSignature;
      this.peers.set(value.id, { value: { ...value, files }, seen: Date.now(), filesSignature, positionSignature });
      if (changed) this.onChange();
    } else if (message.type === "leave") {
      this.peers.delete(message.id);
      this.onChange();
    } else if (message.type === "result" && message.to === this.id) {
      const pending = this.requests.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.requests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve();
    } else if (message.type === "request" && message.to === this.id) {
      if (
        !["connect", "edit", "remove", "undo", "redo"].includes(message.action) ||
        !message.source ||
        typeof message.source.file !== "string" ||
        typeof message.source.nodeId !== "string"
      )
        return;
      let result = this.handled.get(message.id);
      if (!result) {
        result = (async () => {
          try {
            const peer = this.snapshots().find((p) => p.id === message.from);
            if (
              !this.local?.geometry ||
              !peer?.geometry ||
              !adjacentWindows(this.local.geometry.outer, peer.geometry.outer)
            )
              throw new Error("两个窗口必须紧密相邻，才能操作跨窗口连线");
            if (
              message.action === "connect" &&
              (!message.target ||
                !peer.files.some((f) => f.file === message.target!.file && f.nodes.includes(message.target!.nodeId)))
            )
              throw new Error("另一窗口中的目标文件或节点已关闭");
            if (
              message.action === "connect" &&
              (this.local.selection?.file !== message.source.file ||
                this.local.selection.nodeId !== message.source.nodeId)
            )
              throw new Error("来源窗口的选中节点已改变，请重新选择");
            await this.execute(message);
            return undefined;
          } catch (e) {
            return String(e);
          }
        })();
        this.handled.set(message.id, result);
        if (this.handled.size > 100) this.handled.delete(this.handled.keys().next().value!);
      }
      void result.then((error) => {
        if (!this.closed)
          this.channel.postMessage({ type: "result", id: message.id, to: message.from, error } satisfies Message);
      });
    }
  }

  request(
    to: string,
    action: Request["action"],
    source: FileNodeRef,
    values: Pick<Request, "target" | "linkId" | "patch"> = {},
  ) {
    const id = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error("另一窗口未响应，请确认窗口仍打开且紧密相邻"));
      }, 2000);
      this.requests.set(id, { resolve, reject, timer });
      this.channel.postMessage({ type: "request", id, from: this.id, to, source, action, ...values } satisfies Request);
    });
  }
  dispose() {
    this.closed = true;
    this.channel.postMessage({ type: "leave", id: this.id } satisfies Message);
    this.channel.onmessage = null;
    this.channel.close();
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("跨窗口连线已关闭"));
    }
    this.requests.clear();
    this.peers.clear();
  }
}
