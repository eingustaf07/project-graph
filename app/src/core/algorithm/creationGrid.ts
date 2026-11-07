import { Settings } from "@/core/service/Settings";
import type { Project } from "@/core/Project";
import { Rectangle } from "@graphif/shapes";
import { Vector } from "@graphif/data-structures";

export function creationGridGap(project: Project): number {
  if (!Settings.snapNewNodesToGrid || !(Settings.showBackgroundHorizontalLines && Settings.showBackgroundVerticalLines))
    return 0;
  return project.backgroundRenderer?.getCurrentGap() ?? 0;
}

// Round shared layer coordinates together. When two originally disjoint
// intervals would touch or overlap, reserve the next available grid line.
function snapAxis(starts: number[], sizes: number[], gap: number) {
  const ids = starts.map((_, i) => i);
  const byStart = ids.slice().sort((a, b) => starts[a] - starts[b]);
  const byEnd = ids.slice().sort((a, b) => starts[a] + sizes[a] - starts[b] - sizes[b]);
  const snapped: number[] = [];
  let nextEnd = 0,
    minimum = -Infinity;
  for (const i of byStart) {
    while (
      nextEnd < ids.length &&
      starts[byEnd[nextEnd]] + sizes[byEnd[nextEnd]] <= starts[i] &&
      starts[byEnd[nextEnd]] < starts[i]
    ) {
      const j = byEnd[nextEnd++];
      minimum = Math.max(
        minimum,
        Math.ceil((snapped[j] + sizes[j] + (starts[j] + sizes[j] < starts[i] ? 0.001 : 0)) / gap) * gap,
      );
    }
    snapped[i] = Math.max(minimum, Math.round(starts[i] / gap) * gap);
  }
  return snapped;
}

export function gridLocations(rects: Rectangle[], gap: number): Vector[] {
  const xs = snapAxis(
    rects.map((r) => r.left),
    rects.map((r) => r.width),
    gap,
  );
  const ys = snapAxis(
    rects.map((r) => r.top),
    rects.map((r) => r.height),
    gap,
  );
  return xs.map((x, i) => new Vector(x, ys[i]));
}
