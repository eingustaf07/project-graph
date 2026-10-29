import { Color } from "@graphif/data-structures";
import { Project, service } from "@/core/Project";
import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { collectConnectedNodeIds } from "@/core/algorithm/connectedNodeHighlight";
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
  private cachedScope: "direct" | "all" | undefined;
  private dirty = true;
  private readonly invalidate = () => {
    this.dirty = true;
  };

  constructor(private readonly project: Project) {
    project.on("stage-commit", this.invalidate);
  }

  get hasConnectedHighlight() {
    return this.roots.size > 0;
  }

  public toggleConnectedHighlight(): number {
    const selected = this.project.stageManager
      .getSelectedEntities()
      .filter((node) => node instanceof ConnectableEntity);
    const next = new Set(selected.map((node) => node.uuid));
    if (!next.size || (next.size === this.roots.size && [...next].every((id) => this.roots.has(id)))) {
      this.roots.clear();
      this.connectedNodes = [];
      return 0;
    }
    this.roots = next;
    this.dirty = true;
    this.refreshConnectedNodes();
    return this.connectedNodes.length;
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
    const ids = collectConnectedNodeIds(
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

  render(frameTickIndex: number) {
    this.refreshConnectedNodes();
    for (const node of this.connectedNodes) {
      if (node.isHiddenBySectionCollapse) continue;
      this.project.shapeRenderer.renderRect(
        this.project.renderer.transformWorld2View(node.collisionBox.getRectangle().expandFromCenter(10)),
        Color.Transparent,
        this.project.stageStyleManager.currentStyle.CollideBoxSelected.toNewAlpha(0.9),
        4,
      );
    }
    for (const stageObject of this.project.contentSearch.searchResultNodes) {
      const rect = stageObject.collisionBox.getRectangle().expandFromCenter(10);
      this.project.shapeRenderer.renderRect(
        this.project.renderer.transformWorld2View(rect),
        Color.Transparent,
        this.project.stageStyleManager.currentStyle.effects.warningShadow.toNewAlpha(
          Math.sin(frameTickIndex * 0.25) * 0.25 + 0.5,
        ),
        4,
      );
    }
  }
}
