import { Project, service } from "@/core/Project";
import { RectangleNoteEffect } from "@/core/service/feedbackService/effectEngine/concrete/RectangleNoteEffect";
import { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import { StageObject } from "@/core/stage/stageObject/abstract/StageObject";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { Section } from "@/core/stage/stageObject/entity/Section";
import { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { UrlNode } from "@/core/stage/stageObject/entity/UrlNode";
import { Color, ProgressNumber, Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { deserialize, serialize } from "@graphif/serializer";
import {
  findReplacementMatches,
  planTextReplacements,
  type ReplacementMatch,
  type ReplacementTarget,
} from "./contentReplace";

/**
 * 搜索范围枚举
 */
export enum SearchScope {
  /**
   * 搜索整个舞台
   */
  ALL = "all",
  /**
   * 只搜索选中的内容
   */
  SELECTED = "selected",
  /**
   * 搜索选中内容的外接矩形范围内的所有实体
   */
  SELECTED_BOUNDS = "selectedBounds",
}

@service("contentSearch")
export class ContentSearch {
  constructor(private readonly project: Project) {}

  /**
   * 搜索结果
   */
  public searchResultNodes: StageObject[] = [];

  /**
   * 是否忽略大小写
   */
  public isCaseSensitive = false;

  /**
   * 搜索范围
   */
  public searchScope = SearchScope.ALL;

  /**
   * 搜索结果的索引
   */
  public currentSearchResultIndex = 0;
  private replacementCursor: { uuid: string; start: number } | "end" | undefined;

  /**
   * 抽取一个舞台对象的被搜索文本
   * @param stageObject
   * @returns
   */
  public getStageObjectText(stageObject: StageObject): string {
    if (stageObject instanceof TextNode) {
      return stageObject.text + "　" + stageObject.detailsManager.getBeSearchingText();
    } else if (stageObject instanceof Section) {
      return stageObject.text + "　" + stageObject.detailsManager.getBeSearchingText();
    } else if (stageObject instanceof UrlNode) {
      return stageObject.title + "　" + stageObject.detailsManager.getBeSearchingText() + "　" + stageObject.url;
    }
    // 任何实体上都可能会写details
    if (stageObject instanceof Entity) {
      // 不对，这样还是返回"[Object object]" 字符串，但仅仅只是能防止一下报错
      return stageObject.detailsManager.getBeSearchingText();
    }
    // 线上的字
    if (stageObject instanceof Edge) {
      return stageObject.text;
    }
    return "";
  }

  /**
   * 获取选中对象的外接矩形
   * @returns 外接矩形，如果没有选中对象则返回null
   */
  private getSelectedObjectsBounds(): Rectangle | null {
    const selectedObjects = this.project.stageManager.getStageObjects().filter((obj) => obj.isSelected);
    if (selectedObjects.length === 0) {
      return null;
    }

    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = Number.MIN_VALUE;
    let maxY = Number.MIN_VALUE;

    for (const obj of selectedObjects) {
      const rect = obj.collisionBox.getRectangle();
      minX = Math.min(minX, rect.location.x);
      minY = Math.min(minY, rect.location.y);
      maxX = Math.max(maxX, rect.location.x + rect.size.x);
      maxY = Math.max(maxY, rect.location.y + rect.size.y);
    }

    return new Rectangle(new Vector(minX, minY), new Vector(maxX - minX, maxY - minY));
  }

  /**
   * 判断对象是否在指定范围内
   * @param obj 要判断的对象
   * @param bounds 范围矩形
   * @returns 是否在范围内
   */
  private isObjectInBounds(obj: StageObject, bounds: Rectangle): boolean {
    const objRect = obj.collisionBox.getRectangle();
    return (
      objRect.location.x >= bounds.location.x &&
      objRect.location.y >= bounds.location.y &&
      objRect.location.x + objRect.size.x <= bounds.location.x + bounds.size.x &&
      objRect.location.y + objRect.size.y <= bounds.location.y + bounds.size.y
    );
  }

  private getObjectsToSearch(): StageObject[] {
    let objectsToSearch: StageObject[];

    switch (this.searchScope) {
      case SearchScope.SELECTED:
        // 只搜索选中的对象
        objectsToSearch = this.project.stageManager.getStageObjects().filter((obj) => obj.isSelected);
        break;

      case SearchScope.SELECTED_BOUNDS: {
        // 搜索选中对象外接矩形范围内的所有对象
        const bounds = this.getSelectedObjectsBounds();
        if (bounds) {
          objectsToSearch = this.project.stageManager
            .getStageObjects()
            .filter((obj) => this.isObjectInBounds(obj, bounds));
        } else {
          // 如果没有选中对象，搜索所有对象
          objectsToSearch = this.project.stageManager.getStageObjects();
        }
        break;
      }

      case SearchScope.ALL:
      default:
        // 搜索所有对象
        objectsToSearch = this.project.stageManager.getStageObjects();
        break;
    }
    return objectsToSearch;
  }

  public startSearch(searchString: string, autoFocus = true): boolean {
    this.searchResultNodes = [];
    this.replacementCursor = undefined;
    if (searchString === "") return false;
    const objectsToSearch = this.getObjectsToSearch();

    // 执行搜索
    for (const node of objectsToSearch) {
      const text = this.getStageObjectText(node);
      if (this.isCaseSensitive) {
        if (text.includes(searchString)) {
          this.searchResultNodes.push(node);
        }
      } else {
        if (text.toLowerCase().includes(searchString.toLowerCase())) {
          this.searchResultNodes.push(node);
        }
      }
    }
    this.currentSearchResultIndex = -1;

    if (this.searchResultNodes.length > 0) {
      if (autoFocus) {
        const currentNode = this.searchResultNodes[0];
        // currentNode.isSelected = true;
        this.project.effects.addEffect(
          new RectangleNoteEffect(new ProgressNumber(0, 50), currentNode.collisionBox.getRectangle(), Color.Green),
        );
        // 摄像机对准现在的节点
        this.project.camera.location = currentNode.collisionBox.getRectangle().center.clone();
      }

      return true;
    }
    return false;
  }

  /**
   * 切换下一个
   */
  public nextSearchResult() {
    this.replacementCursor = undefined;
    if (this.searchResultNodes.length === 0) return;
    this.currentSearchResultIndex = (this.currentSearchResultIndex + 1) % this.searchResultNodes.length;
    // 取消选择所有节点
    if (this.searchScope === SearchScope.ALL) {
      for (const node of this.project.stageManager.getTextNodes()) node.isSelected = false;
    }
    // 选择当前搜索结果节点
    const currentNode = this.searchResultNodes[this.currentSearchResultIndex];
    if (currentNode) {
      this.project.effects.addEffect(
        new RectangleNoteEffect(new ProgressNumber(0, 50), currentNode.collisionBox.getRectangle(), Color.Green),
      );
      // 摄像机对准现在的节点
      this.project.camera.location = currentNode.collisionBox.getRectangle().center.clone();
    }
  }

  /**
   * 切换上一个
   */
  public previousSearchResult() {
    this.replacementCursor = undefined;
    if (this.searchResultNodes.length === 0) return;
    this.currentSearchResultIndex =
      (this.currentSearchResultIndex - 1 + this.searchResultNodes.length) % this.searchResultNodes.length;
    // 取消选择所有节点
    if (this.searchScope === SearchScope.ALL) {
      for (const node of this.project.stageManager.getTextNodes()) node.isSelected = false;
    }
    // 选择当前搜索结果节点
    const currentNode = this.searchResultNodes[this.currentSearchResultIndex];
    if (currentNode) {
      this.project.effects.addEffect(
        new RectangleNoteEffect(new ProgressNumber(0, 50), currentNode.collisionBox.getRectangle(), Color.Green),
      );
      // 摄像机对准现在的节点
      this.project.camera.location = currentNode.collisionBox.getRectangle().center.clone();
    }
  }

  public chooseSearchResult(index: number) {
    this.currentSearchResultIndex = index;
    this.replacementCursor = undefined;
  }

  private getReplacementTargets(): ReplacementTarget[] {
    const isLocked = (object: StageObject) => {
      const entities =
        object instanceof Edge ? [object.source, object.target] : object instanceof Entity ? [object] : [];
      for (const entity of entities) {
        if (entity instanceof Section && entity.locked) return true;
        const visited = new Set<Section>();
        for (let parent = entity.parentSection; parent && !visited.has(parent); parent = parent.parentSection) {
          if (parent.locked) return true;
          visited.add(parent);
        }
      }
      return false;
    };
    return this.getObjectsToSearch().flatMap((object): ReplacementTarget[] => {
      if (object instanceof TextNode || object instanceof Section || object instanceof Edge) {
        return [
          { uuid: object.uuid, text: object.text, locked: isLocked(object), write: (text) => object.rename(text) },
        ];
      }
      if (object instanceof UrlNode) {
        return [
          { uuid: object.uuid, text: object.title, locked: isLocked(object), write: (text) => object.rename(text) },
        ];
      }
      return [];
    });
  }

  private currentReplacementMatch(matches: ReplacementMatch[]) {
    if (this.replacementCursor === "end") return undefined;
    const current = this.searchResultNodes[this.currentSearchResultIndex];
    const cursor = this.replacementCursor;
    if (cursor && (!current || current.uuid === cursor.uuid)) {
      return matches.find(
        (match) => !match.target.locked && match.target.uuid === cursor.uuid && match.start >= cursor.start,
      );
    }
    if (current) {
      return matches.find((candidate) => !candidate.target.locked && candidate.target.uuid === current.uuid);
    }
    return matches.find((match) => !match.target.locked);
  }

  public getReplacementStatus(query: string) {
    const matches = findReplacementMatches(this.getReplacementTargets(), query, this.isCaseSensitive);
    return {
      count: matches.filter((match) => !match.target.locked).length,
      lockedCount: matches.filter((match) => match.target.locked).length,
      hasCurrent: !!this.currentReplacementMatch(matches),
      atEnd: this.replacementCursor === "end",
    };
  }

  public replaceText(query: string, replacement: string, all: boolean) {
    const targets = this.getReplacementTargets();
    const matches = findReplacementMatches(targets, query, this.isCaseSensitive);
    const current = all ? undefined : this.currentReplacementMatch(matches);
    const chosen = all ? matches : current ? [current] : [];
    const changes = planTextReplacements(chosen, replacement);
    if (changes.length) {
      const snapshot = serialize(this.project.stage);
      try {
        for (const change of changes) change.target.write(change.after);
        this.project.historyManager.recordStep();
      } catch (error) {
        this.project.stage = deserialize(snapshot, this.project);
        this.project.stageManager.updateReferences();
        this.startSearch(query, false);
        throw error;
      }
    }
    this.startSearch(query, false);
    if (!all && current) {
      const remaining = findReplacementMatches(this.getReplacementTargets(), query, this.isCaseSensitive);
      const order = new Map(targets.map((target, index) => [target.uuid, index]));
      const currentOrder = order.get(current.target.uuid)!;
      const next = remaining.find(
        (match) =>
          !match.target.locked &&
          (order.get(match.target.uuid)! > currentOrder ||
            (match.target.uuid === current.target.uuid && match.start >= current.start + replacement.length)),
      );
      this.replacementCursor = next ? { uuid: next.target.uuid, start: next.start } : "end";
      this.currentSearchResultIndex = next
        ? this.searchResultNodes.findIndex((node) => node.uuid === next.target.uuid)
        : -1;
    }
    return {
      count: changes.reduce((count, change) => count + change.count, 0),
      objectCount: changes.length,
      lockedCount: matches.filter((match) => match.target.locked).length,
    };
  }
}
