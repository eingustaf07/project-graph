import {
  crossFileHighlighted,
  crossFileHighlightCount,
  invalidateCrossFileHighlight,
} from "@/core/service/dataManageService/crossFileHighlight";
import { Color } from "@graphif/data-structures";
import { Project, service } from "@/core/Project";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { collectChainNodeIds, collectConnectedNodeIds } from "@/core/algorithm/connectedNodeHighlight";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { Settings } from "@/core/service/Settings";

/**
 * 搜索结果与连通节点的临时高亮，不改变对象的实际颜色或选择状态。
 */
@service("searchContentHighlightRenderer")
export class SearchContentHighlightRenderer {
  private roots = new Set<string>();
  private connectedNodes: ConnectableEntity[] = [];
  private cachedStage: Project["stage"] | undefined;
  private cachedStageLength = -1;
  private cachedScope?: typeof Settings.connectedNodeHighlightScope;
  private dirty = true;
  private selectionDirty = true;
  private followingSelection = false;
  public invalidateSelection() {
    this.selectionDirty = true;
    if (Settings.connectedNodeHighlightLocked) invalidateCrossFileHighlight();
  }
  public crossFileRoots() {
    return Settings.connectedNodeHighlightLocked ? this.selectedRoots() : this.roots;
  }
  private readonly invalidate = () => {
    invalidateCrossFileHighlight();
    this.dirty = true;
  };

  constructor(private readonly project: Project) {
    project.on("stage-commit", this.invalidate);
  }

  get hasConnectedHighlight() {
    return this.roots.size > 0;
  }

  private selectedRoots() {
    const selected = this.project.stageManager
      .getSelectedEntities()
      .filter((node) => node instanceof ConnectableEntity);
    return new Set(selected.map((node) => node.uuid));
  }

  public toggleConnectedHighlight(): number {
    invalidateCrossFileHighlight();
    if (this.followingSelection && !Settings.connectedNodeHighlightLocked) {
      this.followingSelection = false;
      this.roots.clear();
      this.connectedNodes = [];
    }
    const next = this.selectedRoots();
    if (!next.size || (next.size === this.roots.size && [...next].every((id) => this.roots.has(id)))) {
      this.roots.clear();
      this.connectedNodes = [];
      return 0;
    }
    this.roots = next;
    this.dirty = true;
    this.refreshConnectedNodes();
    return crossFileHighlighted(this.project) ? crossFileHighlightCount() : this.connectedNodes.length;
  }

  private refreshConnectedNodes() {
    if (!this.roots.size) return;
    const scope = Settings.connectedNodeHighlightScope;
    if (
      !this.dirty &&
      this.cachedStage === this.project.stage &&
      this.cachedStageLength === this.project.stage.length &&
      this.cachedScope === scope
    )
      return;
    const nodes = this.project.stageManager.getEntities().filter((node) => node instanceof ConnectableEntity);
    const associations = this.project.stageManager
      .getAssociations()
      .filter((association) => association instanceof ConnectableAssociation);
    const nodeIds = nodes.map((node) => node.uuid);
    const liveIds = new Set(nodeIds);
    this.roots = new Set([...this.roots].filter((id) => liveIds.has(id)));
    const ids =
      scope === "chain"
        ? collectChainNodeIds(
            nodeIds,
            associations.filter((a) => a instanceof Edge),
            this.roots,
          )
        : collectConnectedNodeIds(
            nodeIds,
            associations.map((a) => a.associationList),
            this.roots,
            scope,
          );
    this.connectedNodes = nodes.filter((node) => ids.has(node.uuid));
    if (!this.connectedNodes.length) this.roots.clear();
    this.cachedStage = this.project.stage;
    this.cachedStageLength = this.project.stage.length;
    this.cachedScope = scope;
    this.dirty = false;
  }

  dispose() {
    this.project.off("stage-commit", this.invalidate);
    this.roots.clear();
    this.connectedNodes = [];
  }

  // Existing callers may still pass the canvas frame number.
  render(frameTickIndex?: number): void;
  render() {
    const locked = Settings.connectedNodeHighlightLocked;
    if (
      locked &&
      (!this.followingSelection ||
        this.selectionDirty ||
        this.dirty ||
        this.cachedStage !== this.project.stage ||
        this.cachedStageLength !== this.project.stage.length)
    ) {
      this.roots = this.selectedRoots();
      this.selectionDirty = false;
      this.dirty = true;
      if (!this.roots.size) {
        this.connectedNodes = [];
        this.cachedStage = this.project.stage;
        this.cachedStageLength = this.project.stage.length;
        this.dirty = false;
      }
    } else if (!locked && this.followingSelection) {
      this.roots.clear();
      this.connectedNodes = [];
    }
    this.followingSelection = locked;
    this.refreshConnectedNodes();
    const selectedColor = this.project.stageStyleManager.currentStyle.CollideBoxSelected;
    const outline = new Color(255 - selectedColor.r, 255 - selectedColor.g, 255 - selectedColor.b, 0.9);
    for (const node of crossFileHighlighted(this.project) ?? this.connectedNodes) {
      if (node.isHiddenBySectionCollapse) continue;
      const bounds = node.collisionBox.getRectangle();
      const rect = node.isSelected
        ? this.project.renderer
            .transformWorld2View(bounds)
            .expandFromCenter(this.project.collisionBoxRenderer.selectionOutset(node.collisionBox) + 5)
        : this.project.renderer.transformWorld2View(bounds.expandFromCenter(10));
      this.project.shapeRenderer.renderRect(rect, Color.Transparent, outline, 4);
    }
    const { searchResultNodes, locatedResult } = this.project.contentSearch;
    if (!searchResultNodes.length) return;
    const matchColor = this.project.stageStyleManager.currentStyle.effects.warningShadow.toNewAlpha(0.5);
    for (const stageObject of searchResultNodes) {
      const bounds = stageObject.collisionBox.getRectangle();
      this.project.shapeRenderer.renderRect(
        this.project.renderer.transformWorld2View(bounds.expandFromCenter(10)),
        Color.Transparent,
        matchColor,
        4,
      );
      if (locatedResult?.node === stageObject) {
        this.project.shapeRenderer.renderRect(
          this.project.renderer.transformWorld2View(bounds),
          Color.Transparent,
          locatedResult.color,
          2,
        );
      }
    }
  }
}
