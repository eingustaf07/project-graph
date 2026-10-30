import type { Project } from "@/core/Project";
import { Settings } from "@/core/service/Settings";
import { RectanglePushInEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectanglePushInEffect";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { ImageNode } from "@/core/stage/stageObject/entity/ImageNode";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { boundedDoodleOf, doodleAt } from "@/core/stage/stageObject/entity/Doodle";
import { fitDoodleBounds } from "@/core/algorithm/doodleBounds";
import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import type { Value } from "platejs";

export type CreateImageNodeFromBlobOptions = {
  location: Vector;
  centerAtLocation?: boolean;
  waitForReady?: boolean;
  doodleOnly?: boolean;
  intrinsicSize?: { width: number; height: number };
  maxDisplaySize?: number;
  details?: Value;
  wrapInSection?: boolean;
};

export function calculateImageDisplaySize(width: number, height: number, maxDisplaySize: number) {
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("图片尺寸无效");
  }
  if (maxDisplaySize <= 0 || Number.isNaN(maxDisplaySize)) throw new Error("图片显示尺寸无效");
  const scale = Math.min(1, maxDisplaySize / Math.max(width, height));
  return { width: width * scale, height: height * scale, scale };
}

export async function createImageNodeFromBlob(
  project: Project,
  blob: Blob,
  options: CreateImageNodeFromBlobOptions,
): Promise<{ node: ImageNode; width: number; height: number }> {
  let width = options.intrinsicSize?.width;
  let height = options.intrinsicSize?.height;
  if (!width || !height) {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  }
  const maxDisplaySize = options.maxDisplaySize ?? Number.POSITIVE_INFINITY;
  const displaySize = calculateImageDisplaySize(width, height, maxDisplaySize);
  const scale = displaySize.scale;
  const location = options.centerAtLocation
    ? options.location.subtract(new Vector(displaySize.width / 2, displaySize.height / 2))
    : options.location.clone();
  const wrapInSection = options.wrapInSection ?? Settings.wrapImageInGroup;
  const boundary =
    doodleAt(
      project,
      options.centerAtLocation
        ? options.location
        : location.add(new Vector(displaySize.width / 2, displaySize.height / 2)),
    ) ?? doodleAt(project, location);
  const imageBounds = new Rectangle(location, new Vector(displaySize.width, displaySize.height));
  const bounds = wrapInSection
    ? new Rectangle(location.subtract(Vector.same(30)), imageBounds.size.add(Vector.same(60)))
    : imageBounds;
  if (boundary && !fitDoodleBounds(boundary.frame, boundary.shape, bounds))
    throw new Error("图片及其分组放不进固定容器，请先扩大边界");
  const attachmentId = project.addAttachment(blob);
  let wrappingSection: Section | undefined;
  const imageNode = new ImageNode(
    project,
    {
      attachmentId,
      collisionBox: new CollisionBox([new Rectangle(location, new Vector(width * scale, height * scale))]),
      details: options.details ?? [],
      scale,
    },
    false,
    wrapInSection
      ? () => {
          const section = Section.fromEntities(project, [imageNode]);
          wrappingSection = section;
          section.text = "";
          section.adjustLocationAndSize();
          project.stageManager.add(section, false, { doodleOnly: options.doodleOnly });
        }
      : undefined,
  );

  try {
    project.stageManager.add(imageNode, false, { doodleOnly: options.doodleOnly });
    const containingSections = project.sectionMethods.getSectionsByInnerLocation(location);
    if (containingSections.length > 0) {
      const target = options.doodleOnly
        ? (boundedDoodleOf(containingSections[0]) ?? containingSections[0])
        : containingSections[0];
      project.stageManager.goInSection([imageNode], target);
      project.effects.addEffect(
        RectanglePushInEffect.sectionGoInGoOut(
          imageNode.collisionBox.getRectangle(),
          containingSections[0].collisionBox.getRectangle(),
        ),
      );
    }

    if (options.waitForReady) await imageNode.waitForClipboardBitmap();
    return { node: imageNode, width, height };
  } catch (error) {
    const disposed = await Promise.allSettled([imageNode.dispose()]);
    const owned = new Set([imageNode, ...(wrappingSection ? [wrappingSection] : [])]);
    project.stage = project.stage.filter((object) => !owned.has(object as ImageNode | Section));
    for (const section of project.stageManager.getSections())
      section.children = section.children.filter((child) => !owned.has(child as ImageNode | Section));
    project.attachments.delete(attachmentId);
    project.stageManager.updateReferences();
    const failure = disposed.find((result) => result.status === "rejected");
    if (failure?.status === "rejected")
      throw new AggregateError([error, failure.reason], "图片添加失败，资源清理时也遇到错误", { cause: error });
    throw error;
  }
}
