import { expose, Remote, wrap } from "comlink";
import comlinkMinJs from "comlink/dist/esm/comlink.min.js?raw";
import { Extension } from "./Extension";
import { extensionHostApiFactory } from "./api/host";
import { ExtensionRemoteApi } from "./api/remote";

import { setupComlink } from "./setupComlink/host";
import setupComlinkJs from "./setupComlink/remote?raw";
import { toast } from "sonner";
setupComlink();
const comlinkBlob = new Blob([comlinkMinJs], { type: "application/javascript" });
const comlinkUrl = URL.createObjectURL(comlinkBlob);

export class ExtensionRuntime {
  private worker: Worker;
  public remote: Remote<ExtensionRemoteApi>;
  public readonly ready: Promise<void>;
  private finishReady: ((error?: Error) => void) | undefined;

  constructor(public extension: Extension) {
    const nonce = crypto.randomUUID();
    const blob = new Blob(
      [
        `
${setupComlinkJs.replace('from "comlink";', `from "${comlinkUrl}";`)}
setupComlink();
self.prg = Comlink.wrap(self);
(async () => {
  try {
    await (async () => {
      ${extension.code}
    })();
    self.postMessage({ __pgExtensionReady: ${JSON.stringify(nonce)} });
  } catch (error) {
    self.postMessage({ __pgExtensionReady: ${JSON.stringify(nonce)}, error: String(error) });
  }
})();
      `.trim(),
      ],
      { type: "application/javascript" },
    );
    this.worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    this.ready = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        this.finishReady = undefined;
        if (error) reject(error); else resolve();
      };
      const onMessage = (event: MessageEvent) => {
        if (event.data?.__pgExtensionReady === nonce)
          finish(event.data.error ? new Error(event.data.error) : undefined);
      };
      const onError = (event: ErrorEvent) => finish(new Error(event.message || "扩展脚本启动失败"));
      const timer = setTimeout(() => finish(new Error("扩展初始化超时")), 30000);
      this.finishReady = finish;
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
    });
    void this.ready.catch((error: Error) => toast.error(`扩展 ${extension.metadata.extension?.name ?? "未知扩展"} 加载失败：${error.message}`));
    expose(extensionHostApiFactory(extension), this.worker);
    this.remote = wrap(this.worker);
  }

  terminate() {
    this.finishReady?.(new Error("扩展已停止"));
    this.worker.terminate();
  }
}
