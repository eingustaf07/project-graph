import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (target: unknown) => target }));
vi.mock("@/core/stage/stageObject/abstract/ConnectableEntity", () => ({ ConnectableEntity: class {} }));
vi.mock("@/core/stage/stageObject/abstract/Association", () => ({ ConnectableAssociation: class {} }));
vi.mock("@/core/stage/stageObject/association/Edge", async () => {
  const { ConnectableAssociation } = await import("@/core/stage/stageObject/abstract/Association");
  abstract class MockEdge extends ConnectableAssociation {}
  return { Edge: MockEdge };
});
const highlightSettings = vi.hoisted(() => ({
  connectedNodeHighlightLocked: false,
  connectedNodeHighlightScope: "all" as "direct" | "all" | "chain",
}));
vi.mock("@/core/service/Settings", () => ({ Settings: highlightSettings }));

import { ConnectableEntity } from "@/core/stage/stageObject/abstract/ConnectableEntity";
import { Edge } from "@/core/stage/stageObject/association/Edge";
import { ConnectableAssociation } from "@/core/stage/stageObject/abstract/Association";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { Rectangle } from "@graphif/shapes";
import { Color, Vector } from "@graphif/data-structures";
import { SearchContentHighlightRenderer } from "./searchContentHighlightRenderer";
import { CollisionBoxRenderer } from "../entityRenderer/CollisionBoxRenderer";

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
    collisionBoxRenderer: { selectionOutset: () => 11.5 },
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
  it("can read the current locked highlight for copying before the next render", () => {
    const { a, b, c, other, renderer } = fixture();
    highlightSettings.connectedNodeHighlightLocked = true;
    expect(renderer.getConnectedHighlightedNodes()).toEqual([a, b, c]);
    a.isSelected = false;
    other.isSelected = true;
    renderer.invalidateSelection();
    expect(renderer.getConnectedHighlightedNodes()).toEqual([other]);
    expect(a.isSelected).toBe(false);
    expect(b.isSelected).toBe(false);
    expect(c.isSelected).toBe(false);
  });
  beforeEach(() => {
    highlightSettings.connectedNodeHighlightLocked = false;
    highlightSettings.connectedNodeHighlightScope = "all";
  });
  it("follows selection, combines roots, clears when empty and releases the lock", () => {
    const { a, other, project, renderer } = fixture();
    highlightSettings.connectedNodeHighlightLocked = true;
    renderer.render(0);
    const [outer, , color] = project.shapeRenderer.renderRect.mock.calls[0];
    expect(outer.left).toBe(-16.5);
    expect(color.toArray()).toEqual([255, 0, 255, 0.9]);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(3);
    other.isSelected = true;
    renderer.invalidateSelection();
    project.shapeRenderer.renderRect.mockClear();
    renderer.render(1);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(4);
    a.isSelected = false;
    renderer.invalidateSelection();
    project.shapeRenderer.renderRect.mockClear();
    renderer.render(2);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(1);
    const scans = project.stageManager.getEntities.mock.calls.length;
    renderer.render(3);
    expect(project.stageManager.getEntities).toHaveBeenCalledTimes(scans);
    other.isSelected = false;
    renderer.invalidateSelection();
    renderer.render(4);
    expect(renderer.hasConnectedHighlight).toBe(false);
    a.isSelected = true;
    renderer.invalidateSelection();
    renderer.render(5);
    highlightSettings.connectedNodeHighlightLocked = false;
    renderer.render(6);
    expect(renderer.hasConnectedHighlight).toBe(false);
    expect(renderer.toggleConnectedHighlight()).toBe(3);
  });
  it.each([0.03, 0.3, 1, 3, 8])(
    "keeps three view pixels between selection and highlight strokes at zoom %s",
    (scale) => {
      const { project, renderer, a } = fixture();
      project.camera = { currentScale: scale, isDefaultZoom: () => scale > 0.1 && scale < 4 };
      project.renderer.transformWorld2View = (item: Rectangle | Vector) =>
        item instanceof Rectangle
          ? new Rectangle(item.location.multiply(scale), item.size.multiply(scale))
          : item.multiply(scale);
      project.collisionBoxRenderer = new CollisionBoxRenderer(project);
      renderer.toggleConnectedHighlight();
      for (const auto of [true, false]) {
        Object.assign(highlightSettings, { enableCollisionBoxAutoWidth: auto });
        project.shapeRenderer.renderRect.mockClear();
        project.collisionBoxRenderer.render(a.collisionBox, Color.Green);
        renderer.render(0);
        const [[inner, , , innerWidth], [outer, , , outerWidth]] = project.shapeRenderer.renderRect.mock.calls;
        expect(inner.left - innerWidth / 2 - (outer.left + outerWidth / 2)).toBeCloseTo(3);
        expect(outer.bottom - outerWidth / 2 - (inner.bottom + innerWidth / 2)).toBeCloseTo(3);
      }
    },
  );

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
  it("switches a live highlight to the directed chain and ignores undirected associations", () => {
    const { a, other, project, renderer } = fixture();
    project.stage.push(
      Object.assign(Object.create(Edge.prototype), { source: a, target: other, associationList: [a, other] }),
    );
    expect(renderer.toggleConnectedHighlight()).toBe(4);
    highlightSettings.connectedNodeHighlightScope = "chain";
    renderer.render(0);
    expect(project.shapeRenderer.renderRect).toHaveBeenCalledTimes(2);
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
  it("draws the same themed match outlines and stationary locator on every frame", () => {
    const { a, b, project, renderer } = fixture();
    project.contentSearch.searchResultNodes = [a, b];
    project.contentSearch.locatedResult = { node: b, color: Color.Magenta };
    const themeColor = new Color(23, 129, 174);
    project.stageStyleManager.currentStyle.effects.warningShadow = themeColor;
    const bounds = [a, b].map((node) => node.collisionBox.getRectangle());
    for (const tick of [0, 6, 19, 120]) {
      project.shapeRenderer.renderRect.mockClear();
      renderer.render(tick);
      expect(project.shapeRenderer.renderRect.mock.calls).toEqual([
        [bounds[0].expandFromCenter(10), Color.Transparent, themeColor.toNewAlpha(0.5), 4],
        [bounds[1].expandFromCenter(10), Color.Transparent, themeColor.toNewAlpha(0.5), 4],
        [bounds[1], Color.Transparent, Color.Magenta, 2],
      ]);
    }
    project.shapeRenderer.renderRect.mockClear();
    project.contentSearch.searchResultNodes = [];
    renderer.render(121);
    expect(project.shapeRenderer.renderRect).not.toHaveBeenCalled();
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
