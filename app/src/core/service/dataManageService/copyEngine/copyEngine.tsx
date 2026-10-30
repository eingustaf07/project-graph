import { Project, service } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { MouseLocation } from "@/core/service/controlService/MouseLocation";
import { isMac } from "@/utils/platform";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { StageObject } from "@/core/stage/stageObject/abstract/StageObject";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Serialized } from "@/types/node";
import { Color, ProgressNumber, Vector } from "@graphif/data-structures";
import { deserialize, serialize } from "@graphif/serializer";
import { Rectangle } from "@graphif/shapes";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { v4 } from "uuid";
import { RectangleNoteEffect } from "../../feedbackService/effectEngine/concrete/RectangleNoteEffect";
import { RectangleNoteReversedEffect } from "../../feedbackService/effectEngine/concrete/RectangleNoteReversedEffect";
import { ClipboardImageUnavailable, CopyEngineImage } from "./copyEngineImage";
import { CopyEngineText } from "./copyEngineText";
import { CopyEngineUtils } from "./copyEngineUtils";
import { chooseCopyMode, type CopyMode } from "./CopyModeDialog";
import {
  decodeClipboardPayload,
  encodeClipboardPayload,
  remapClipboardAttachments,
  type ClipboardPayload,
} from "./ClipboardPayload";
import { centerClipboardEntities } from "./clipboardPosition";
import { waitForClipboardImages } from "./clipboardImages";

@service("copyEngine")
export class CopyEngine {
  private copyEngineImage: CopyEngineImage;
  private copyEngineText: CopyEngineText;
  private choosingCopyMode = false;

  constructor(private readonly project: Project) {
    this.copyEngineImage = new CopyEngineImage(project);
    this.copyEngineText = new CopyEngineText(project);
  }

  async copy(mode?: CopyMode): Promise<boolean> {
    if (this.choosingCopyMode) return false;
    const selected = this.project.stageManager.getSelectedEntities();
    if (!selected.length) {
      toast.info("请先选择要复制的节点");
      return false;
    }
    this.choosingCopyMode = true;
    try {
      const objects = CopyEngineUtils.getAllStageObjectFromEntities(this.project, selected);
      // Snapshot before opening the chooser; a later selection must not change what is copied.
      const serialized = serialize(objects);
      const text = objects
        .filter((object) => object instanceof TextNode)
        .map((node) => node.text)
        .join("\n\n");
      const attachments = await CopyEngineUtils.collectAttachmentFromStageObjects(this.project, objects);
      const choice = mode ?? (await chooseCopyMode());
      if (!choice) return false;
      if (choice === "text" && !text) {
        toast.info("所选节点中没有可复制的文本");
        return false;
      }
      await writeText(choice === "nodes" ? encodeClipboardPayload(serialized, attachments) : text);
      const rect = Rectangle.getBoundingRectangle(selected.map((entity) => entity.collisionBox.getRectangle()));
      this.project.effects.addEffect(new RectangleNoteReversedEffect(new ProgressNumber(0, 100), rect, Color.Green));
      toast.success(choice === "nodes" ? "已复制节点，可在鼠标位置粘贴" : "已复制文本");
      return true;
    } catch (error) {
      toast.error(`复制失败：${String(error)}`);
      return false;
    } finally {
      this.choosingCopyMode = false;
    }
  }

  async paste() {
    const location = this.project.renderer.transformView2World(MouseLocation.vector()).clone();
    try {
      await this.readSystemClipboardAndPaste(location);
      this.project.controller.resetCountdownTimer();
      this.project.loop();
    } catch (error) {
      toast.error(`粘贴失败：${String(error)}`);
    }
  }

  private async pasteNodes(payload: ClipboardPayload, location: Vector) {
    const attachmentIds = new Map<string, string>();
    const addedAttachments: string[] = [];
    let objects: StageObject[] = [];
    let committed = false;
    let inserted = false;
    let previousSelection: StageObject[] = [];
    try {
      // Constructors load their images immediately, so attachments must exist before deserialization.
      for (const [oldId, attachment] of Object.entries(payload.attachments)) {
        const binary = atob(attachment.data);
        const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const id = this.project.addAttachment(new Blob([data], { type: attachment.type }));
        attachmentIds.set(oldId, id);
        addedAttachments.push(id);
      }
      const serialized = structuredClone(payload.stageObjects);
      remapClipboardAttachments(serialized, attachmentIds);
      objects = deserialize(serialized, this.project);
      if (!objects.every((object) => object instanceof StageObject)) throw new Error("剪贴板包含无效的节点对象");
      const entities = objects.filter((object): object is Entity => object instanceof Entity);
      if (!entities.length) throw new Error("剪贴板中没有节点");
      await waitForClipboardImages(entities);
      // References point to the same deserialized instances; change each id only once.
      for (const object of objects) object.uuid = v4();
      const rect = centerClipboardEntities(entities, location);
      previousSelection = this.project.stage.filter((object) => object.isSelected);
      this.project.stageManager.clearSelectAll();
      this.project.stage.push(...objects);
      inserted = true;
      this.project.stageManager.updateReferences();
      const copiedSet = new Set(entities);
      entities
        .filter((entity) => !entity.parentSection || !copiedSet.has(entity.parentSection))
        .forEach((entity) => {
          entity.isSelected = true;
        });
      this.project.historyManager.recordStep();
      committed = true;
      this.project.effects.addEffect(new RectangleNoteEffect(new ProgressNumber(0, 50), rect, Color.Green));
      toast.success("已在鼠标位置居中粘贴节点");
    } catch (error) {
      if (!committed) {
        if (inserted) {
          this.project.stage = this.project.stage.filter((object) => !objects.includes(object));
          previousSelection.forEach((object) => {
            object.isSelected = true;
          });
          this.project.stageManager.updateReferences();
        }
        const disposed = await Promise.allSettled(
          objects.filter((object) => object instanceof StageObject).map((object) => object.dispose?.()),
        );
        for (const id of addedAttachments) this.project.attachments.delete(id);
        const failures = disposed.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failures.length)
          throw new AggregateError(
            [error, ...failures.map((result) => result.reason)],
            "粘贴失败，清理资源时也遇到错误",
            { cause: error },
          );
      }
      throw error;
    }
  }

  async cut() {
    if (await this.copy("nodes")) this.project.stageManager.deleteSelectedStageObjects();
  }

  async readSystemClipboardAndPaste(
    location = this.project.renderer.transformView2World(MouseLocation.vector()).clone(),
  ) {
    const web = Settings.clipboardPasteMode === "webview" || (Settings.clipboardPasteMode === "auto" && isMac);
    let text = "";
    let textError: unknown;
    try {
      text = web ? await navigator.clipboard.readText() : await readText();
    } catch (error) {
      textError = error;
    }
    const payload = decodeClipboardPayload(text);
    if (payload) {
      await this.pasteNodes(payload, location);
      return;
    }
    // Screenshot apps and browsers can publish image and text formats together. Prefer the actual image.
    const imageErrors: unknown[] = [];
    const imageReaders = web
      ? [
          () => this.copyEngineImage.pasteImageFromWebClipboard(location),
          () => this.copyEngineImage.pasteImagesFromFileClipboard(location),
          () => this.copyEngineImage.pasteImageFromTauriClipboard(location),
        ]
      : [
          () => this.copyEngineImage.pasteImagesFromFileClipboard(location),
          () => this.copyEngineImage.pasteImageFromTauriClipboard(location),
          () => this.copyEngineImage.pasteImageFromWebClipboard(location),
        ];
    for (const readImage of imageReaders) {
      try {
        if (!(await readImage())) continue;
        this.project.historyManager.recordStep();
        return;
      } catch (error) {
        if (!(error instanceof ClipboardImageUnavailable)) throw error;
        imageErrors.push(error);
      }
    }
    if (text) {
      await this.copyEngineText.copyEnginePastePlainText(text, location);
      this.project.historyManager.recordStep();
    } else {
      throw new AggregateError(
        [textError, ...imageErrors].filter(Boolean),
        "剪贴板没有可读取的图片或文字；请在 Snipaste 截图后选择复制到剪贴板，再回到 PG 粘贴",
      );
    }
  }
}

export function getRectangleFromSerializedEntities(serializedEntities: Serialized.Entity[]): Rectangle {
  const rectangles: Rectangle[] = [];
  for (const node of serializedEntities) {
    if (
      Serialized.isTextNode(node) ||
      Serialized.isSection(node) ||
      Serialized.isImageNode(node) ||
      Serialized.isUrlNode(node) ||
      Serialized.isPortalNode(node) ||
      Serialized.isSvgNode(node)
    ) {
      rectangles.push(new Rectangle(new Vector(...node.location), new Vector(...node.size)));
    } else if (node.type === "core:connect_point") {
      rectangles.push(new Rectangle(new Vector(...node.location), new Vector(1, 1)));
    }
  }
  return Rectangle.getBoundingRectangle(rectangles);
}
