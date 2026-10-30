import { OverlayHost } from "@/components/overlay-host";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type CopyMode = "nodes" | "text";

export function chooseCopyMode(): Promise<CopyMode | undefined> {
  return new Promise((resolve) => {
    const finish = (mode?: CopyMode) => {
      OverlayHost.close(overlay.id);
      resolve(mode);
    };
    const overlay = OverlayHost.open(
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) finish();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择复制方式</DialogTitle>
            <DialogDescription>
              复制节点会保留连接、样式和布局；复制文本只保留文字，可粘贴到其他软件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => finish()}>
              取消
            </Button>
            <Button variant="outline" onClick={() => finish("text")}>
              复制文本
            </Button>
            <Button autoFocus onClick={() => finish("nodes")}>
              复制节点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
  });
}
