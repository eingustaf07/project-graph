import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({ ConnectableEntity: class {} }));
vi.mock("@/core/stage/stageObject/abstract/Association", () => ({ ConnectableAssociation: class {} }));
const highlightSettings = vi.hoisted(() => ({ connectedNodeHighlightScope: "all" as "direct" | "all" }));
vi.mock("@/core/service/Settings", () => ({ Settings: highlightSettings }));

import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { Rectangle } from "@graphif/shapes";
import { Color, Vector } from "@graphif/data-structures";
import { SearchContentHighlightRenderer } from "./searchContentHighlightRenderer";

function makeNode(uuid: string, x: number) {
  return Object.assign(new (ConnectableEntity as any)(), {
    uuid,
    isSelected: false,
    isHiddenBySectionCollapse: false,
    color: Color.Red.clone(),
    collisionBox: new CollisionBox([new Rectangle(new Vector(x, 0), new Vector(100, 60))]),
  });
}
function fixture() {
  const a = makeNode("a", 0),
    b = makeNode("b", 200),
    c = makeNode("c", 400),
    other = makeNode("other", 600);
  a.isSelected = true;
  const relation = (...members: any[]) =>
    Object.assign(new (ConnectableAssociation as any)(), { associationList: members });
  const listeners = new Set<() => void>();
  const project: any = {
    stage: [a, b, c, other, relation(b, a), relation(b, c)],
    on: vi.fn((_name, callback) => listeners.add(callback)),
    off: vi.fn((_name, callback) => listeners.delete(callback)),
    shapeRenderer: { renderRect: vi.fn() },
    renderer: { transformWorld2View: (rect: Rectangle) => rect },
    stageStyleManager: { currentStyle: { CollideBoxSelected: Color.Green, effects: { warningShadow: Color.Red } } },
    contentSearch: { searchResultNodes: [] },
  };
  project.stageManager = {
    getEntities: vi.fn(() => project.stage.filter((item: any) => item instanceof ConnectableEntity)),
    getSelectedEntities: () =>
      project.stage.filter((item: any) => item instanceof ConnectableEntity && item.isSelected),
    getAssociations: () => project.stage.filter((item: any) => !(item instanceof ConnectableEntity)),
  };
  return {
    a,
    b,
    c,
    other,
    project,
    relation,
    commit: () => listeners.forEach((f) => f()),
    listeners,
    renderer: new SearchContentHighlightRenderer(project),
  };
}

describe("connected highlight overlay", () => {
  beforeEach(() => {
    highlightSettings.connectedNodeHighlightScope = "all";
  });
  it("updates active highlighting immediately when the saved range setting changes", () => {
    const { project, renderer } = fixture();
    expect(renderer.toggleConnectedHighlight()).toBe(3);
    highlightSettings.connectedNodeHighlightScope = "direct";
    renderer.render(0);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(2);
    project.shapeRenderer.renderRect.mockClear();
    highlightSettings.connectedNodeHighlightScope = "all";
    renderer.render(1);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(3);
  });
  it("toggles persistent outlines without changing selection, colors, geometry or recording history", () => {
    const { a, b, c, other, project, renderer } = fixture();
    const before = [a, b, c, other].map((node) => ({
      color: node.color.toArray(),
      selected: node.isSelected,
      rect: node.collisionBox.getRectangle().toString(),
    }));
    expect(renderer.toggleConnectedHighlight()).toBe(3);
    renderer.render(0);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(3);
    expect(
      [a, b, c, other].map((node) => ({
        color: node.color.toArray(),
        selected: node.isSelected,
        rect: node.collisionBox.getRectangle().toString(),
      })),
    ).toEqual(before);
    expect(renderer.toggleConnectedHighlight()).toBe(0);
    project.shapeRenderer.renderRect.mockClear();
    renderer.render(0);
    expect(project.shapeRenderer.renderRect).not.toHaveBeenCalled();
  });
  it("preserves search-result highlighting and ignores non-connection synchronization relations", () => {
    const { a, other, project, renderer } = fixture();
    project.stage.push({ associationList: [a, other] });
    project.contentSearch.searchResultNodes = [other];
    expect(renderer.toggleConnectedHighlight()).toBe(3);
    renderer.render(1);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(4);
  });
  it("caches traversal across frames and updates after connection edits and undo-like stage replacement", () => {
    const { a, c, other, project, renderer, relation, commit } = fixture();
    renderer.toggleConnectedHighlight();
    renderer.render(0);
    renderer.render(1);
    expect(project.stageManager.getEntities).toHaveBeenCalledTimes(1);
    project.stage.push(relation(c, other));
    commit();
    project.shapeRenderer.renderRect.mockClear();
    renderer.render(2);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(4);
    project.stage = [a];
    project.shapeRenderer.renderRect.mockClear();
    renderer.render(3);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(1);
  });
  it("can clear after deselection, switch roots, and clears when the root is deleted", () => {
    const { a, other, project, renderer } = fixture();
    renderer.toggleConnectedHighlight();
    a.isSelected = false;
    other.isSelected = true;
    expect(renderer.toggleConnectedHighlight()).toBe(1);
    project.stage = project.stage.filter((item: any) => item !== other);
    renderer.render(0);
    expect(renderer.hasConnectedHighlight).toBe(false);
    a.isSelected = true;
    renderer.toggleConnectedHighlight();
    a.isSelected = false;
    expect(renderer.toggleConnectedHighlight()).toBe(0);
  });
  it("does not expand folded sections and removes its listener on disposal", () => {
    const { b, project, renderer, listeners } = fixture();
    b.isHiddenBySectionCollapse = true;
    renderer.toggleConnectedHighlight();
    renderer.render(0);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(2);
    renderer.dispose();
    expect(listeners.size).toBe(0);
    expect(renderer.hasConnectedHighlight).toBe(false);
    expect(project.off).toHaveBeenCalledOnce();
  });
  it.each(["zh_CN", "zh_TW", "zh_TWC", "en", "id"])("provides the new shortcut label in %s", (language) => {
    const resources = parse(readFileSync(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"));
    expect(resources.keyBinds.toggleConnectedNodeHighlight.title).toBeTruthy();
    expect(resources.keyBinds.connectedHighlightEnabled).toContain("{{count}}");
    expect(resources.settings.connectedNodeHighlightScope.options.direct).toBeTruthy();
    expect(resources.settings.connectedNodeHighlightScope.options.all).toBeTruthy();
  });
});
