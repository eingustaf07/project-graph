import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import { parse } from "yaml";

const fixtureClasses = vi.hoisted(() => {
  class Entity {
    uuid = crypto.randomUUID();
    parentSection: any = null;
    isSelected = false;
    detailsText = "";
    detailsManager = { getBeSearchingText: () => this.detailsText };
    collisionBox: any;
    color = "original";
  }
  class TextNode extends Entity {
    text = "";
    rename(text: string) {
      this.text = text;
    }
  }
  class Section extends TextNode {
    locked = false;
  }
  class UrlNode extends Entity {
    title = "";
    url = "https://example.com";
    rename(title: string) {
      this.title = title;
    }
  }
  class Edge {
    uuid = crypto.randomUUID();
    text = "";
    isSelected = false;
    source: any;
    target: any;
    collisionBox: any;
    rename(text: string) {
      this.text = text;
    }
  }
  return { Entity, TextNode, Section, UrlNode, Edge, objects: new Map<string, any>() };
});
vi.mock("@/core/Project", () => ({
  Project: class {},
  ProjectState: { Saved: "saved", Unsaved: "unsaved" },
  service: () => (target: unknown) => target,
}));
vi.mock("@/core/stage/stageObject/abstract/StageEntity", () => ({ Entity: fixtureClasses.Entity }));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({ TextNode: fixtureClasses.TextNode }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: fixtureClasses.Section }));
vi.mock("@/core/stage/stageObject/entity/UrlNode", () => ({ UrlNode: fixtureClasses.UrlNode }));
vi.mock("@/core/stage/stageObject/association/Edge", () => ({ Edge: fixtureClasses.Edge }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/RectangleNoteEffect", () => ({
  RectangleNoteEffect: class {},
}));
vi.mock("@/core/service/Settings", () => ({
  Settings: {
    historyManagerMode: "timeEfficient",
    historySize: 100,
    showDebug: false,
    watch: () => () => {},
  },
}));
vi.mock("@graphif/serializer", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("@graphif/serializer")>()),
  serialize: (objects: any[]) =>
    objects.map((object) => {
      if (!fixtureClasses.objects.has(object.uuid)) fixtureClasses.objects.set(object.uuid, object);
      return {
        uuid: object.uuid,
        text: object.text,
        title: object.title,
        url: object.url,
        isSelected: object.isSelected,
      };
    }),
  deserialize: (snapshot: any[]) =>
    snapshot.map((data) => {
      const original = fixtureClasses.objects.get(data.uuid);
      return Object.assign(Object.create(Object.getPrototypeOf(original)), original, data);
    }),
}));

import { Vector } from "@graphif/data-structures";
import { Rectangle } from "@graphif/shapes";
import { CollisionBox } from "@/core/stage/stageObject/collisionBox/collisionBox";
import { ContentSearch, SearchScope } from "./contentSearchEngine";
import { HistoryManager } from "@/core/stage/stageManager/StageHistoryManager";
import { Settings } from "@/core/service/Settings";
import { findReplacementMatches, planTextReplacements, type ReplacementTarget } from "./contentReplace";

const literalTarget = (text: string): ReplacementTarget => ({
  uuid: crypto.randomUUID(),
  text,
  locked: false,
  write: vi.fn(),
});
function node(text: string, x = 0, y = 0) {
  const item = new fixtureClasses.TextNode();
  item.text = text;
  item.collisionBox = new CollisionBox([new Rectangle(new Vector(x, y), new Vector(100, 60))]);
  return item;
}
function createProject(...objects: any[]) {
  const project: any = {
    stage: objects,
    effects: { addEffect: vi.fn() },
    camera: { location: Vector.getZero() },
    emit: vi.fn(),
    projectState: "saved",
  };
  project.stageManager = {
    getStageObjects: () => project.stage,
    getTextNodes: () => project.stage.filter((item: any) => item instanceof fixtureClasses.TextNode),
    updateReferences: vi.fn(),
  };
  project.historyManager = new HistoryManager(project);
  const recordStep = vi.spyOn(project.historyManager, "recordStep");
  project.contentSearch = new ContentSearch(project);
  return { project, search: project.contentSearch as ContentSearch, recordStep };
}

describe("literal text replacement planning", () => {
  it.each(["zh_CN", "en"])("loads real %s UI text using the application's namespace layout", async (language) => {
    const resources = parse(readFileSync(new URL(`../../../../locales/${language}.yml`, import.meta.url), "utf8"));
    const instance = createInstance();
    await instance.init({ lng: language, defaultNS: "", fallbackLng: false, resources: { [language]: resources } });
    expect(instance.t("replaceAll", { ns: "findReplace" })).toBe(language === "zh_CN" ? "全部替换" : "Replace all");
    expect(instance.t("matchCount", { ns: "findReplace", count: 3 })).toContain("3");
  });
  it.each([".", "[a]", "a+b", "$", "\\", "(a)", "?", "*", "{x}", "^", "|"])(
    "treats %s literally rather than as a pattern",
    (query) => {
      const target = literalTarget(`前${query}后${query}`);
      const changes = planTextReplacements(findReplacementMatches([target], query, false), "$&$1");
      expect(changes[0].after).toBe("前$&$1后$&$1");
      expect(changes[0].count).toBe(2);
    },
  );
  it("supports Chinese, emoji, case sensitivity, empty replacement and an empty query", () => {
    const target = literalTarget("中文中文😀\nFOO foo");
    expect(planTextReplacements(findReplacementMatches([target], "中文", true), "")[0].after).toBe("😀\nFOO foo");
    expect(findReplacementMatches([target], "foo", false)).toHaveLength(2);
    expect(findReplacementMatches([target], "foo", true)).toHaveLength(1);
    expect(findReplacementMatches([target], "😀", true)[0]).toMatchObject({ start: 4, end: 6 });
    expect(findReplacementMatches([target], "", false)).toEqual([]);
  });
  it("plans from the original content without recursively replacing inserted text", () => {
    const target = literalTarget("aaa");
    expect(planTextReplacements(findReplacementMatches([target], "a", true), "aa")[0]).toMatchObject({
      after: "aaaaaa",
      count: 3,
    });
    expect(planTextReplacements(findReplacementMatches([target], "a", true), "a")).toEqual([]);
  });
});

describe("find/replace in the current Project", () => {
  beforeEach(() => {
    Settings.historyManagerMode = "timeEfficient";
    fixtureClasses.objects.clear();
  });
  it.each(["timeEfficient", "memoryEfficient"] as const)(
    "replaces all occurrences as one real %s history step with undo and redo",
    (mode) => {
      Settings.historyManagerMode = mode;
      const a = node("交易交易"),
        b = node("交易计划");
      const { project, search, recordStep } = createProject(a, b);
      search.startSearch("交易", false);
      expect(search.replaceText("交易", "研究", true)).toMatchObject({ count: 3, objectCount: 2 });
      expect([a.text, b.text]).toEqual(["研究研究", "研究计划"]);
      expect(recordStep).toHaveBeenCalledOnce();
      expect(project.projectState).toBe("unsaved");
      project.historyManager.undo();
      expect(project.stage.map((item: any) => item.text)).toEqual(["交易交易", "交易计划"]);
      project.historyManager.redo();
      expect(project.stage.map((item: any) => item.text)).toEqual(["研究研究", "研究计划"]);
      expect([a.color, b.color]).toEqual(["original", "original"]);
    },
  );

  it("can normalize case without counting already-identical occurrences as changes", () => {
    const a = node("Foo foo FOO");
    const { search } = createProject(a);
    expect(search.replaceText("foo", "foo", true).count).toBe(2);
    expect(a.text).toBe("foo foo foo");
    a.text = "Foo foo FOO";
    search.isCaseSensitive = true;
    expect(search.replaceText("foo", "bar", true).count).toBe(1);
    expect(a.text).toBe("Foo bar FOO");
  });

  it("replaces a single occurrence at a time and skips newly inserted matching text", () => {
    const a = node("aa"),
      b = node("a");
    const { search, recordStep } = createProject(a, b);
    search.startSearch("a", false);
    expect(search.replaceText("a", "aa", false).count).toBe(1);
    expect(a.text).toBe("aaa");
    search.replaceText("a", "aa", false);
    expect(a.text).toBe("aaaa");
    search.replaceText("a", "aa", false);
    expect(b.text).toBe("aa");
    expect(search.getReplacementStatus("a")).toMatchObject({ atEnd: true, hasCurrent: false });
    search.replaceText("a", "aa", false);
    expect([a.text, b.text]).toEqual(["aaaa", "aa"]);
    expect(recordStep).toHaveBeenCalledTimes(3);
  });

  it("does not skip adjacent matches when replacing with an empty string", () => {
    const a = node("aaa");
    const { search } = createProject(a);
    search.startSearch("a", false);
    for (let i = 0; i < 3; i++) expect(search.replaceText("a", "", false).count).toBe(1);
    expect(a.text).toBe("");
    expect(search.getReplacementStatus("a").count).toBe(0);
  });

  it("starts at the clicked result and supports returning to an earlier result", () => {
    const a = node("查找"),
      b = node("查找");
    const { search } = createProject(a, b);
    search.startSearch("查找", false);
    search.chooseSearchResult(1);
    search.replaceText("查找", "替换", false);
    expect([a.text, b.text]).toEqual(["查找", "替换"]);
    search.chooseSearchResult(0);
    search.replaceText("查找", "替换", false);
    expect(a.text).toBe("替换");
  });

  it("respects selected scope even after next/previous navigation", () => {
    const a = node("foo"),
      b = node("foo");
    a.isSelected = true;
    const { search } = createProject(a, b);
    search.searchScope = SearchScope.SELECTED;
    search.startSearch("foo", false);
    search.nextSearchResult();
    search.previousSearchResult();
    search.replaceText("foo", "bar", true);
    expect([a.text, b.text]).toEqual(["bar", "foo"]);
    expect(a.isSelected).toBe(true);
  });

  it("respects selected bounds and limits replacement to fully contained objects", () => {
    const left = node("bounds", 0, 0),
      right = node("bounds", 400, 200);
    left.isSelected = right.isSelected = true;
    const inside = node("foo", 200, 100),
      outside = node("foo", 600, 100);
    const { search } = createProject(left, inside, outside, right);
    search.searchScope = SearchScope.SELECTED_BOUNDS;
    search.startSearch("foo", false);
    search.replaceText("foo", "bar", true);
    expect([inside.text, outside.text]).toEqual(["bar", "foo"]);
  });

  it("skips locked ancestors and linked edges; reports the skipped occurrence count", () => {
    const locked = Object.assign(new fixtureClasses.Section(), { text: "foo", locked: true });
    const child = node("foo");
    child.parentSection = locked;
    const normal = node("foo");
    const edge = Object.assign(new fixtureClasses.Edge(), { text: "foo", source: child, target: normal });
    const { search } = createProject(locked, child, normal, edge);
    const result = search.replaceText("foo", "bar", true);
    expect(result).toMatchObject({ count: 1, objectCount: 1, lockedCount: 3 });
    expect([locked.text, child.text, normal.text, edge.text]).toEqual(["foo", "foo", "bar", "foo"]);
  });

  it("keeps details and URLs intact while replacing visible titles and edge labels", () => {
    const a = node("foo");
    a.detailsText = "foo in details";
    const section = Object.assign(new fixtureClasses.Section(), { text: "foo" });
    const url = Object.assign(new fixtureClasses.UrlNode(), { title: "foo", url: "https://foo.example" });
    const edge = Object.assign(new fixtureClasses.Edge(), { text: "foo", source: a, target: url });
    const { search } = createProject(a, section, url, edge);
    expect(search.replaceText("foo", "bar", true).count).toBe(4);
    expect([a.text, section.text, url.title, edge.text]).toEqual(["bar", "bar", "bar", "bar"]);
    expect(a.detailsText).toBe("foo in details");
    expect(url.url).toBe("https://foo.example");
  });

  it("does not replace a different object when a details-only result is selected", () => {
    const detailOnly = node("plain");
    detailOnly.detailsText = "foo";
    const editable = node("foo");
    const { search, recordStep } = createProject(detailOnly, editable);
    search.startSearch("foo", false);
    search.chooseSearchResult(0);
    expect(search.getReplacementStatus("foo").hasCurrent).toBe(false);
    expect(search.replaceText("foo", "bar", false).count).toBe(0);
    expect(editable.text).toBe("foo");
    expect(recordStep).not.toHaveBeenCalled();
  });

  it("restores the complete batch if one of the native rename operations fails", () => {
    const a = node("foo"),
      b = node("foo");
    const { project, search, recordStep } = createProject(a, b);
    vi.spyOn(b, "rename").mockImplementation((text) => {
      b.text = text;
      throw new Error("rename failure");
    });
    expect(() => search.replaceText("foo", "bar", true)).toThrow("rename failure");
    expect(project.stage.map((item: any) => item.text)).toEqual(["foo", "foo"]);
    expect(recordStep).not.toHaveBeenCalled();
    expect(project.stageManager.updateReferences).toHaveBeenCalledOnce();
  });

  it("does not add history for no matches, empty queries or identical replacements", () => {
    const { search, recordStep } = createProject(node("foo"));
    search.replaceText("missing", "x", true);
    search.replaceText("", "x", true);
    search.replaceText("foo", "foo", true);
    expect(recordStep).not.toHaveBeenCalled();
  });
});
