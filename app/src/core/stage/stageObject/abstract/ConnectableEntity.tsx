import { Vector } from "@graphif/data-structures";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { serializable } from "@graphif/serializer";

export type CrossFileNodeLink = { id: string; targetFile: string; targetNode: string };

/**
 * 一切可被Edge连接的东西，且会算入图分析算法的东西
 */
export abstract class ConnectableEntity extends Entity {
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
        .map(({ id, targetFile, targetNode }) => ({ id, targetFile, targetNode }));
    }
  }
  /**
   * 几何中心点
   * 用于联动旋转等算法
   */
  abstract geometryCenter: Vector;

  public unknown = false;
}
