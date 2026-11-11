import { Vector } from "@graphif/data-structures";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { serializable } from "@graphif/serializer";

export type CrossFileEdgeStyle = {
  direction?: "forward" | "reverse" | "undirected";
  text?: string;
  color?: string;
  lineType?: "solid" | "dashed" | "double";
  curve?: boolean;
  arrow?: "default" | "filled-triangle" | "hollow-triangle" | "filled-diamond" | "hollow-diamond";
};
export type CrossFileNodeLink = CrossFileEdgeStyle & { id: string; targetFile: string; targetNode: string };

/**
 * 一切可被Edge连接的东西，且会算入图分析算法的东西
 */
export abstract class ConnectableEntity extends Entity {
  override get isSelected(): boolean {
    return this._isSelected;
  }

  override set isSelected(value: boolean) {
    if (this._isSelected === value) return;
    this._isSelected = value;
    this.project?.searchContentHighlightRenderer?.invalidateSelection();
  }

  @serializable
  public crossFileLinks?: CrossFileNodeLink[];

  constructor(links?: CrossFileNodeLink[]) {
    super();
    if (Array.isArray(links)) {
      this.crossFileLinks = links
        .filter(
          (link) =>
            link &&
            typeof link.id === "string" &&
            typeof link.targetFile === "string" &&
            typeof link.targetNode === "string",
        )
        .map((link) => ({ ...link }));
    }
  }
  /**
   * 几何中心点
   * 用于联动旋转等算法
   */
  abstract geometryCenter: Vector;

  public unknown = false;
}
