import type { Project } from "@/core/Project";
import type { TextNode } from "@/core/stage/stageObject/entity/TextNode";
import { Settings } from "@/core/service/Settings";
import { isQuestionMarked } from "@/core/render/canvas2d/questionColor";
import { hasTaskStatus, isConclusionText } from "./nodeConclusions";

type Kind = "question" | "conclusion" | undefined;
type State = {
  indices: Map<TextNode, number>;
  kinds: Map<TextNode, Kind>;
  lastCreated: number;
  queued: boolean;
  updating: boolean;
  disposed: boolean;
};
const states = new WeakMap<Project, State>();
const prepared = new WeakSet<TextNode>();
function stateOf(project: Project): State {
  let state = states.get(project);
  if (!state) {
    state = { indices: new Map(), kinds: new Map(), lastCreated: 0, queued: false, updating: false, disposed: false };
    states.set(project, state);
  }
  return state;
}

function eligible(node: TextNode): boolean {
  return Number.isSafeInteger(node.numberingCreatedAt) && node.numberingCreatedAt! > 0;
}

function category(node: TextNode): Kind {
  if (!eligible(node) || hasTaskStatus(node.text)) return;
  if (isConclusionText(node.text)) return "conclusion";
  if (isQuestionMarked(node.text)) return "question";
}

export function markNewNumberingNode(project: Project, node: TextNode) {
  if (Settings.dynamicNodeNumbering === undefined || prepared.has(node)) return;
  const state = stateOf(project);
  state.lastCreated = Math.max(Date.now() * 1000, state.lastCreated + 1);
  node.numberingCreatedAt = state.lastCreated;
  prepared.add(node);
  queueNodeNumbering(project);
}

export function numberedNodeText(project: Project, node: TextNode): string {
  if (!Settings.dynamicNodeNumbering) return node.text;
  const index = states.get(project)?.indices.get(node);
  return index ? `${index}. ${node.text}` : node.text;
}

export function refreshNodeNumbering(project: Project, skipResize?: TextNode, pendingNodes?: readonly TextNode[]) {
  const state = stateOf(project);
  if (state.updating || state.disposed) return;
  state.updating = true;
  try {
    const stage = pendingNodes ? [...project.stage, ...pendingNodes] : project.stage;
    const nodes = stage.filter(
      (n): n is TextNode =>
        typeof (n as TextNode).text === "string" &&
        typeof (n as TextNode).refreshSizeByTextIfNeeded === "function" &&
        eligible(n as TextNode),
    );
    for (const node of nodes) state.lastCreated = Math.max(state.lastCreated, node.numberingCreatedAt!);
    const next = new Map<TextNode, number>();
    const kinds = new Map(nodes.map((node) => [node, category(node)]));
    if (Settings.dynamicNodeNumbering) {
      const counts = { question: 0, conclusion: 0 };
      nodes.sort((a, b) => a.numberingCreatedAt! - b.numberingCreatedAt! || a.uuid.localeCompare(b.uuid));
      for (const node of nodes) {
        const kind = kinds.get(node);
        if (kind) next.set(node, ++counts[kind]);
      }
    }
    const previous = state.indices;
    state.indices = next;
    state.kinds = kinds;
    const present = new Set(stage);
    let resized = false;
    for (const node of new Set([...previous.keys(), ...next.keys()])) {
      if (node === skipResize || !present.has(node) || previous.get(node) === next.get(node)) continue;
      if (node.sizeAdjust === "manual") node.forceAdjustHeightByText();
      else node.refreshSizeByTextIfNeeded();
      resized = true;
    }
    if (resized) project.controller?.resetCountdownTimer?.();
  } finally {
    state.updating = false;
  }
}

export function prepareNewNumberingNodes(project: Project, nodes: readonly TextNode[]) {
  for (const node of nodes) markNewNumberingNode(project, node);
  refreshNodeNumbering(project, undefined, nodes);
}

export function queueNodeNumbering(project: Project) {
  const state = stateOf(project);
  if (state.queued || state.disposed) return;
  state.queued = true;
  queueMicrotask(() => {
    state.queued = false;
    if (!state.disposed) refreshNodeNumbering(project);
  });
}

export function numberingTextChanged(project: Project, node: TextNode) {
  if (eligible(node) && stateOf(project).kinds.get(node) !== category(node)) refreshNodeNumbering(project, node);
}

export function watchNodeNumbering(project: Project): () => void {
  const changed = () => queueNodeNumbering(project);
  const unwatchNumbering = Settings.watch("dynamicNodeNumbering", changed);
  const unwatchQuestions = Settings.watch("questionMarkYellow", changed);
  return () => {
    unwatchNumbering();
    unwatchQuestions();
    const state = states.get(project);
    if (state) state.disposed = true;
  };
}
